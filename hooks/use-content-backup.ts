"use client";

import { useMarketplaceClient } from "@/components/providers/marketplace";
import {
  BACKUP_FORMAT_VERSION,
  MANIFEST_ENTRY,
  archiveFileName,
  chunkEntryName,
  createArchiveWriter,
  type ArchiveDelivery,
  type BackupAuthor,
  type BackupChunkSet,
  type BackupManifest,
  type BackupSubTransfer,
} from "@/lib/backup-archive";
import type {
  ChunkSetMetadata,
  DataTreeItem,
  TransferPhase,
} from "@/lib/content-transfer";
import { isMediaPath } from "@/lib/content-transfer";
import {
  createLogger,
  deleteTransferQuietly,
  getChunkWithRetry,
  pollTransferStatus,
} from "@/lib/content-transfer-primitives";
import { useCallback, useRef, useState } from "react";

const { log, logError, logWarn } = createLogger("[ContentBackup]");
const logger = { log, logWarn, logError };

export interface BackupConfig {
  label: string;
  sourceContextId: string;
  sourceTenantId: string;
  sourceTenantName: string;
  dataTrees: DataTreeItem[];
}

/** One sub-transfer's worth of packaging, mirroring the media/content split
 *  the transfer flow uses. */
interface SubBackup {
  transferId: string;
  isMedia: boolean;
  label: string;
  dataTrees: DataTreeItem[];
}

export function useContentBackup() {
  const client = useMarketplaceClient();
  const [phase, setPhase] = useState<TransferPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [chunkSetsMetadata, setChunkSetsMetadata] = useState<
    ChunkSetMetadata[]
  >([]);
  const [delivery, setDelivery] = useState<ArchiveDelivery | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const abortRef = useRef(false);
  const isRunningRef = useRef(false);

  const shouldAbort = () => abortRef.current;

  /** Reads the signed-in user so the archive records who made it. Optional —
   *  a backup is still valid without attribution. */
  const readAuthor = useCallback(async (): Promise<BackupAuthor | null> => {
    try {
      const res = await client.query("host.user");
      const user = res?.data as Partial<BackupAuthor> | undefined;
      if (!user) return null;
      return {
        id: user.id ?? "",
        name: user.name ?? "",
        email: user.email ?? "",
      };
    } catch (e) {
      logWarn("Author", "Could not read host.user — archive will be unattributed", e);
      return null;
    }
  }, [client]);

  const startBackup = useCallback(
    async (config: BackupConfig) => {
      // Guard against React StrictMode's double-invocation.
      if (isRunningRef.current) return;
      isRunningRef.current = true;

      abortRef.current = false;
      setError(null);
      setProgress(0);
      setDetail(null);
      setChunkSetsMetadata([]);
      setDelivery(null);

      const createdAt = new Date();
      const name = archiveFileName(config.label, createdAt);
      setFileName(name);

      // Split exactly as the transfer flow does: media and content are packaged
      // separately because saveChunk needs isMedia per chunk on the way back in.
      const mediaTrees = config.dataTrees.filter((dt) =>
        isMediaPath(dt.itemPath),
      );
      const contentTrees = config.dataTrees.filter(
        (dt) => !isMediaPath(dt.itemPath),
      );
      const subBackups: SubBackup[] = [];
      if (mediaTrees.length > 0) {
        subBackups.push({
          transferId: crypto.randomUUID(),
          isMedia: true,
          label: "[media]",
          dataTrees: mediaTrees,
        });
      }
      if (contentTrees.length > 0) {
        subBackups.push({
          transferId: crypto.randomUUID(),
          isMedia: false,
          label:
            contentTrees.length < config.dataTrees.length ? "[content]" : "",
          dataTrees: contentTrees,
        });
      }

      // Sub-transfers that reached the point of staging chunks on the source
      // and therefore need cleaning up, whatever happens next.
      const createdOnSource: SubBackup[] = [];
      let archive: Awaited<ReturnType<typeof createArchiveWriter>> | null = null;

      try {
        // The save dialog must be opened from the user's click, so the archive
        // is created before any network work begins.
        archive = await createArchiveWriter(name);
        log("Start", `Archive opened via "${archive.strategy}" — ${name}`);

        const author = await readAuthor();
        const manifest: BackupManifest = {
          formatVersion: BACKUP_FORMAT_VERSION,
          createdAt: createdAt.toISOString(),
          createdBy: author,
          label: config.label,
          sourceTenantId: config.sourceTenantId,
          sourceTenantName: config.sourceTenantName,
          subTransfers: [],
        };

        log(
          "Start",
          `Backup split — ${mediaTrees.length} media tree(s), ${contentTrees.length} content tree(s), ${subBackups.length} sub-transfer(s)`,
        );

        const progressShare = Math.floor(100 / subBackups.length);

        for (const [i, sub] of subBackups.entries()) {
          if (abortRef.current) throw new Error("Transfer aborted");
          const progressOffset = i * progressShare;
          const { transferId, isMedia, label, dataTrees } = sub;

          // ── Step 1: Create the transfer on the source ──────────────────
          setPhase("creating");
          setProgress(progressOffset + Math.round(progressShare * 0.02));
          log(`Step1${label}`, `Creating transfer on source`, {
            transferId,
            sourceContextId: config.sourceContextId,
            dataTrees,
            isMedia,
          });

          const createRes = await client.mutate(
            "xmc.contentTransfer.createContentTransfer",
            {
              params: {
                body: {
                  transferId,
                  configuration: { dataTrees },
                },
                query: { sitecoreContextId: config.sourceContextId },
              },
            },
          );
          const createResAny = createRes as unknown as { error?: unknown };
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
          createdOnSource.push(sub);
          log(`Step1${label}`, `✓ Transfer created on source`);

          if (abortRef.current) throw new Error("Transfer aborted");

          // ── Step 2: Wait for the source to finish packaging ────────────
          setPhase("preparing");
          setProgress(progressOffset + Math.round(progressShare * 0.1));
          setDetail("Waiting for the source to package content…");

          const chunkSets = await pollTransferStatus(client, {
            transferId,
            sourceContextId: config.sourceContextId,
            shouldAbort,
            logger,
            onChunkSets: (sets) =>
              setChunkSetsMetadata((prev) => [...prev, ...sets]),
          });
          log(`Step2${label}`, `✓ Packaging complete — chunk sets`, chunkSets);

          // ── Step 3: Pull every chunk and write it into the archive ─────
          setPhase("downloading");
          const totalChunks = chunkSets.reduce(
            (sum, cs) => sum + cs.ChunkCount,
            0,
          );
          let completedChunks = 0;
          const manifestChunkSets: BackupChunkSet[] = [];

          for (const [csIndex, chunkSet] of chunkSets.entries()) {
            if (abortRef.current) throw new Error("Transfer aborted");
            log(
              `Step3${label}`,
              `Processing chunk set ${csIndex + 1}/${chunkSets.length} — ChunkSetId=${chunkSet.ChunkSetId} ChunkCount=${chunkSet.ChunkCount}`,
            );

            const manifestChunks = [];
            for (
              let chunkIndex = 0;
              chunkIndex < chunkSet.ChunkCount;
              chunkIndex++
            ) {
              if (abortRef.current) throw new Error("Transfer aborted");
              setDetail(
                `Chunk ${completedChunks + 1} of ${totalChunks}${
                  isMedia ? " (media)" : ""
                }`,
              );

              const chunkBlob = await getChunkWithRetry(client, {
                transferId,
                chunksetId: chunkSet.ChunkSetId,
                chunkId: chunkIndex,
                sourceContextId: config.sourceContextId,
                label,
                logNote: `${chunkIndex + 1}/${chunkSet.ChunkCount}`,
                shouldAbort,
                logger,
              });

              // Stored verbatim. The bytes must be replayable 1:1 by saveChunk,
              // so nothing here re-encodes, re-slices or compresses them.
              const entry = chunkEntryName(
                isMedia,
                chunkSet.ChunkSetId,
                chunkIndex,
              );
              await archive.addChunk(entry, chunkBlob);
              manifestChunks.push({
                chunkId: chunkIndex,
                entry,
                size: chunkBlob.size,
              });
              log(
                `Step3${label}`,
                `  ✓ Chunk ${chunkIndex} archived (${chunkBlob.size} bytes) → ${entry}`,
              );

              completedChunks++;
              setProgress(
                progressOffset +
                  Math.round(progressShare * 0.2) +
                  Math.round(
                    (completedChunks / totalChunks) * (progressShare * 0.65),
                  ),
              );
            }

            manifestChunkSets.push({
              chunkSetId: chunkSet.ChunkSetId,
              chunkCount: chunkSet.ChunkCount,
              totalItemCount: chunkSet.TotalItemCount,
              chunks: manifestChunks,
            });
          }

          const subTransfer: BackupSubTransfer = {
            isMedia,
            transferId,
            dataTrees,
            chunkSets: manifestChunkSets,
          };
          manifest.subTransfers.push(subTransfer);
          setProgress(progressOffset + Math.round(progressShare * 0.9));
        }

        if (abortRef.current) throw new Error("Transfer aborted");

        // ── Step 4: Seal the archive ──────────────────────────────────────
        setPhase("archiving");
        setDetail("Finalising the archive…");
        log("Step4", `Writing manifest`, manifest);
        await archive.addJson(MANIFEST_ENTRY, manifest);
        const result = await archive.close();
        archive = null;
        setDelivery(result);
        log(
          "Step4",
          `✓ Archive delivered via "${result.strategy}"${
            result.sizeBytes ? ` — ${result.sizeBytes} bytes` : ""
          }`,
        );

        // ── Step 5: Release the staged chunks on the source ───────────────
        // Documented as a source-environment operation. A backup can stage
        // gigabytes, so this runs on success, failure and abort alike.
        for (const sub of createdOnSource) {
          await deleteTransferQuietly(client, {
            transferId: sub.transferId,
            contextId: config.sourceContextId,
            side: "source",
            label: sub.label,
            logger,
          });
        }
        createdOnSource.length = 0;

        setProgress(100);
        setDetail(null);
        setPhase("completed");
        log("Done", `✓ Backup complete — ${name}`);
      } catch (err) {
        // Discard the partial archive, then release the source either way.
        if (archive) await archive.abort().catch(() => {});
        for (const sub of createdOnSource) {
          await deleteTransferQuietly(client, {
            transferId: sub.transferId,
            contextId: config.sourceContextId,
            side: "source",
            label: sub.label,
            logger,
          });
        }

        const aborted = abortRef.current;
        const dismissed = err instanceof DOMException && err.name === "AbortError";
        if (aborted || dismissed) {
          log("Abort", "Backup was cancelled");
          setPhase("idle");
          setProgress(0);
          setDetail(null);
        } else {
          logError("Error", "Backup failed", err);
          setPhase("failed");
          setError(err instanceof Error ? err.message : "Backup failed");
        }
      } finally {
        isRunningRef.current = false;
      }
    },
    [client, readAuthor],
  );

  const reset = useCallback(() => {
    abortRef.current = true;
    setPhase("idle");
    setProgress(0);
    setError(null);
    setDetail(null);
    setChunkSetsMetadata([]);
    setDelivery(null);
    setFileName(null);
  }, []);

  return {
    phase,
    progress,
    error,
    detail,
    chunkSetsMetadata,
    delivery,
    fileName,
    isRunning:
      phase === "creating" ||
      phase === "preparing" ||
      phase === "downloading" ||
      phase === "archiving",
    startBackup,
    reset,
  };
}
