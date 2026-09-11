"use client";

import { useMarketplaceClient } from "@/components/providers/marketplace";
import type {
  ChunkSetMetadata,
  TransferConfig,
  TransferPhase,
} from "@/lib/content-transfer";
import { isMediaPath } from "@/lib/content-transfer";
import {
  completeChunkSet,
  consumeFileWithRetry,
  createLogger,
  deleteTransferQuietly,
  getChunkWithRetry,
  pollBlobState,
  pollTransferStatus,
  saveChunkWithRetry,
} from "@/lib/content-transfer-primitives";
import { useCallback, useRef, useState } from "react";

const { log, logError, logWarn } = createLogger("[ContentTransfer]");

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
  const [chunkSetsMetadata, setChunkSetsMetadata] = useState<
    ChunkSetMetadata[]
  >([]);
  const abortRef = useRef(false);
  // Prevents two concurrent startTransfer calls (e.g. React StrictMode double-effect)
  const isRunningRef = useRef(false);

  const logger = { log, logWarn, logError };
  const shouldAbort = () => abortRef.current;

  // ── Single sub-transfer orchestration ────────────────────────────────────
  // Runs Steps 1–5 for one sub-transfer config.
  // progressOffset + progressShare define the slice of 0–100 this sub-transfer occupies.

  async function runSingleTransfer(
    subConfig: TransferConfig,
    isMedia: boolean,
    progressOffset: number,
    progressShare: number,
    label: string, // e.g. "[media]" or "[content]"
  ): Promise<void> {
    // ── Step 1: Create transfer on source ──────────────────────────────
    setPhase("creating");
    setProgress(progressOffset + Math.round(progressShare * 0.02));
    log(`Step1${label}`, `Creating transfer on source`, {
      transferId: subConfig.transferId,
      sourceContextId: subConfig.sourceContextId,
      destinationContextId: subConfig.destinationContextId,
      dataTrees: subConfig.dataTrees,
      isMedia,
    });

    const createRes = await client.mutate(
      "xmc.contentTransfer.createContentTransfer",
      {
        params: {
          body: {
            transferId: subConfig.transferId,
            configuration: {
              dataTrees: subConfig.dataTrees,
            },
          },
          query: { sitecoreContextId: subConfig.sourceContextId },
        },
      },
    );
    const createResAny = createRes as unknown as {
      error?: unknown;
      data?: unknown;
    };
    log(`Step1${label}`, `createContentTransfer response`, createResAny);
    if (createResAny.error) {
      logError(
        `Step1${label}`,
        "createContentTransfer failed",
        createResAny.error,
      );
      throw new Error(
        `createContentTransfer failed: ${JSON.stringify(createResAny.error)}`,
      );
    }
    log(`Step1${label}`, `✓ Transfer created on source`);

    if (abortRef.current) throw new Error("Transfer aborted");

    // ── Step 2: Poll until source finishes packaging ───────────────────
    setPhase("preparing");
    setProgress(progressOffset + Math.round(progressShare * 0.1));
    log(`Step2${label}`, `Waiting for source to finish packaging...`);

    const chunkSets = await pollTransferStatus(client, {
      transferId: subConfig.transferId,
      sourceContextId: subConfig.sourceContextId,
      shouldAbort,
      logger,
      onChunkSets: (sets) => setChunkSetsMetadata((prev) => [...prev, ...sets]),
    });
    log(`Step2${label}`, `✓ Packaging complete — chunk sets`, chunkSets);

    // ── Step 3: Transfer all chunks source → destination ──────────────
    setPhase("transferring");

    const totalChunks = chunkSets.reduce((sum, cs) => sum + cs.ChunkCount, 0);
    let completedChunks = 0;
    const transferFileNames: string[] = [];
    log(
      `Step3${label}`,
      `Starting chunk transfer — ${chunkSets.length} chunk set(s), ${totalChunks} total chunk(s), isMedia=${isMedia}`,
    );

    for (const [csIndex, chunkSet] of chunkSets.entries()) {
      if (abortRef.current) throw new Error("Transfer aborted");
      log(
        `Step3${label}`,
        `Processing chunk set ${csIndex + 1}/${chunkSets.length} — ChunkSetId=${chunkSet.ChunkSetId} ChunkCount=${chunkSet.ChunkCount}`,
      );

      // 3a: Get every chunk from source and save to destination.
      // Chunks are forwarded 1:1 with identical chunkIds — the API requires
      // the exact byte stream from getChunk to be sent to saveChunk unaltered
      // (no re-chunking, no re-encoding; first chunk carries a header, media
      // is compressed, content is encrypted).
      for (let chunkIndex = 0; chunkIndex < chunkSet.ChunkCount; chunkIndex++) {
        if (abortRef.current) throw new Error("Transfer aborted");

        const chunkBlob = await getChunkWithRetry(client, {
          transferId: subConfig.transferId,
          chunksetId: chunkSet.ChunkSetId,
          chunkId: chunkIndex,
          sourceContextId: subConfig.sourceContextId,
          label,
          logNote: `${chunkIndex + 1}/${chunkSet.ChunkCount}`,
          shouldAbort,
          logger,
        });

        // Send the raw Blob directly — DO NOT convert to ArrayBuffer.
        // The SDK defines saveChunk with bodySerializer:null and
        // Content-Type:application/octet-stream, meaning it passes the body
        // through to fetch without any serialization. ArrayBuffer serialises
        // to {} through JSON.stringify (loses all data), which is what caused
        // the server-side "Maximum call stack size exceeded" — Sitecore was
        // receiving an empty body and its error-handling path recursed.
        // isMedia must be explicitly passed — omitting the parameter (even though
        // the API spec marks it optional with default false) causes a 405 error.
        await saveChunkWithRetry(client, {
          transferId: subConfig.transferId,
          chunksetId: chunkSet.ChunkSetId,
          chunkId: chunkIndex,
          body: chunkBlob,
          destinationContextId: subConfig.destinationContextId,
          isMedia,
          label,
          logNote: `${chunkIndex + 1}/${chunkSet.ChunkCount}`,
          shouldAbort,
          logger,
        });
        log(`Step3${label}`, `  ✓ Chunk ${chunkIndex} saved`);

        completedChunks++;
        // Map chunk progress into this sub-transfer's share of the overall bar
        const chunkProgress = Math.round(
          (completedChunks / totalChunks) * (progressShare * 0.5),
        );
        setProgress(
          progressOffset + Math.round(progressShare * 0.2) + chunkProgress,
        );
      }

      // 3b: Signal completion of this chunk set → get assembled file name
      const fileName = await completeChunkSet(client, {
        transferId: subConfig.transferId,
        chunksetId: chunkSet.ChunkSetId,
        destinationContextId: subConfig.destinationContextId,
        label,
        logger,
      });
      log(
        `Step3${label}`,
        `  ✓ Chunk set ${csIndex + 1} assembled — fileName=${fileName}`,
      );

      // 3c: Kick off import of this chunk set's assembled file on destination
      await consumeFileWithRetry(client, {
        fileName,
        destinationContextId: subConfig.destinationContextId,
        label,
        shouldAbort,
        logger,
      });

      // Push the RAW file name for Step 4 blob-state polling.
      // Do NOT push the blob://-prefixed form — that prefix is only valid for
      // consumeFile. GetBlobState resolves the string as a literal Azure blob
      // name, so the prefixed form always returns 404 BlobNotFound.
      transferFileNames.push(fileName);
    }

    // ── Step 4: Poll getBlobState for ALL files after all sets complete ──
    setPhase("importing");
    setProgress(progressOffset + Math.round(progressShare * 0.75));
    log(
      `Step4${label}`,
      `Polling blob state for ${transferFileNames.length} file(s)`,
      transferFileNames,
    );

    for (const fileName of transferFileNames) {
      if (abortRef.current) throw new Error("Transfer aborted");
      await pollBlobState(client, {
        fileName,
        destinationContextId: subConfig.destinationContextId,
        shouldAbort,
        logger,
      });
    }
    log(`Step4${label}`, `✓ All blobs processed`);
    setProgress(progressOffset + Math.round(progressShare * 0.9));

    // ── Step 5: Delete transfer from BOTH environments ────────────────
    log(
      `Step5${label}`,
      `Deleting transfer from source — transferId=${subConfig.transferId}`,
    );
    await deleteTransferQuietly(client, {
      transferId: subConfig.transferId,
      contextId: subConfig.sourceContextId,
      side: "source",
      label,
      logger,
    });

    // The destination never created a transfer record, so this is best-effort
    // parity cleanup only — a 400/404 here is the expected response.
    await deleteTransferQuietly(client, {
      transferId: subConfig.transferId,
      contextId: subConfig.destinationContextId,
      side: "destination",
      label,
      logger,
    });

    log(
      `Done${label}`,
      `✓ Sub-transfer complete — transferId=${subConfig.transferId}`,
    );
  }

  // ── Failure/abort cleanup ─────────────────────────────────────────────────
  // Best-effort removal of a sub-transfer's staged resources (chunksets,
  // chunk data) from BOTH environments. Called when a sub-transfer fails or
  // is aborted so gigabytes of staged chunk data don't linger. Errors are
  // logged and swallowed — cleanup must never mask the original failure.
  // Note: this does NOT remove consumed .raif sources on the destination
  // (renamed "consumed.*" after consumeFile); those are retained by design
  // for the Item Transfer API's history/retry and require
  // DELETE /sources/blobs/{blobName} (v3 Item Transfer API) to purge.
  async function cleanupSubTransfer(
    subConfig: TransferConfig,
    label: string,
  ): Promise<void> {
    for (const [ctx, side] of [
      [subConfig.sourceContextId, "source"],
      [subConfig.destinationContextId, "destination"],
    ] as const) {
      await deleteTransferQuietly(client, {
        transferId: subConfig.transferId,
        contextId: ctx,
        side,
        label,
        logger,
      });
    }
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
        // Split dataTrees into media and content groups
        const mediaTrees = config.dataTrees.filter((dt) =>
          isMediaPath(dt.itemPath),
        );
        const contentTrees = config.dataTrees.filter(
          (dt) => !isMediaPath(dt.itemPath),
        );

        const subTransfers: Array<{
          subConfig: TransferConfig;
          isMedia: boolean;
          label: string;
        }> = [];
        if (mediaTrees.length > 0) {
          subTransfers.push({
            subConfig: {
              ...config,
              transferId: crypto.randomUUID(),
              dataTrees: mediaTrees,
            },
            isMedia: true,
            label: "[media]",
          });
        }
        if (contentTrees.length > 0) {
          subTransfers.push({
            subConfig: { ...config, dataTrees: contentTrees },
            isMedia: false,
            label:
              contentTrees.length < config.dataTrees.length ? "[content]" : "",
          });
        }

        log(
          "Start",
          `Transfer split — ${mediaTrees.length} media tree(s), ${contentTrees.length} content tree(s), ${subTransfers.length} sub-transfer(s)`,
        );

        const progressShare = Math.floor(100 / subTransfers.length);

        for (const [
          i,
          { subConfig, isMedia, label },
        ] of subTransfers.entries()) {
          if (abortRef.current) throw new Error("Transfer aborted");
          const progressOffset = i * progressShare;
          try {
            await runSingleTransfer(
              subConfig,
              isMedia,
              progressOffset,
              progressShare,
              label,
            );
          } catch (err) {
            // Failed or aborted mid-flight: remove staged transfer resources
            // from both environments (best-effort), then surface the error.
            // Without this, failed transfers leave the operation and its
            // staged chunk data parked on both sides — and the media
            // sub-transfer's generated transferId would be unrecoverable.
            await cleanupSubTransfer(subConfig, label);
            throw err;
          }
        }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client],
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
    [client],
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
