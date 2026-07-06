"use client";

import { useMarketplaceClient } from "@/components/providers/marketplace";
import type {
  BlobStateResponse,
  ChunkSetMetadata,
  ContentTransferStatus,
  TransferConfig,
  TransferPhase,
} from "@/lib/content-transfer";
import { isMediaPath } from "@/lib/content-transfer";
import { useCallback, useRef, useState } from "react";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 120; // 6 minutes max
const SAVE_CHUNK_MAX_RETRIES = 3;
const SAVE_CHUNK_RETRY_BASE_MS = 2000; // exponential: 2s, 4s, 8s
const GET_CHUNK_MAX_RETRIES = 3;
const GET_CHUNK_RETRY_BASE_MS = 2000;

// NOTE ON LARGE CHUNKS (90+ MB media chunks observed):
// Chunk size is decided entirely by the source environment's packaging —
// createContentTransfer exposes no chunk-size option. Chunks MUST be forwarded
// 1:1 between getChunk and saveChunk: the API docs state "Do not alter, wrap,
// re-encode or chunk the stream; forward it exactly as received" (the first
// chunk of a set also carries a header, media chunks are compressed, content
// chunks are encrypted). Client-side re-slicing is therefore NOT allowed.
//
// The failure mode for large chunks is the marketplace SDK bridge's ~30s
// default request timeout, which is applied at the PostMessage layer and does
// NOT honor the per-call timeoutMs (observed: timeoutMs=360000 passed,
// CoreError.timeout fired at exactly 30s, while the host later logged
// "Processed generic api request" — the operation itself succeeded).
// Fix: raise the bridge default timeout in @sitecore-marketplace-sdk/core
// (patch-package) until the SDK honors per-request timeouts. The retries
// below help with transient failures but cannot outwait a hard 30s ceiling
// on a >30s transfer.
// Large binary chunks can take minutes to download/upload through the PostMessage bridge.
// The SDK default is 30s which is too short — use 6 minutes per chunk operation.
const CHUNK_TRANSFER_TIMEOUT_MS = 6 * 60 * 1000;

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
  const [chunkSetsMetadata, setChunkSetsMetadata] = useState<
    ChunkSetMetadata[]
  >([]);
  const abortRef = useRef(false);
  // Prevents two concurrent startTransfer calls (e.g. React StrictMode double-effect)
  const isRunningRef = useRef(false);

  // ── Helpers ──────────────────────────────────────────────────────────────

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function pollTransferStatus(
    tid: string,
    srcCtx: string,
  ): Promise<ChunkSetMetadata[]> {
    log(
      "PollStatus",
      `Polling transfer status — transferId=${tid} srcCtx=${srcCtx}`,
    );
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
        },
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
      log(
        "PollStatus",
        `State=${data.State} ChunkSets=${data.ChunkSetsMetadata?.length ?? 0}`,
      );
      if (data.ChunkSetsMetadata?.length) {
        setChunkSetsMetadata((prev) => [...prev, ...data.ChunkSetsMetadata]);
      }
      if (data.State === "Failed") {
        logError("PollStatus", "Packaging failed on source", data);
        throw new Error("Content packaging failed on source environment");
      }
      if (data.State === "Completed" && data.ChunkSetsMetadata?.length) {
        log(
          "PollStatus",
          `✓ Packaging complete — ${data.ChunkSetsMetadata.length} chunk set(s)`,
          data.ChunkSetsMetadata,
        );
        return data.ChunkSetsMetadata;
      }
    }
    throw new Error("Transfer status polling timed out");
  }

  // IMPORTANT: `fileName` must be the RAW blob name (e.g. "contentTransfer-....raif"),
  // WITHOUT the "blob://" scheme prefix. The Item Transfer API addresses blob sources
  // by their plain name everywhere (GET /sources/blobs/{blobName}); the scheme prefix
  // is only understood by consumeFile. Passing "blob://..." here makes the backend
  // look up an Azure blob literally named "blob://..." → 404 BlobNotFound.
  async function pollBlobState(
    fileName: string,
    destCtx: string,
  ): Promise<void> {
    log(
      "PollBlob",
      `Polling blob state — fileName=${fileName} destCtx=${destCtx}`,
    );
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
      const blobState =
        data.BlobState ?? (data as unknown as { status?: string }).status;
      const blobError =
        data.Error ?? (data as unknown as { details?: unknown }).details;
      log(
        "PollBlob",
        `status/BlobState=${blobState ?? "(none)"} error/details=${blobError ?? "(none)"}`,
      );
      if (blobState === "Error") {
        const errMsg =
          typeof blobError === "string"
            ? blobError
            : JSON.stringify(blobError ?? "");
        // Once the import worker picks up a consumed source, it renames the blob
        // to a "consumed.<timestamp>.<guid>" name — so the original blob name can
        // legitimately return 404 BlobNotFound mid/post-import. After a successful
        // consumeFile, absence of the original blob means the import has STARTED,
        // not that it failed. (A genuine import failure surfaces in the Item
        // Transfer API's transfers list with state "Failed", not as BlobNotFound.)
        if (errMsg.includes("BlobNotFound")) {
          log(
            "PollBlob",
            `✓ Blob no longer present — consumed by import worker: ${fileName}`,
          );
          return;
        }
        logError("PollBlob", "Import failed on destination", data);
        throw new Error(`Import failed: ${errMsg}`);
      }
      if (
        blobState === "Completed" ||
        blobState === "OK" ||
        blobState === "Transferred" ||
        blobState === "Consumed" ||
        // A populated ConsumedName means the source was renamed to its
        // "consumed.*" name and handed to the import pipeline.
        Boolean(
          (data as unknown as { ConsumedName?: string | null }).ConsumedName,
        )
      ) {
        log("PollBlob", `✓ Blob processed — fileName=${fileName}`);
        return;
      }
    }
    throw new Error("Blob state polling timed out");
  }

  // ── saveChunk with retry ──────────────────────────────────────────────────
  // Retries transient failures: HTTP 5xx responses AND bridge-level timeout
  // exceptions (CoreError "[client SDK] Request timed out"), which client.mutate
  // THROWS rather than returning in .error. 405 and other 4xx fail fast.
  async function saveChunkWithRetry(opts: {
    transferId: string;
    chunksetId: string;
    chunkId: number;
    body: Blob;
    destinationContextId: string;
    isMedia: boolean;
    label: string;
    logNote: string;
  }): Promise<void> {
    const {
      transferId,
      chunksetId,
      chunkId,
      body,
      destinationContextId,
      isMedia,
      label,
      logNote,
    } = opts;
    log(
      `Step3${label}`,
      `  saveChunk ${logNote} → dest (Blob size=${body.size}) chunkId=${chunkId} isMedia=${isMedia} destCtx=${destinationContextId}`,
    );
    for (let attempt = 0; attempt <= SAVE_CHUNK_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delayMs = SAVE_CHUNK_RETRY_BASE_MS * Math.pow(2, attempt - 1);
        logWarn(
          `Step3${label}`,
          `  saveChunk retry ${attempt}/${SAVE_CHUNK_MAX_RETRIES} after ${delayMs}ms — chunkId=${chunkId}`,
        );
        await sleep(delayMs);
      }
      if (abortRef.current) throw new Error("Transfer aborted");

      let saveResAny: {
        error?: unknown;
        data?: unknown;
        response?: { status?: number };
      };
      try {
        const saveRes = await client.mutate("xmc.contentTransfer.saveChunk", {
          params: {
            path: { transferId, chunksetId, chunkId },
            body,
            query: { sitecoreContextId: destinationContextId, isMedia },
          },
          timeoutMs: CHUNK_TRANSFER_TIMEOUT_MS,
        });
        saveResAny = saveRes as unknown as {
          error?: unknown;
          data?: unknown;
          response?: { status?: number };
        };
      } catch (err) {
        // Bridge timeout (or other thrown transport error). The per-call
        // timeoutMs is not honored by the PostMessage bridge (~30s default),
        // so large/slow uploads can land here. Treat as retryable.
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === SAVE_CHUNK_MAX_RETRIES) {
          logError(
            `Step3${label}`,
            `saveChunk threw after ${attempt + 1} attempts — chunkId=${chunkId}`,
            err,
          );
          throw new Error(
            `saveChunk failed for chunk ${chunkId} of chunkset ${chunksetId}: ${msg}. ` +
              `If this is a bridge timeout on a large chunk, the SDK bridge's 30s default timeout must be raised (see NOTE ON LARGE CHUNKS).`,
          );
        }
        logWarn(
          `Step3${label}`,
          `  saveChunk transient exception (${msg}), will retry — chunkId=${chunkId}`,
        );
        continue;
      }

      log(
        `Step3${label}`,
        `  saveChunk attempt ${attempt + 1} response`,
        saveResAny,
      );
      if (!saveResAny.error) return;

      const httpStatus = saveResAny.response?.status;
      if (httpStatus === 405) {
        logError(`Step3${label}`, `saveChunk failed`, saveResAny.error);
        throw new Error(
          `saveChunk returned 405 Method Not Allowed (isMedia=${isMedia}). ` +
            `The destination environment does not support the Content Transfer API (PUT /content/v1/transfers/.../chunks) through the marketplace SDK proxy. ` +
            `Sitecore support ticket required. Details: dest=${destinationContextId}, error=${JSON.stringify(saveResAny.error)}`,
        );
      }
      const isRetryable = typeof httpStatus === "number" && httpStatus >= 500;
      if (!isRetryable || attempt === SAVE_CHUNK_MAX_RETRIES) {
        logError(`Step3${label}`, `saveChunk failed`, saveResAny.error);
        throw new Error(
          `saveChunk failed (HTTP ${httpStatus ?? "?"}) for chunk ${chunkId} of chunkset ${chunksetId}: ${JSON.stringify(saveResAny.error)}`,
        );
      }
      logWarn(
        `Step3${label}`,
        `  saveChunk transient error (HTTP ${httpStatus}), will retry`,
        saveResAny.error,
      );
    }
  }

  // ── getChunk with retry ───────────────────────────────────────────────────
  // Downloads one chunk from the source. Retries thrown bridge timeouts and
  // empty responses. Note: the host completes the underlying fetch even after
  // the client bridge times out, so a retry may succeed quickly if the server
  // has the chunk warm — but a hard 30s bridge ceiling cannot be outwaited for
  // a genuinely >30s download (see NOTE ON LARGE CHUNKS at the top).
  async function getChunkWithRetry(opts: {
    transferId: string;
    chunksetId: string;
    chunkId: number;
    sourceContextId: string;
    label: string;
    logNote: string;
  }): Promise<Blob> {
    const { transferId, chunksetId, chunkId, sourceContextId, label, logNote } =
      opts;
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= GET_CHUNK_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delayMs = GET_CHUNK_RETRY_BASE_MS * Math.pow(2, attempt - 1);
        logWarn(
          `Step3${label}`,
          `  getChunk retry ${attempt}/${GET_CHUNK_MAX_RETRIES} after ${delayMs}ms — chunkId=${chunkId}`,
        );
        await sleep(delayMs);
      }
      if (abortRef.current) throw new Error("Transfer aborted");
      log(
        `Step3${label}`,
        `  getChunk ${logNote} — chunksetId=${chunksetId} chunkId=${chunkId} (attempt ${attempt + 1})`,
      );
      try {
        const chunkRes = await client.query("xmc.contentTransfer.getChunk", {
          params: {
            path: { transferId, chunksetId, chunkId },
            query: { sitecoreContextId: sourceContextId },
          },
          timeoutMs: CHUNK_TRANSFER_TIMEOUT_MS,
        });
        // client.query() wraps result in QueryResult; actual payload is at .data.data
        // getChunk returns a Blob (raw .raif protobuf binary).
        const rawChunkRes = chunkRes?.data as unknown;
        const chunkBlob =
          (rawChunkRes as { data?: Blob | File | null })?.data ?? null;
        const chunkHttpRes = (
          rawChunkRes as { response?: { status?: number; headers?: Headers } }
        )?.response;
        log(
          `Step3${label}`,
          `  getChunk ${chunkId} raw response` +
            ` httpStatus=${chunkHttpRes?.status ?? "?"}` +
            ` content-type=${chunkHttpRes?.headers?.get?.("content-type") ?? "?"}` +
            ` type=${chunkBlob ? (chunkBlob instanceof Blob ? `Blob(type="${(chunkBlob as Blob).type}")` : typeof chunkBlob) : "null"}` +
            ` size=${chunkBlob instanceof Blob ? (chunkBlob as Blob).size : "n/a"}`,
          rawChunkRes,
        );
        if (chunkBlob instanceof Blob && chunkBlob.size > 0) {
          return chunkBlob;
        }
        lastError = new Error("getChunk returned empty blob");
        logWarn(
          `Step3${label}`,
          `  getChunk returned empty/invalid blob, will retry — chunkId=${chunkId}`,
          rawChunkRes,
        );
      } catch (err) {
        // Bridge timeout or transport error thrown by client.query — the
        // per-call timeoutMs is not honored by the PostMessage bridge.
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        logWarn(
          `Step3${label}`,
          `  getChunk transient exception (${msg}), will retry — chunkId=${chunkId}`,
        );
      }
    }
    logError(
      `Step3${label}`,
      `getChunk failed after ${GET_CHUNK_MAX_RETRIES + 1} attempts — chunkId=${chunkId}`,
      lastError,
    );
    throw new Error(
      `Failed to retrieve chunk ${chunkId} from chunk set ${chunksetId}: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }. If this is a bridge timeout on a large chunk, the SDK bridge's 30s default timeout must be raised (see NOTE ON LARGE CHUNKS).`,
    );
  }

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

    const chunkSets = await pollTransferStatus(
      subConfig.transferId,
      subConfig.sourceContextId,
    );
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

        const chunkBlob = await getChunkWithRetry({
          transferId: subConfig.transferId,
          chunksetId: chunkSet.ChunkSetId,
          chunkId: chunkIndex,
          sourceContextId: subConfig.sourceContextId,
          label,
          logNote: `${chunkIndex + 1}/${chunkSet.ChunkCount}`,
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
        await saveChunkWithRetry({
          transferId: subConfig.transferId,
          chunksetId: chunkSet.ChunkSetId,
          chunkId: chunkIndex,
          body: chunkBlob,
          destinationContextId: subConfig.destinationContextId,
          isMedia,
          label,
          logNote: `${chunkIndex + 1}/${chunkSet.ChunkCount}`,
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
      log(
        `Step3${label}`,
        `  completeChunkSetTransfer — chunksetId=${chunkSet.ChunkSetId} destCtx=${subConfig.destinationContextId}`,
      );
      const completeRes = await client.mutate(
        "xmc.contentTransfer.completeChunkSetTransfer",
        {
          params: {
            path: {
              transferId: subConfig.transferId,
              chunksetId: chunkSet.ChunkSetId,
            },
            query: { sitecoreContextId: subConfig.destinationContextId },
          },
        },
      );
      const completeResAny = completeRes as unknown as {
        data?: { ContentTransferFileName?: string };
        error?: unknown;
      };
      log(
        `Step3${label}`,
        `  completeChunkSetTransfer response`,
        completeResAny,
      );
      if (completeResAny.error) {
        logError(
          `Step3${label}`,
          "completeChunkSetTransfer failed",
          completeResAny.error,
        );
        throw new Error(
          `completeChunkSetTransfer failed: ${JSON.stringify(completeResAny.error)}`,
        );
      }
      // client.mutate() may surface the JSON body at .data or .data.data
      // depending on SDK version — check both paths defensively.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fileName =
        completeResAny.data?.ContentTransferFileName ??
        (completeResAny.data as any)?.data?.ContentTransferFileName;
      log(
        `Step3${label}`,
        `  ContentTransferFileName=${fileName ?? "(empty)"}`,
      );
      if (!fileName) {
        logError(
          `Step3${label}`,
          "completeChunkSetTransfer returned no ContentTransferFileName",
          completeResAny,
        );
        throw new Error(
          "completeChunkSetTransfer did not return a ContentTransferFileName",
        );
      }
      log(
        `Step3${label}`,
        `  ✓ Chunk set ${csIndex + 1} assembled — fileName=${fileName}`,
      );

      // 3c: Kick off import of this chunk set's assembled file on destination
      // Both media and content use blob:// — file:// is only for on-disk file system transfers.
      const consumeFileName = `blob://${fileName}`;
      log(
        `Step3${label}`,
        `  consumeFile — fileName=${consumeFileName} destCtx=${subConfig.destinationContextId}`,
      );
      // completeChunkSetTransfer triggers async server-side file assembly and returns
      // immediately — the .raif file may not exist yet when consumeFile is first called.
      // Wait one full poll interval before the first attempt, then retry with backoff.
      {
        const MAX_CONSUME_ATTEMPTS = 10;
        let consumed = false;
        // Initial delay: give the server time to finish assembling before the first call.
        await sleep(POLL_INTERVAL_MS);
        for (let attempt = 1; attempt <= MAX_CONSUME_ATTEMPTS; attempt++) {
          if (attempt > 1) await sleep(POLL_INTERVAL_MS);
          if (abortRef.current) throw new Error("Transfer aborted");
          const consumeRes = await client.query(
            "xmc.contentTransfer.consumeFile",
            {
              params: {
                query: {
                  databaseName: "master",
                  fileName: consumeFileName,
                  sitecoreContextId: subConfig.destinationContextId,
                },
              },
            },
          );
          const consumeResAny = consumeRes?.data as unknown as
            | { error?: { Message?: string } }
            | undefined;
          log(
            `Step3${label}`,
            `  consumeFile attempt ${attempt}/${MAX_CONSUME_ATTEMPTS} response`,
            consumeResAny,
          );
          if (consumeResAny?.error) {
            const msg =
              consumeResAny.error.Message ??
              JSON.stringify(consumeResAny.error);
            if (msg.toLowerCase().includes("does not exist")) {
              logWarn(
                `Step3${label}`,
                `  consumeFile — file not ready yet, retrying (${attempt}/${MAX_CONSUME_ATTEMPTS})`,
                consumeResAny.error,
              );
              continue;
            }
            logError(
              `Step3${label}`,
              "consumeFile failed",
              consumeResAny.error,
            );
            throw new Error(
              `consumeFile failed: ${JSON.stringify(consumeResAny.error)}`,
            );
          }
          log(`Step3${label}`, `  ✓ consumeFile queued for import`);
          consumed = true;
          break;
        }
        if (!consumed)
          throw new Error(
            `consumeFile: file not ready after ${MAX_CONSUME_ATTEMPTS} attempts (~${Math.round(((MAX_CONSUME_ATTEMPTS + 1) * POLL_INTERVAL_MS) / 1000)}s) — ${consumeFileName}`,
          );
      }

      // Push the RAW file name for Step 4 blob-state polling.
      // Do NOT push consumeFileName — the "blob://" prefix is only valid for
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
      await pollBlobState(fileName, subConfig.destinationContextId);
    }
    log(`Step4${label}`, `✓ All blobs processed`);
    setProgress(progressOffset + Math.round(progressShare * 0.9));

    // ── Step 5: Delete transfer from BOTH environments ────────────────
    log(
      `Step5${label}`,
      `Deleting transfer from source — transferId=${subConfig.transferId}`,
    );
    const deleteSourceRes = await client.mutate(
      "xmc.contentTransfer.deleteContentTransfer",
      {
        params: {
          path: { transferId: subConfig.transferId },
          query: { sitecoreContextId: subConfig.sourceContextId },
        },
      },
    );
    log(
      `Step5${label}`,
      `deleteContentTransfer source response`,
      deleteSourceRes,
    );

    log(
      `Step5${label}`,
      `Deleting transfer from destination — transferId=${subConfig.transferId}`,
    );
    try {
      const deleteDestRes = await client.mutate(
        "xmc.contentTransfer.deleteContentTransfer",
        {
          params: {
            path: { transferId: subConfig.transferId },
            query: { sitecoreContextId: subConfig.destinationContextId },
          },
        },
      );
      log(
        `Step5${label}`,
        `deleteContentTransfer destination response`,
        deleteDestRes,
      );
    } catch (e) {
      logWarn(
        `Step5${label}`,
        "Destination cleanup failed (ignored — destination may not have a record)",
        e,
      );
    }

    log(
      `Done${label}`,
      `✓ Sub-transfer complete — transferId=${subConfig.transferId}`,
    );
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
          await runSingleTransfer(
            subConfig,
            isMedia,
            progressOffset,
            progressShare,
            label,
          );
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
