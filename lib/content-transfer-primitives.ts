import type { ChunkSetMetadata } from "@/lib/content-transfer";
import type { ContentTransferTransport } from "@/lib/environment-client/types";

// Shared low-level plumbing for every flow that speaks the Content Transfer
// API: transfer (source → destination), backup (source → local archive) and
// restore (local archive → destination). Everything here takes a
// ContentTransferTransport as an argument — already bound to one environment
// (source XOR destination) — so it works identically whether that side is a
// real SitecoreAI environment (Marketplace SDK) or a local Docker instance
// (direct fetch), and so it can be used outside a React hook. All retry,
// backoff, polling and error-message logic lives here; the transport
// implementations (lib/environment-client/*) only report the outcome of a
// single attempt.

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
  transport: ContentTransferTransport,
  opts: {
    transferId: string;
    shouldAbort: AbortCheck;
    logger: TransferLogger;
    /** Called with each newly reported batch of chunk-set metadata. */
    onChunkSets?: (sets: ChunkSetMetadata[]) => void;
  },
): Promise<ChunkSetMetadata[]> {
  const { transferId, shouldAbort, logger, onChunkSets } = opts;
  logger.log("PollStatus", `Polling transfer status — transferId=${transferId}`);
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    if (shouldAbort()) throw new Error("Transfer aborted");
    await sleep(POLL_INTERVAL_MS);
    const data = await transport.getContentTransferStatus(transferId);
    logger.log("PollStatus", `Attempt ${attempt + 1} response`, data);
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

export async function pollBlobState(
  transport: ContentTransferTransport,
  opts: {
    fileName: string;
    shouldAbort: AbortCheck;
    logger: TransferLogger;
  },
): Promise<void> {
  const { fileName, shouldAbort, logger } = opts;
  logger.log("PollBlob", `Polling blob state — fileName=${fileName}`);
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    if (shouldAbort()) throw new Error("Transfer aborted");
    await sleep(POLL_INTERVAL_MS);
    const data = await transport.getBlobState(fileName);
    logger.log("PollBlob", `Attempt ${attempt + 1} response`, data);
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
// Retries transient failures: HTTP 5xx responses AND network/bridge-level
// exceptions (surfaced by the transport as a result with no httpStatus).
// 405 and other 4xx fail fast.
export async function saveChunkWithRetry(
  transport: ContentTransferTransport,
  opts: {
    transferId: string;
    chunksetId: string;
    chunkId: number;
    body: Blob;
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
    isMedia,
    label,
    logNote,
    shouldAbort,
    logger,
  } = opts;
  logger.log(
    `Step3${label}`,
    `  saveChunk ${logNote} → dest (Blob size=${body.size}) chunkId=${chunkId} isMedia=${isMedia}`,
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

    const result = await transport.saveChunk(
      transferId,
      chunksetId,
      chunkId,
      body,
      isMedia,
    );
    logger.log(`Step3${label}`, `  saveChunk attempt ${attempt + 1} result`, result);
    if (result.ok) return;

    const { httpStatus, error } = result;
    if (httpStatus === 405) {
      logger.logError(`Step3${label}`, `saveChunk failed`, error);
      throw new Error(
        `saveChunk returned 405 Method Not Allowed (isMedia=${isMedia}). ` +
          `The destination environment does not support the Content Transfer API (PUT .../chunks). ` +
          `Details: ${JSON.stringify(error)}`,
      );
    }
    const isRetryable = httpStatus === undefined || httpStatus >= 500;
    if (!isRetryable || attempt === SAVE_CHUNK_MAX_RETRIES) {
      logger.logError(`Step3${label}`, `saveChunk failed`, error);
      throw new Error(
        `saveChunk failed (HTTP ${httpStatus ?? "?"}) for chunk ${chunkId} of chunkset ${chunksetId}: ${JSON.stringify(error)}. ` +
          (httpStatus === undefined
            ? "If this is a bridge/network timeout on a large chunk, see the transport implementation's timeout handling."
            : ""),
      );
    }
    logger.logWarn(
      `Step3${label}`,
      `  saveChunk transient error (HTTP ${httpStatus ?? "?"}), will retry`,
      error,
    );
  }
}

// ── getChunk with retry ───────────────────────────────────────────────────
// Downloads one chunk from the source. Retries thrown exceptions and empty
// responses.
export async function getChunkWithRetry(
  transport: ContentTransferTransport,
  opts: {
    transferId: string;
    chunksetId: string;
    chunkId: number;
    label: string;
    logNote: string;
    shouldAbort: AbortCheck;
    logger: TransferLogger;
  },
): Promise<Blob> {
  const { transferId, chunksetId, chunkId, label, logNote, shouldAbort, logger } =
    opts;
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
      const chunkBlob = await transport.getChunk(transferId, chunksetId, chunkId);
      logger.log(
        `Step3${label}`,
        `  getChunk ${chunkId} result — size=${chunkBlob?.size ?? "n/a"}`,
      );
      if (chunkBlob && chunkBlob.size > 0) {
        return chunkBlob;
      }
      lastError = new Error("getChunk returned empty blob");
      logger.logWarn(
        `Step3${label}`,
        `  getChunk returned empty/invalid blob, will retry — chunkId=${chunkId}`,
      );
    } catch (err) {
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
    }`,
  );
}

// ── Chunk set completion ──────────────────────────────────────────────────

/** Signals a chunk set complete on the destination and returns the assembled
 *  .raif file name. */
export async function completeChunkSet(
  transport: ContentTransferTransport,
  opts: {
    transferId: string;
    chunksetId: string;
    label: string;
    logger: TransferLogger;
  },
): Promise<string> {
  const { transferId, chunksetId, label, logger } = opts;
  logger.log(`Step3${label}`, `  completeChunkSetTransfer — chunksetId=${chunksetId}`);
  const fileName = await transport.completeChunkSet(transferId, chunksetId);
  logger.log(`Step3${label}`, `  ContentTransferFileName=${fileName}`);
  return fileName;
}

// ── consumeFile with retry ────────────────────────────────────────────────
// completeChunkSetTransfer triggers async server-side file assembly and returns
// immediately — the .raif file may not exist yet when consumeFile is first called.
// Wait one full poll interval before the first attempt, then retry with backoff.
export async function consumeFileWithRetry(
  transport: ContentTransferTransport,
  opts: {
    /** RAW blob name; each transport adds its own addressing prefix internally. */
    fileName: string;
    label: string;
    shouldAbort: AbortCheck;
    logger: TransferLogger;
  },
): Promise<void> {
  const { fileName, label, shouldAbort, logger } = opts;
  logger.log(`Step3${label}`, `  consumeFile — fileName=${fileName}`);
  // Initial delay: give the server time to finish assembling before the first call.
  await sleep(POLL_INTERVAL_MS);
  for (let attempt = 1; attempt <= MAX_CONSUME_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(POLL_INTERVAL_MS);
    if (shouldAbort()) throw new Error("Transfer aborted");
    const result = await transport.consumeFile(fileName, "master");
    logger.log(
      `Step3${label}`,
      `  consumeFile attempt ${attempt}/${MAX_CONSUME_ATTEMPTS} result`,
      result,
    );
    if (result.ok) {
      logger.log(`Step3${label}`, `  ✓ consumeFile queued for import`);
      return;
    }
    if (result.notReady) {
      logger.logWarn(
        `Step3${label}`,
        `  consumeFile — file not ready yet, retrying (${attempt}/${MAX_CONSUME_ATTEMPTS})`,
        result.error,
      );
      continue;
    }
    logger.logError(`Step3${label}`, "consumeFile failed", result.error);
    throw new Error(`consumeFile failed: ${JSON.stringify(result.error)}`);
  }
  throw new Error(
    `consumeFile: file not ready after ${MAX_CONSUME_ATTEMPTS} attempts (~${Math.round(
      ((MAX_CONSUME_ATTEMPTS + 1) * POLL_INTERVAL_MS) / 1000,
    )}s) — ${fileName}`,
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
  transport: ContentTransferTransport,
  opts: {
    transferId: string;
    side: string;
    label: string;
    logger: TransferLogger;
  },
): Promise<void> {
  const { transferId, side, label, logger } = opts;
  try {
    logger.log(`Cleanup${label}`, `Deleting transfer from ${side} — transferId=${transferId}`);
    await transport.deleteContentTransfer(transferId);
    logger.log(`Cleanup${label}`, `deleteContentTransfer ${side} done`);
  } catch (e) {
    logger.logWarn(
      `Cleanup${label}`,
      `Cleanup on ${side} failed (ignored) — transferId=${transferId}`,
      e,
    );
  }
}
