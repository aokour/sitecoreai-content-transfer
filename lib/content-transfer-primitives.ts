import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import type {
  BlobStateResponse,
  ChunkSetMetadata,
  ContentTransferStatus,
} from "@/lib/content-transfer";

// Shared low-level plumbing for every flow that speaks the Content Transfer
// API: transfer (source → destination), backup (source → local archive) and
// restore (local archive → destination). Everything here takes the SDK client
// as an argument so it can be used outside a React hook.

export const POLL_INTERVAL_MS = 3000;
export const MAX_POLL_ATTEMPTS = 120; // 6 minutes max
export const SAVE_CHUNK_MAX_RETRIES = 3;
export const SAVE_CHUNK_RETRY_BASE_MS = 2000; // exponential: 2s, 4s, 8s
export const GET_CHUNK_MAX_RETRIES = 3;
export const GET_CHUNK_RETRY_BASE_MS = 2000;
export const MAX_CONSUME_ATTEMPTS = 10;

// NOTE ON LARGE CHUNKS (90+ MB media chunks observed):
// Chunk size is decided entirely by the source environment's packaging —
// createContentTransfer exposes no chunk-size option. Chunks MUST be forwarded
// 1:1 between getChunk and saveChunk: the API docs state "Do not alter, wrap,
// re-encode or chunk the stream; forward it exactly as received" (the first
// chunk of a set also carries a header, media chunks are compressed, content
// chunks are encrypted). Client-side re-slicing is therefore NOT allowed.
//
// The PostMessage bridge applies a ~30s default request timeout and does NOT
// honor the per-call timeoutMs passed to client.query/mutate. Large chunks
// take 15-60s+ through the bridge, so the bridge default MUST be raised at
// SDK initialization for this hook to work:
//
//   ClientSDK.init({ target: window.parent, modules: [XMC],
//                    timeout: 10 * 60 * 1000 })
//
// The retries below handle transient failures (5xx, network blips, empty
// responses) but cannot outwait a 30s bridge ceiling on a >30s transfer —
// if chunk transfers time out at exactly 30s, check the init config first.

// Large binary chunks can take minutes to download/upload through the PostMessage bridge.
// The SDK default is 30s which is too short — use 6 minutes per chunk operation.
export const CHUNK_TRANSFER_TIMEOUT_MS = 6 * 60 * 1000;

/** Returns true when the caller wants the in-flight operation to stop. */
export type AbortCheck = () => boolean;

// ── Logging helpers ───────────────────────────────────────────────────────

export interface TransferLogger {
  log(step: string, message: string, data?: unknown): void;
  logWarn(step: string, message: string, data?: unknown): void;
  logError(step: string, message: string, err?: unknown): void;
}

export function createLogger(prefix: string): TransferLogger {
  const stamp = () => new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  return {
    log(step, message, data) {
      if (data !== undefined) {
        console.log(`${prefix} [${stamp()}] [${step}] ${message}`, data);
      } else {
        console.log(`${prefix} [${stamp()}] [${step}] ${message}`);
      }
    },
    logWarn(step, message, data) {
      console.warn(`${prefix} [${stamp()}] [${step}] ⚠ ${message}`, data ?? "");
    },
    logError(step, message, err) {
      console.error(`${prefix} [${stamp()}] [${step}] ✗ ${message}`, err ?? "");
    },
  };
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Polling ───────────────────────────────────────────────────────────────

export async function pollTransferStatus(
  client: ClientSDK,
  opts: {
    transferId: string;
    sourceContextId: string;
    shouldAbort: AbortCheck;
    logger: TransferLogger;
    /** Called with each newly reported batch of chunk-set metadata. */
    onChunkSets?: (sets: ChunkSetMetadata[]) => void;
  },
): Promise<ChunkSetMetadata[]> {
  const { transferId, sourceContextId, shouldAbort, logger, onChunkSets } =
    opts;
  logger.log(
    "PollStatus",
    `Polling transfer status — transferId=${transferId} srcCtx=${sourceContextId}`,
  );
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    if (shouldAbort()) throw new Error("Transfer aborted");
    await sleep(POLL_INTERVAL_MS);
    const res = await client.query(
      "xmc.contentTransfer.getContentTransferStatus",
      {
        params: {
          path: { transferId },
          query: { sitecoreContextId: sourceContextId },
        },
      },
    );
    // client.query() returns QueryResult<K> where .data is the @hey-api response
    // wrapper { data: T, request, response }. The actual payload is at .data.data.
    const rawRes = res?.data as unknown;
    const data = (rawRes as { data?: ContentTransferStatus })?.data;
    logger.log("PollStatus", `Attempt ${attempt + 1} raw response`, rawRes);
    if (!data) {
      logger.logWarn("PollStatus", "No data in response — retrying");
      continue;
    }
    logger.log(
      "PollStatus",
      `State=${data.State} ChunkSets=${data.ChunkSetsMetadata?.length ?? 0}`,
    );
    if (data.ChunkSetsMetadata?.length) {
      onChunkSets?.(data.ChunkSetsMetadata);
    }
    if (data.State === "Failed") {
      logger.logError("PollStatus", "Packaging failed on source", data);
      throw new Error("Content packaging failed on source environment");
    }
    if (data.State === "Completed" && data.ChunkSetsMetadata?.length) {
      logger.log(
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
export async function pollBlobState(
  client: ClientSDK,
  opts: {
    fileName: string;
    destinationContextId: string;
    shouldAbort: AbortCheck;
    logger: TransferLogger;
  },
): Promise<void> {
  const { fileName, destinationContextId, shouldAbort, logger } = opts;
  logger.log(
    "PollBlob",
    `Polling blob state — fileName=${fileName} destCtx=${destinationContextId}`,
  );
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    if (shouldAbort()) throw new Error("Transfer aborted");
    await sleep(POLL_INTERVAL_MS);
    const res = await client.query("xmc.contentTransfer.getBlobState", {
      params: {
        query: { fileName, sitecoreContextId: destinationContextId },
      },
    });
    // client.query() wraps the result in QueryResult; actual payload is at .data.data.
    // OpenAPI spec (content-transfer.yaml) defines the shape as { status, details }.
    // At runtime the API may return { BlobState, Error, Actions, ConsumedName }.
    // We check both field names so we're compatible with either.
    const rawRes = res?.data as unknown;
    const data = (rawRes as { data?: BlobStateResponse })?.data;
    logger.log("PollBlob", `Attempt ${attempt + 1} raw response`, rawRes);
    if (!data) {
      logger.logWarn("PollBlob", "No data in response — retrying");
      continue;
    }
    // Normalise: prefer runtime field, fall back to spec field
    const blobState =
      data.BlobState ?? (data as unknown as { status?: string }).status;
    const blobError =
      data.Error ?? (data as unknown as { details?: unknown }).details;
    logger.log(
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
        logger.log(
          "PollBlob",
          `✓ Blob no longer present — consumed by import worker: ${fileName}`,
        );
        return;
      }
      logger.logError("PollBlob", "Import failed on destination", data);
      throw new Error(`Import failed: ${errMsg}`);
    }
    if (
      blobState === "Completed" ||
      blobState === "OK" ||
      blobState === "Transferred" ||
      blobState === "Consumed" ||
      // A populated ConsumedName means the source was renamed to its
      // "consumed.*" name and handed to the import pipeline.
      Boolean((data as unknown as { ConsumedName?: string | null }).ConsumedName)
    ) {
      logger.log("PollBlob", `✓ Blob processed — fileName=${fileName}`);
      return;
    }
  }
  throw new Error("Blob state polling timed out");
}

// ── saveChunk with retry ──────────────────────────────────────────────────
// Retries transient failures: HTTP 5xx responses AND bridge-level timeout
// exceptions (CoreError "[client SDK] Request timed out"), which client.mutate
// THROWS rather than returning in .error. 405 and other 4xx fail fast.
export async function saveChunkWithRetry(
  client: ClientSDK,
  opts: {
    transferId: string;
    chunksetId: string;
    chunkId: number;
    body: Blob;
    destinationContextId: string;
    isMedia: boolean;
    label: string;
    logNote: string;
    shouldAbort: AbortCheck;
    logger: TransferLogger;
  },
): Promise<void> {
  const {
    transferId,
    chunksetId,
    chunkId,
    body,
    destinationContextId,
    isMedia,
    label,
    logNote,
    shouldAbort,
    logger,
  } = opts;
  logger.log(
    `Step3${label}`,
    `  saveChunk ${logNote} → dest (Blob size=${body.size}) chunkId=${chunkId} isMedia=${isMedia} destCtx=${destinationContextId}`,
  );
  for (let attempt = 0; attempt <= SAVE_CHUNK_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = SAVE_CHUNK_RETRY_BASE_MS * Math.pow(2, attempt - 1);
      logger.logWarn(
        `Step3${label}`,
        `  saveChunk retry ${attempt}/${SAVE_CHUNK_MAX_RETRIES} after ${delayMs}ms — chunkId=${chunkId}`,
      );
      await sleep(delayMs);
    }
    if (shouldAbort()) throw new Error("Transfer aborted");

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
        logger.logError(
          `Step3${label}`,
          `saveChunk threw after ${attempt + 1} attempts — chunkId=${chunkId}`,
          err,
        );
        throw new Error(
          `saveChunk failed for chunk ${chunkId} of chunkset ${chunksetId}: ${msg}. ` +
            `If this is a bridge timeout on a large chunk, the SDK bridge's 30s default timeout must be raised (see NOTE ON LARGE CHUNKS).`,
        );
      }
      logger.logWarn(
        `Step3${label}`,
        `  saveChunk transient exception (${msg}), will retry — chunkId=${chunkId}`,
      );
      continue;
    }

    logger.log(
      `Step3${label}`,
      `  saveChunk attempt ${attempt + 1} response`,
      saveResAny,
    );
    if (!saveResAny.error) return;

    const httpStatus = saveResAny.response?.status;
    if (httpStatus === 405) {
      logger.logError(`Step3${label}`, `saveChunk failed`, saveResAny.error);
      throw new Error(
        `saveChunk returned 405 Method Not Allowed (isMedia=${isMedia}). ` +
          `The destination environment does not support the Content Transfer API (PUT /content/v1/transfers/.../chunks) through the marketplace SDK proxy. ` +
          `Sitecore support ticket required. Details: dest=${destinationContextId}, error=${JSON.stringify(saveResAny.error)}`,
      );
    }
    const isRetryable = typeof httpStatus === "number" && httpStatus >= 500;
    if (!isRetryable || attempt === SAVE_CHUNK_MAX_RETRIES) {
      logger.logError(`Step3${label}`, `saveChunk failed`, saveResAny.error);
      throw new Error(
        `saveChunk failed (HTTP ${httpStatus ?? "?"}) for chunk ${chunkId} of chunkset ${chunksetId}: ${JSON.stringify(saveResAny.error)}`,
      );
    }
    logger.logWarn(
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
export async function getChunkWithRetry(
  client: ClientSDK,
  opts: {
    transferId: string;
    chunksetId: string;
    chunkId: number;
    sourceContextId: string;
    label: string;
    logNote: string;
    shouldAbort: AbortCheck;
    logger: TransferLogger;
  },
): Promise<Blob> {
  const {
    transferId,
    chunksetId,
    chunkId,
    sourceContextId,
    label,
    logNote,
    shouldAbort,
    logger,
  } = opts;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= GET_CHUNK_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = GET_CHUNK_RETRY_BASE_MS * Math.pow(2, attempt - 1);
      logger.logWarn(
        `Step3${label}`,
        `  getChunk retry ${attempt}/${GET_CHUNK_MAX_RETRIES} after ${delayMs}ms — chunkId=${chunkId}`,
      );
      await sleep(delayMs);
    }
    if (shouldAbort()) throw new Error("Transfer aborted");
    logger.log(
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
      logger.log(
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
      logger.logWarn(
        `Step3${label}`,
        `  getChunk returned empty/invalid blob, will retry — chunkId=${chunkId}`,
        rawChunkRes,
      );
    } catch (err) {
      // Bridge timeout or transport error thrown by client.query — the
      // per-call timeoutMs is not honored by the PostMessage bridge.
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      logger.logWarn(
        `Step3${label}`,
        `  getChunk transient exception (${msg}), will retry — chunkId=${chunkId}`,
      );
    }
  }
  logger.logError(
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

// ── Chunk set completion ──────────────────────────────────────────────────

/** Signals a chunk set complete on the destination and returns the assembled
 *  .raif file name. */
export async function completeChunkSet(
  client: ClientSDK,
  opts: {
    transferId: string;
    chunksetId: string;
    destinationContextId: string;
    label: string;
    logger: TransferLogger;
  },
): Promise<string> {
  const { transferId, chunksetId, destinationContextId, label, logger } = opts;
  logger.log(
    `Step3${label}`,
    `  completeChunkSetTransfer — chunksetId=${chunksetId} destCtx=${destinationContextId}`,
  );
  const completeRes = await client.mutate(
    "xmc.contentTransfer.completeChunkSetTransfer",
    {
      params: {
        path: { transferId, chunksetId },
        query: { sitecoreContextId: destinationContextId },
      },
    },
  );
  const completeResAny = completeRes as unknown as {
    data?: { ContentTransferFileName?: string };
    error?: unknown;
  };
  logger.log(`Step3${label}`, `  completeChunkSetTransfer response`, completeResAny);
  if (completeResAny.error) {
    logger.logError(
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
  const fileName =
    completeResAny.data?.ContentTransferFileName ??
    (
      completeResAny.data as unknown as {
        data?: { ContentTransferFileName?: string };
      }
    )?.data?.ContentTransferFileName;
  logger.log(`Step3${label}`, `  ContentTransferFileName=${fileName ?? "(empty)"}`);
  if (!fileName) {
    logger.logError(
      `Step3${label}`,
      "completeChunkSetTransfer returned no ContentTransferFileName",
      completeResAny,
    );
    throw new Error(
      "completeChunkSetTransfer did not return a ContentTransferFileName",
    );
  }
  return fileName;
}

// ── consumeFile with retry ────────────────────────────────────────────────
// completeChunkSetTransfer triggers async server-side file assembly and returns
// immediately — the .raif file may not exist yet when consumeFile is first called.
// Wait one full poll interval before the first attempt, then retry with backoff.
export async function consumeFileWithRetry(
  client: ClientSDK,
  opts: {
    /** RAW blob name; the "blob://" prefix is added here. */
    fileName: string;
    destinationContextId: string;
    label: string;
    shouldAbort: AbortCheck;
    logger: TransferLogger;
  },
): Promise<void> {
  const { fileName, destinationContextId, label, shouldAbort, logger } = opts;
  // Both media and content use blob:// — file:// is only for on-disk file system transfers.
  const consumeFileName = `blob://${fileName}`;
  logger.log(
    `Step3${label}`,
    `  consumeFile — fileName=${consumeFileName} destCtx=${destinationContextId}`,
  );
  // Initial delay: give the server time to finish assembling before the first call.
  await sleep(POLL_INTERVAL_MS);
  for (let attempt = 1; attempt <= MAX_CONSUME_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(POLL_INTERVAL_MS);
    if (shouldAbort()) throw new Error("Transfer aborted");
    const consumeRes = await client.query("xmc.contentTransfer.consumeFile", {
      params: {
        query: {
          databaseName: "master",
          fileName: consumeFileName,
          sitecoreContextId: destinationContextId,
        },
      },
    });
    const consumeResAny = consumeRes?.data as unknown as
      | { error?: { Message?: string } }
      | undefined;
    logger.log(
      `Step3${label}`,
      `  consumeFile attempt ${attempt}/${MAX_CONSUME_ATTEMPTS} response`,
      consumeResAny,
    );
    if (consumeResAny?.error) {
      const msg =
        consumeResAny.error.Message ?? JSON.stringify(consumeResAny.error);
      if (msg.toLowerCase().includes("does not exist")) {
        logger.logWarn(
          `Step3${label}`,
          `  consumeFile — file not ready yet, retrying (${attempt}/${MAX_CONSUME_ATTEMPTS})`,
          consumeResAny.error,
        );
        continue;
      }
      logger.logError(`Step3${label}`, "consumeFile failed", consumeResAny.error);
      throw new Error(
        `consumeFile failed: ${JSON.stringify(consumeResAny.error)}`,
      );
    }
    logger.log(`Step3${label}`, `  ✓ consumeFile queued for import`);
    return;
  }
  throw new Error(
    `consumeFile: file not ready after ${MAX_CONSUME_ATTEMPTS} attempts (~${Math.round(
      ((MAX_CONSUME_ATTEMPTS + 1) * POLL_INTERVAL_MS) / 1000,
    )}s) — ${consumeFileName}`,
  );
}

// ── Cleanup ───────────────────────────────────────────────────────────────

/**
 * Best-effort `DELETE /transfers/{transferId}`. Documented as a
 * source-environment operation: call it against the environment where the
 * transfer was created, once its chunk sets have become .raif files or when
 * the transfer failed or was cancelled. Errors are logged and swallowed so
 * cleanup never masks the original failure.
 */
export async function deleteTransferQuietly(
  client: ClientSDK,
  opts: {
    transferId: string;
    contextId: string;
    side: string;
    label: string;
    logger: TransferLogger;
  },
): Promise<void> {
  const { transferId, contextId, side, label, logger } = opts;
  try {
    logger.log(
      `Cleanup${label}`,
      `Deleting transfer from ${side} — transferId=${transferId}`,
    );
    const res = await client.mutate(
      "xmc.contentTransfer.deleteContentTransfer",
      {
        params: {
          path: { transferId },
          query: { sitecoreContextId: contextId },
        },
      },
    );
    logger.log(`Cleanup${label}`, `deleteContentTransfer ${side} response`, res);
  } catch (e) {
    logger.logWarn(
      `Cleanup${label}`,
      `Cleanup on ${side} failed (ignored) — transferId=${transferId}`,
      e,
    );
  }
}
