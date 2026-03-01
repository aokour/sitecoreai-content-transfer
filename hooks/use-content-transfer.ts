"use client";

import { useMarketplaceClient } from "@/components/providers/marketplace";
import type {
  BlobStateResponse,
  ChunkSetMetadata,
  ContentTransferStatus,
  TransferConfig,
  TransferPhase,
} from "@/lib/content-transfer";
import { useCallback, useRef, useState } from "react";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 120; // 6 minutes max

// ── Logging helpers ───────────────────────────────────────────────────────
const LOG_PREFIX = "[ContentTransfer]";
function log(step: string, message: string, data?: unknown) {
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  if (data !== undefined) {
    console.log(`${LOG_PREFIX} [${ts}] [${step}] ${message}`, data);
  } else {
    console.log(`${LOG_PREFIX} [${ts}] [${step}] ${message}`);
  }
}
function logError(step: string, message: string, err?: unknown) {
  const ts = new Date().toISOString().slice(11, 23);
  console.error(`${LOG_PREFIX} [${ts}] [${step}] ✗ ${message}`, err ?? "");
}
function logWarn(step: string, message: string, data?: unknown) {
  const ts = new Date().toISOString().slice(11, 23);
  console.warn(`${LOG_PREFIX} [${ts}] [${step}] ⚠ ${message}`, data ?? "");
}

export interface TransferProgress {
  phase: TransferPhase;
  progress: number; // 0–100
  error: string | null;
  transferId: string | null;
  isRunning: boolean;
  chunkSetsMetadata: ChunkSetMetadata[];
}

export function useContentTransfer() {
  const client = useMarketplaceClient();
  const [phase, setPhase] = useState<TransferPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [transferId, setTransferId] = useState<string | null>(null);
  const [chunkSetsMetadata, setChunkSetsMetadata] = useState<ChunkSetMetadata[]>([]);
  const abortRef = useRef(false);
  // Prevents two concurrent startTransfer calls (e.g. React StrictMode double-effect)
  const isRunningRef = useRef(false);

  // ── Helpers ──────────────────────────────────────────────────────────────

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function pollTransferStatus(
    tid: string,
    srcCtx: string
  ): Promise<ChunkSetMetadata[]> {
    log("PollStatus", `Polling transfer status — transferId=${tid} srcCtx=${srcCtx}`);
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      if (abortRef.current) throw new Error("Transfer aborted");
      await sleep(POLL_INTERVAL_MS);
      const res = await client.query(
        "xmc.contentTransfer.getContentTransferStatus",
        {
          params: {
            path: { transferId: tid },
            query: { sitecoreContextId: srcCtx },
          },
        }
      );
      // client.query() returns QueryResult<K> where .data is the @hey-api response
      // wrapper { data: T, request, response }. The actual payload is at .data.data.
      const rawRes = res?.data as unknown;
      const data = (rawRes as { data?: ContentTransferStatus })?.data;
      log("PollStatus", `Attempt ${attempt + 1} raw response`, rawRes);
      if (!data) {
        logWarn("PollStatus", "No data in response — retrying");
        continue;
      }
      log("PollStatus", `State=${data.State} ChunkSets=${data.ChunkSetsMetadata?.length ?? 0}`);
      if (data.ChunkSetsMetadata?.length) {
        setChunkSetsMetadata(data.ChunkSetsMetadata);
      }
      if (data.State === "Failed") {
        logError("PollStatus", "Packaging failed on source", data);
        throw new Error("Content packaging failed on source environment");
      }
      if (data.State === "Completed" && data.ChunkSetsMetadata?.length) {
        log("PollStatus", `✓ Packaging complete — ${data.ChunkSetsMetadata.length} chunk set(s)`, data.ChunkSetsMetadata);
        return data.ChunkSetsMetadata;
      }
    }
    throw new Error("Transfer status polling timed out");
  }

  async function pollBlobState(fileName: string, destCtx: string): Promise<void> {
    log("PollBlob", `Polling blob state — fileName=${fileName} destCtx=${destCtx}`);
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      if (abortRef.current) throw new Error("Transfer aborted");
      await sleep(POLL_INTERVAL_MS);
      const res = await client.query("xmc.contentTransfer.getBlobState", {
        params: {
          query: { fileName, sitecoreContextId: destCtx },
        },
      });
      // client.query() wraps the result in QueryResult; actual payload is at .data.data.
      // OpenAPI spec (content-transfer.yaml) defines the shape as { status, details }.
      // At runtime the API may return { BlobState, Error, Actions, ConsumedName }.
      // We check both field names so we're compatible with either.
      const rawRes = res?.data as unknown;
      const data = (rawRes as { data?: BlobStateResponse })?.data;
      log("PollBlob", `Attempt ${attempt + 1} raw response`, rawRes);
      if (!data) {
        logWarn("PollBlob", "No data in response — retrying");
        continue;
      }
      // Normalise: prefer runtime field, fall back to spec field
      const blobState = data.BlobState ?? (data as unknown as { status?: string }).status;
      const blobError = data.Error ?? (data as unknown as { details?: unknown }).details;
      log("PollBlob", `status/BlobState=${blobState ?? "(none)"} error/details=${blobError ?? "(none)"}`);
      if (blobState === "Error") {
        logError("PollBlob", "Import failed on destination", data);
        throw new Error(
          blobError
            ? `Import failed: ${JSON.stringify(blobError)}`
            : "Import failed on destination environment"
        );
      }
      if (blobState === "Completed" || blobState === "OK") {
        log("PollBlob", `✓ Blob processed — fileName=${fileName}`);
        return;
      }
    }
    throw new Error("Blob state polling timed out");
  }

  // ── Main orchestration ────────────────────────────────────────────────────

  const startTransfer = useCallback(
    async (config: TransferConfig) => {
      // Guard: ignore duplicate calls (React StrictMode fires effects twice)
      if (isRunningRef.current) return;
      isRunningRef.current = true;

      abortRef.current = false;
      setError(null);
      setProgress(0);
      setChunkSetsMetadata([]);
      setTransferId(config.transferId);

      try {
        // ── Step 1: Create transfer on source ──────────────────────────────
        setPhase("creating");
        setProgress(2);
        log("Step1", `Creating transfer on source`, {
          transferId: config.transferId,
          sourceContextId: config.sourceContextId,
          destinationContextId: config.destinationContextId,
          dataTrees: config.dataTrees,
        });

        const createRes = await client.mutate("xmc.contentTransfer.createContentTransfer", {
          params: {
            body: {
              transferId: config.transferId,
              configuration: {
                dataTrees: config.dataTrees,
              },
            },
            query: { sitecoreContextId: config.sourceContextId },
          },
        });
        const createResAny = createRes as unknown as { error?: unknown; data?: unknown };
        log("Step1", `createContentTransfer response`, createResAny);
        if (createResAny.error) {
          logError("Step1", "createContentTransfer failed", createResAny.error);
          throw new Error(
            `createContentTransfer failed: ${JSON.stringify(createResAny.error)}`
          );
        }
        log("Step1", `✓ Transfer created on source`);

        if (abortRef.current) throw new Error("Transfer aborted");

        // ── Step 2: Poll until source finishes packaging ───────────────────
        setPhase("preparing");
        setProgress(10);
        log("Step2", `Waiting for source to finish packaging...`);

        const chunkSets = await pollTransferStatus(
          config.transferId,
          config.sourceContextId
        );
        log("Step2", `✓ Packaging complete — chunk sets`, chunkSets);

        // ── Step 3: Transfer all chunks source → destination ──────────────
        // Per article: for each chunk set, get every chunk from source and save
        // to destination, then call completeChunkSetTransfer + consumeFile.
        // Collect all returned filenames; poll getBlobState AFTER all sets finish.
        setPhase("transferring");

        const totalChunks = chunkSets.reduce((sum, cs) => sum + cs.ChunkCount, 0);
        let completedChunks = 0;
        const transferFileNames: string[] = [];
        log("Step3", `Starting chunk transfer — ${chunkSets.length} chunk set(s), ${totalChunks} total chunk(s)`);

        for (const [csIndex, chunkSet] of chunkSets.entries()) {
          if (abortRef.current) throw new Error("Transfer aborted");
          log("Step3", `Processing chunk set ${csIndex + 1}/${chunkSets.length} — ChunkSetId=${chunkSet.ChunkSetId} ChunkCount=${chunkSet.ChunkCount}`);

          // 3a: Get every chunk from source and save to destination
          for (let chunkIndex = 0; chunkIndex < chunkSet.ChunkCount; chunkIndex++) {
            if (abortRef.current) throw new Error("Transfer aborted");
            log("Step3", `  getChunk ${chunkIndex + 1}/${chunkSet.ChunkCount} — chunksetId=${chunkSet.ChunkSetId}`);

            // Read chunk blob from source
            const chunkRes = await client.query(
              "xmc.contentTransfer.getChunk",
              {
                params: {
                  path: {
                    transferId: config.transferId,
                    chunksetId: chunkSet.ChunkSetId,
                    chunkId: chunkIndex,
                  },
                  query: { sitecoreContextId: config.sourceContextId },
                },
              }
            );

            // client.query() wraps result in QueryResult; actual payload is at .data.data
            // getChunk returns a Blob (raw .raif protobuf binary).
            const rawChunkRes = chunkRes?.data as unknown;
            const chunkBlob = (rawChunkRes as { data?: Blob | File | null })?.data ?? null;
            log("Step3",
              `  getChunk ${chunkIndex} raw response` +
              ` type=${chunkBlob ? (chunkBlob instanceof Blob ? `Blob(type="${(chunkBlob as Blob).type}")` : typeof chunkBlob) : "null"}` +
              ` size=${chunkBlob instanceof Blob ? (chunkBlob as Blob).size : "n/a"}`
            );
            if (!chunkBlob) {
              logError("Step3", `getChunk returned empty blob`, rawChunkRes);
              throw new Error(
                `Failed to retrieve chunk ${chunkIndex} from chunk set ${chunkSet.ChunkSetId}`
              );
            }

            // Send the raw Blob directly — DO NOT convert to ArrayBuffer.
            // The SDK defines saveChunk with bodySerializer:null and
            // Content-Type:application/octet-stream, meaning it passes the body
            // through to fetch without any serialization. ArrayBuffer serialises
            // to {} through JSON.stringify (loses all data), which is what caused
            // the server-side "Maximum call stack size exceeded" — Sitecore was
            // receiving an empty body and its error-handling path recursed.
            // Sending the Blob directly preserves all bytes correctly.
            log("Step3", `  saveChunk ${chunkIndex + 1}/${chunkSet.ChunkCount} → dest (Blob size=${(chunkBlob as Blob).size}) destCtx=${config.destinationContextId}`);
            const saveRes = await client.mutate("xmc.contentTransfer.saveChunk", {
              params: {
                path: {
                  transferId: config.transferId,
                  chunksetId: chunkSet.ChunkSetId,
                  chunkId: chunkIndex,
                },
                body: chunkBlob,
                query: { sitecoreContextId: config.destinationContextId },
              },
            });
            const saveResAny = saveRes as unknown as {
              error?: unknown;
              data?: unknown;
              response?: { status?: number };
            };
            log("Step3", `  saveChunk response`, saveResAny);
            if (saveResAny.error) {
              logError("Step3", `saveChunk failed`, saveResAny.error);
              const httpStatus = saveResAny.response?.status;
              if (httpStatus === 405) {
                throw new Error(
                  `saveChunk returned 405 Method Not Allowed. ` +
                  `The destination environment does not support the Content Transfer API (PUT /content/v1/transfers/.../chunks) through the marketplace SDK proxy. ` +
                  `Sitecore support ticket required. Details: source=${config.sourceContextId}, dest=${config.destinationContextId}, error=${JSON.stringify(saveResAny.error)}`
                );
              }
              throw new Error(
                `saveChunk failed (HTTP ${httpStatus ?? "?"}) for chunk ${chunkIndex} of chunkset ${chunkSet.ChunkSetId}: ${JSON.stringify(saveResAny.error)}`
              );
            }
            log("Step3", `  ✓ Chunk ${chunkIndex} saved`);

            completedChunks++;
            setProgress(20 + Math.round((completedChunks / totalChunks) * 50));
          }

          // 3b: Signal completion of this chunk set → get assembled file name
          log("Step3", `  completeChunkSetTransfer — chunksetId=${chunkSet.ChunkSetId} destCtx=${config.destinationContextId}`);
          const completeRes = await client.mutate(
            "xmc.contentTransfer.completeChunkSetTransfer",
            {
              params: {
                path: {
                  transferId: config.transferId,
                  chunksetId: chunkSet.ChunkSetId,
                },
                query: { sitecoreContextId: config.destinationContextId },
              },
            }
          );
          const completeResAny = completeRes as unknown as {
            data?: { ContentTransferFileName?: string };
            error?: unknown;
          };
          log("Step3", `  completeChunkSetTransfer response`, completeResAny);
          if (completeResAny.error) {
            logError("Step3", "completeChunkSetTransfer failed", completeResAny.error);
            throw new Error(
              `completeChunkSetTransfer failed: ${JSON.stringify(completeResAny.error)}`
            );
          }
          // client.mutate() may surface the JSON body at .data or .data.data
          // depending on SDK version — check both paths defensively.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fileName =
            completeResAny.data?.ContentTransferFileName ??
            (completeResAny.data as any)?.data?.ContentTransferFileName;
          log("Step3", `  ContentTransferFileName=${fileName ?? "(empty)"}`);
          if (!fileName) {
            logError("Step3", "completeChunkSetTransfer returned no ContentTransferFileName", completeResAny);
            throw new Error(
              "completeChunkSetTransfer did not return a ContentTransferFileName"
            );
          }
          log("Step3", `  ✓ Chunk set ${csIndex + 1} assembled — fileName=${fileName}`);

          // 3c: Kick off import of this chunk set's assembled file on destination
          log("Step3", `  consumeFile — fileName=${fileName} destCtx=${config.destinationContextId}`);
          const consumeRes = await client.query("xmc.contentTransfer.consumeFile", {
            params: {
              query: {
                databaseName: "master",
                fileName,
                sitecoreContextId: config.destinationContextId,
              },
            },
          });
          const consumeResAny = (consumeRes?.data as unknown as { error?: unknown } | undefined);
          log("Step3", `  consumeFile response`, consumeResAny);
          if (consumeResAny?.error) {
            logError("Step3", "consumeFile failed", consumeResAny.error);
            throw new Error(
              `consumeFile failed: ${JSON.stringify(consumeResAny.error)}`
            );
          }
          log("Step3", `  ✓ consumeFile queued for import`);

          transferFileNames.push(fileName);
        }

        // ── Step 4: Poll getBlobState for ALL files after all sets complete ──
        // Per article: collect all filenames first, then poll each one.
        setPhase("importing");
        setProgress(75);
        log("Step4", `Polling blob state for ${transferFileNames.length} file(s)`, transferFileNames);

        for (const fileName of transferFileNames) {
          if (abortRef.current) throw new Error("Transfer aborted");
          await pollBlobState(fileName, config.destinationContextId);
        }
        log("Step4", `✓ All blobs processed`);
        setProgress(90);

        // ── Step 5: Delete transfer from BOTH environments ────────────────
        // Per article: "delete transfers on both source and target".
        log("Step5", `Deleting transfer from source — transferId=${config.transferId}`);
        await client.mutate("xmc.contentTransfer.deleteContentTransfer", {
          params: {
            path: { transferId: config.transferId },
            query: { sitecoreContextId: config.sourceContextId },
          },
        });
        log("Step5", `Deleting transfer from destination — transferId=${config.transferId}`);
        await client.mutate("xmc.contentTransfer.deleteContentTransfer", {
          params: {
            path: { transferId: config.transferId },
            query: { sitecoreContextId: config.destinationContextId },
          },
        }).catch((e) => { logWarn("Step5", "Destination cleanup failed (ignored — destination may not have a record)", e); });

        setProgress(100);
        setPhase("completed");
        log("Done", `✓ Transfer complete — transferId=${config.transferId}`);
      } catch (err) {
        if (abortRef.current) {
          log("Abort", "Transfer was cancelled by user");
          setPhase("idle");
          setProgress(0);
        } else {
          logError("Error", "Transfer failed", err);
          setPhase("failed");
          setError(err instanceof Error ? err.message : "Transfer failed");
        }
      } finally {
        isRunningRef.current = false;
      }
    },
    [client]
  );

  const deleteTransfer = useCallback(
    async (tid: string, sourceContextId: string) => {
      try {
        await client.mutate("xmc.contentTransfer.deleteContentTransfer", {
          params: {
            path: { transferId: tid },
            query: { sitecoreContextId: sourceContextId },
          },
        });
      } catch {
        // Best-effort cleanup, ignore errors
      }
    },
    [client]
  );

  const reset = useCallback(() => {
    abortRef.current = true;
    setPhase("idle");
    setProgress(0);
    setError(null);
    setTransferId(null);
    setChunkSetsMetadata([]);
  }, []);

  return {
    phase,
    progress,
    error,
    transferId,
    chunkSetsMetadata,
    isRunning:
      phase === "creating" ||
      phase === "preparing" ||
      phase === "transferring" ||
      phase === "importing",
    startTransfer,
    deleteTransfer,
    reset,
  };
}
