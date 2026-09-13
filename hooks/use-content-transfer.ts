"use client";

import { useMarketplaceClient } from "@/components/providers/marketplace";
import type {
  ChunkSetMetadata,
  TransferConfig,
  TransferPhase,
} from "@/lib/content-transfer";
import { findEnvironmentById, isMediaPath } from "@/lib/content-transfer";
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
import { resolveEnvironmentClient } from "@/lib/environment-client/resolve";
import type { ContentTransferTransport } from "@/lib/environment-client/types";
import { useCallback, useRef, useState } from "react";
import { useEnvironments } from "./use-environments";

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
  const sdkClient = useMarketplaceClient();
  const environments = useEnvironments();
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
    sourceTransport: ContentTransferTransport,
    destinationTransport: ContentTransferTransport,
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

    await sourceTransport.createContentTransfer(
      subConfig.transferId,
      subConfig.dataTrees,
    );
    log(`Step1${label}`, `✓ Transfer created on source`);

    if (abortRef.current) throw new Error("Transfer aborted");

    // ── Step 2: Poll until source finishes packaging ───────────────────
    setPhase("preparing");
    setProgress(progressOffset + Math.round(progressShare * 0.1));
    log(`Step2${label}`, `Waiting for source to finish packaging...`);

    const chunkSets = await pollTransferStatus(sourceTransport, {
      transferId: subConfig.transferId,
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

        const chunkBlob = await getChunkWithRetry(sourceTransport, {
          transferId: subConfig.transferId,
          chunksetId: chunkSet.ChunkSetId,
          chunkId: chunkIndex,
          label,
          logNote: `${chunkIndex + 1}/${chunkSet.ChunkCount}`,
          shouldAbort,
          logger,
        });

        await saveChunkWithRetry(destinationTransport, {
          transferId: subConfig.transferId,
          chunksetId: chunkSet.ChunkSetId,
          chunkId: chunkIndex,
          body: chunkBlob,
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
      const fileName = await completeChunkSet(destinationTransport, {
        transferId: subConfig.transferId,
        chunksetId: chunkSet.ChunkSetId,
        label,
        logger,
      });
      log(
        `Step3${label}`,
        `  ✓ Chunk set ${csIndex + 1} assembled — fileName=${fileName}`,
      );

      // 3c: Kick off import of this chunk set's assembled file on destination
      await consumeFileWithRetry(destinationTransport, {
        fileName,
        label,
        shouldAbort,
        logger,
      });

      // Push the RAW file name for Step 4 blob-state polling.
      // Do NOT push a prefixed form — that prefix is only valid for
      // consumeFile. GetBlobState resolves the string as a literal blob
      // name, so a prefixed form always returns 404 BlobNotFound.
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
      await pollBlobState(destinationTransport, {
        fileName,
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
    await deleteTransferQuietly(sourceTransport, {
      transferId: subConfig.transferId,
      side: "source",
      label,
      logger,
    });

    // The destination never created a transfer record, so this is best-effort
    // parity cleanup only — a 400/404 here is the expected response.
    await deleteTransferQuietly(destinationTransport, {
      transferId: subConfig.transferId,
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
    sourceTransport: ContentTransferTransport,
    destinationTransport: ContentTransferTransport,
    label: string,
  ): Promise<void> {
    for (const [transport, side] of [
      [sourceTransport, "source"],
      [destinationTransport, "destination"],
    ] as const) {
      await deleteTransferQuietly(transport, {
        transferId: subConfig.transferId,
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
        const sourceEnv = findEnvironmentById(
          environments,
          config.sourceContextId,
        );
        const destinationEnv = findEnvironmentById(
          environments,
          config.destinationContextId,
        );
        if (!sourceEnv || !destinationEnv) {
          throw new Error(
            "Could not resolve the selected source/destination environment.",
          );
        }
        const sourceTransport = resolveEnvironmentClient(
          sourceEnv,
          sdkClient,
        ).contentTransfer;
        const destinationTransport = resolveEnvironmentClient(
          destinationEnv,
          sdkClient,
        ).contentTransfer;

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
              sourceTransport,
              destinationTransport,
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
            await cleanupSubTransfer(
              subConfig,
              sourceTransport,
              destinationTransport,
              label,
            );
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
    [sdkClient, environments],
  );

  const deleteTransfer = useCallback(
    async (tid: string, sourceContextId: string) => {
      try {
        const env = findEnvironmentById(environments, sourceContextId);
        if (!env) return;
        await resolveEnvironmentClient(
          env,
          sdkClient,
        ).contentTransfer.deleteContentTransfer(tid);
      } catch {
        // Best-effort cleanup, ignore errors
      }
    },
    [sdkClient, environments],
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
