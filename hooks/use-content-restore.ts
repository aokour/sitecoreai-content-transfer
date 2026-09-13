"use client";

import { useMarketplaceClient } from "@/components/providers/marketplace";
import { readArchive, type BackupManifest } from "@/lib/backup-archive";
import {
  findEnvironmentById,
  type ChunkSetMetadata,
  type TransferPhase,
} from "@/lib/content-transfer";
import {
  completeChunkSet,
  consumeFileWithRetry,
  createLogger,
  deleteTransferQuietly,
  pollBlobState,
  saveChunkWithRetry,
} from "@/lib/content-transfer-primitives";
import { resolveEnvironmentClient } from "@/lib/environment-client/resolve";
import { useCallback, useRef, useState } from "react";
import { useEnvironments } from "./use-environments";

const { log, logError, logWarn } = createLogger("[ContentRestore]");
const logger = { log, logWarn, logError };

export interface RestoreConfig {
  /** The archive the user picked. Read lazily, one chunk at a time. */
  file: Blob;
  destinationContextId: string;
  destinationTenantName: string;
}

export function useContentRestore() {
  const client = useMarketplaceClient();
  const environments = useEnvironments();
  const [phase, setPhase] = useState<TransferPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [chunkSetsMetadata, setChunkSetsMetadata] = useState<
    ChunkSetMetadata[]
  >([]);
  // Once a chunk set is completed on the destination, aborting would strand an
  // unconsumed .raif that nothing collects and no SDK endpoint can delete. The
  // UI reads this to disable cancellation for the rest of the run.
  const [cancellable, setCancellable] = useState(true);
  const abortRef = useRef(false);
  const criticalRef = useRef(false);
  const isRunningRef = useRef(false);

  // Abort requests raised during the critical section are ignored rather than
  // deferred. Once a chunk set has been assembled into a .raif there is no
  // undo, so honouring a cancel would only stop us watching an import that is
  // going to happen regardless.
  const shouldAbort = () => abortRef.current && !criticalRef.current;

  const startRestore = useCallback(
    async (config: RestoreConfig) => {
      if (isRunningRef.current) return;
      isRunningRef.current = true;

      abortRef.current = false;
      criticalRef.current = false;
      setCancellable(true);
      setError(null);
      setProgress(0);
      setDetail(null);
      setChunkSetsMetadata([]);

      let manifest: BackupManifest | null = null;
      let archive: Awaited<ReturnType<typeof readArchive>> | null = null;

      const destinationEnv = findEnvironmentById(
        environments,
        config.destinationContextId,
      );
      if (!destinationEnv) {
        setPhase("failed");
        setError("Could not resolve the selected destination environment.");
        isRunningRef.current = false;
        return;
      }
      const destinationTransport = resolveEnvironmentClient(
        destinationEnv,
        client,
      ).contentTransfer;

      try {
        // ── Step 0: Read the archive ──────────────────────────────────────
        setPhase("reading");
        setDetail("Reading the archive…");
        archive = await readArchive(config.file);
        manifest = archive.manifest;
        log("Step0", `Manifest read`, manifest);

        setChunkSetsMetadata(
          manifest.subTransfers.flatMap((st) =>
            st.chunkSets.map((cs) => ({
              ChunkSetId: cs.chunkSetId,
              ChunkCount: cs.chunkCount,
              TotalItemCount: cs.totalItemCount,
            })),
          ),
        );

        // Uploading owns 0–70% of the bar, assembly 70–84%, importing 84–98%.
        const totalChunks = manifest.subTransfers.reduce(
          (sum, st) =>
            sum + st.chunkSets.reduce((s, cs) => s + cs.chunks.length, 0),
          0,
        );
        const totalChunkSets = manifest.subTransfers.reduce(
          (sum, st) => sum + st.chunkSets.length,
          0,
        );
        let completedChunks = 0;
        let importedChunkSets = 0;

        // ── Phase A: upload every chunk (cancellable) ─────────────────────
        // All uploads happen before any chunk set is completed. Until then
        // nothing has been assembled on the destination, so abandoning the run
        // leaves only loose chunks — the safe point to cancel.
        setPhase("transferring");
        for (const sub of manifest.subTransfers) {
          if (shouldAbort()) throw new Error("Transfer aborted");
          const label = sub.isMedia ? "[media]" : "[content]";
          const { transferId, isMedia } = sub;

          log(
            `Step1${label}`,
            `Uploading sub-transfer — transferId=${transferId} isMedia=${isMedia} chunkSets=${sub.chunkSets.length}`,
          );

          for (const chunkSet of sub.chunkSets) {
            for (const chunk of chunkSet.chunks) {
              if (shouldAbort()) throw new Error("Transfer aborted");
              setDetail(
                `Uploading chunk ${completedChunks + 1} of ${totalChunks}${
                  isMedia ? " (media)" : ""
                }`,
              );

              const blob = await archive.getChunk(chunk.entry);
              if (blob.size !== chunk.size) {
                throw new Error(
                  `Chunk ${chunk.chunkId} of chunk set ${chunkSet.chunkSetId} is ${blob.size} bytes but the manifest records ${chunk.size}. The archive is corrupt; restoring it would import damaged content.`,
                );
              }

              // Replays the recorded transferId and chunkSetId verbatim, the
              // same way a live transfer reuses the source's IDs on the
              // destination.
              await saveChunkWithRetry(destinationTransport, {
                transferId,
                chunksetId: chunkSet.chunkSetId,
                chunkId: chunk.chunkId,
                body: blob,
                isMedia,
                label,
                logNote: `${chunk.chunkId + 1}/${chunkSet.chunkCount}`,
                shouldAbort,
                logger,
              });
              log(`Step1${label}`, `  ✓ Chunk ${chunk.chunkId} uploaded`);

              completedChunks++;
              setProgress(Math.round((completedChunks / totalChunks) * 70));
            }
          }
        }

        // ── Phase B: assemble and import (non-cancellable) ────────────────
        // completeChunkSetTransfer turns the uploaded chunks into a .raif on
        // the destination. Stopping between that and consumeFile strands a blob
        // that no worker collects and that no SDK endpoint can delete, so
        // cancellation is refused for the rest of the run.
        criticalRef.current = true;
        setCancellable(false);
        setPhase("importing");

        const imported: { fileName: string; label: string }[] = [];
        for (const sub of manifest.subTransfers) {
          const label = sub.isMedia ? "[media]" : "[content]";
          for (const chunkSet of sub.chunkSets) {
            setDetail(
              `Assembling package ${imported.length + 1} of ${totalChunkSets}…`,
            );
            const fileName = await completeChunkSet(destinationTransport, {
              transferId: sub.transferId,
              chunksetId: chunkSet.chunkSetId,
              label,
              logger,
            });
            log(`Step2${label}`, `  ✓ Chunk set assembled — fileName=${fileName}`);

            await consumeFileWithRetry(destinationTransport, {
              fileName,
              label,
              shouldAbort,
              logger,
            });
            imported.push({ fileName, label });
            setProgress(70 + Math.round((imported.length / totalChunkSets) * 14));
          }
        }

        // ── Phase C: wait for the destination to finish importing ─────────
        for (const { fileName, label } of imported) {
          setDetail(
            `Importing package ${importedChunkSets + 1} of ${totalChunkSets}…`,
          );
          await pollBlobState(destinationTransport, {
            fileName,
            shouldAbort,
            logger,
          });
          log(`Step3${label}`, `  ✓ Import finished — fileName=${fileName}`);
          importedChunkSets++;
          setProgress(
            84 + Math.round((importedChunkSets / totalChunkSets) * 14),
          );
        }

        // Parity cleanup only. Restore never created a transfer here, so a
        // 400/404 is the expected response and is swallowed.
        for (const sub of manifest.subTransfers) {
          await deleteTransferQuietly(destinationTransport, {
            transferId: sub.transferId,
            side: "destination",
            label: sub.isMedia ? "[media]" : "[content]",
            logger,
          });
        }

        setProgress(100);
        setDetail(null);
        setPhase("completed");
        log("Done", `✓ Restore complete into ${config.destinationTenantName}`);
      } catch (err) {
        criticalRef.current = false;
        if (abortRef.current) {
          log("Abort", "Restore was cancelled by user");
          setPhase("idle");
          setProgress(0);
          setDetail(null);
        } else {
          logError("Error", "Restore failed", err);
          setPhase("failed");
          setError(err instanceof Error ? err.message : "Restore failed");
        }
      } finally {
        criticalRef.current = false;
        await archive?.close().catch(() => {});
        setCancellable(true);
        isRunningRef.current = false;
      }
    },
    [client, environments],
  );

  /** Requests cancellation. Ignored while a chunk set is mid-import. */
  const cancel = useCallback(() => {
    if (criticalRef.current) return false;
    abortRef.current = true;
    return true;
  }, []);

  const reset = useCallback(() => {
    abortRef.current = true;
    setPhase("idle");
    setProgress(0);
    setError(null);
    setDetail(null);
    setChunkSetsMetadata([]);
  }, []);

  return {
    phase,
    progress,
    error,
    detail,
    chunkSetsMetadata,
    cancellable,
    isRunning:
      phase === "reading" || phase === "transferring" || phase === "importing",
    startRestore,
    cancel,
    reset,
  };
}
