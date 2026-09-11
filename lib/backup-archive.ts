import {
  BlobReader,
  BlobWriter,
  TextWriter,
  ZipReader,
  ZipWriter,
  configure,
} from "@zip.js/zip.js";
import type { DataTreeItem } from "@/lib/content-transfer";

// Web workers are disabled deliberately. Every entry is STORED (level 0), so no
// deflate codec is needed and the only main-thread cost is a CRC-32 pass over
// the bytes. Workers would add a bundler-resolved worker URL for no benefit and
// a class of hard-to-debug failures inside the Marketplace iframe.
configure({ useWebWorkers: false });

// ─── Manifest ────────────────────────────────────────────────────────────────

export const BACKUP_FORMAT_VERSION = 1;
export const MANIFEST_ENTRY = "manifest.json";

export interface BackupAuthor {
  id: string;
  name: string;
  email: string;
}

export interface BackupChunkRef {
  chunkId: number;
  /** Path of the ZIP entry holding this chunk's raw bytes. */
  entry: string;
  size: number;
}

export interface BackupChunkSet {
  chunkSetId: string;
  chunkCount: number;
  totalItemCount: number;
  chunks: BackupChunkRef[];
}

/**
 * One media or content sub-transfer. The split is preserved because `isMedia`
 * must be passed back to saveChunk on restore, and each sub-transfer carries
 * its own transferId.
 */
export interface BackupSubTransfer {
  isMedia: boolean;
  transferId: string;
  dataTrees: DataTreeItem[];
  chunkSets: BackupChunkSet[];
}

export interface BackupManifest {
  formatVersion: number;
  createdAt: string;
  createdBy: BackupAuthor | null;
  label: string;
  /** Stable tenant identity of the source. Used to warn when restoring back
   *  into the environment the archive came from. */
  sourceTenantId: string;
  sourceTenantName: string;
  subTransfers: BackupSubTransfer[];
}

/** ZIP entry name for one chunk. Recorded verbatim in the manifest, so the
 *  sanitisation here never has to be reproduced by the reader. */
export function chunkEntryName(
  isMedia: boolean,
  chunkSetId: string,
  chunkId: number,
): string {
  const safeSetId = chunkSetId.replace(/[^A-Za-z0-9._-]/g, "_");
  return `chunks/${isMedia ? "media" : "content"}/${safeSetId}/${chunkId}.raif`;
}

export function archiveFileName(label: string, createdAt: Date): string {
  const slug =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "content-backup";
  const stamp = createdAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${slug}_${stamp}.zip`;
}

export function totalChunkBytes(manifest: BackupManifest): number {
  return manifest.subTransfers.reduce(
    (sum, st) =>
      sum +
      st.chunkSets.reduce(
        (s, cs) => s + cs.chunks.reduce((c, ch) => c + ch.size, 0),
        0,
      ),
    0,
  );
}

export function totalChunkCount(manifest: BackupManifest): number {
  return manifest.subTransfers.reduce(
    (sum, st) => sum + st.chunkSets.reduce((s, cs) => s + cs.chunks.length, 0),
    0,
  );
}

export function totalItemCount(manifest: BackupManifest): number {
  return manifest.subTransfers.reduce(
    (sum, st) => sum + st.chunkSets.reduce((s, cs) => s + cs.totalItemCount, 0),
    0,
  );
}

/** Every dataTree across every sub-transfer, in manifest order. */
export function manifestDataTrees(manifest: BackupManifest): DataTreeItem[] {
  return manifest.subTransfers.flatMap((st) => st.dataTrees);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export class ManifestError extends Error {}

/** Parses and validates a manifest, rejecting formats this build cannot replay. */
export function parseManifest(raw: string): BackupManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ManifestError("manifest.json is not valid JSON.");
  }
  const m = parsed as Partial<BackupManifest>;
  if (typeof m?.formatVersion !== "number") {
    throw new ManifestError("manifest.json is missing formatVersion.");
  }
  if (m.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new ManifestError(
      `This archive uses backup format v${m.formatVersion}, but this app understands up to v${BACKUP_FORMAT_VERSION}. Update the app to restore it.`,
    );
  }
  if (!Array.isArray(m.subTransfers) || m.subTransfers.length === 0) {
    throw new ManifestError("manifest.json contains no sub-transfers.");
  }
  for (const st of m.subTransfers) {
    if (typeof st.transferId !== "string" || !st.transferId) {
      throw new ManifestError("A sub-transfer is missing its transferId.");
    }
    if (!Array.isArray(st.chunkSets) || st.chunkSets.length === 0) {
      throw new ManifestError(
        `Sub-transfer ${st.transferId} contains no chunk sets.`,
      );
    }
    for (const cs of st.chunkSets) {
      if (!Array.isArray(cs.chunks) || cs.chunks.length === 0) {
        throw new ManifestError(
          `Chunk set ${cs.chunkSetId} in sub-transfer ${st.transferId} contains no chunks.`,
        );
      }
    }
  }
  return {
    formatVersion: m.formatVersion,
    createdAt: m.createdAt ?? "",
    createdBy: m.createdBy ?? null,
    label: m.label ?? "",
    sourceTenantId: m.sourceTenantId ?? "",
    sourceTenantName: m.sourceTenantName ?? "",
    subTransfers: m.subTransfers,
  };
}

// ─── Write targets ───────────────────────────────────────────────────────────

export type SaveStrategy = "file-picker" | "opfs-download" | "memory-download";

export const SAVE_STRATEGY_LABELS: Record<SaveStrategy, string> = {
  "file-picker": "Save dialog (streamed straight to disk)",
  "opfs-download": "Browser download (staged in private storage)",
  "memory-download": "Browser download (held in memory)",
};

const OPFS_STAGING_PREFIX = "sitecore-backup-staging-";

function triggerDownload(blob: Blob | File, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel an in-flight download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Removes staging files left behind by earlier backups. Best-effort. */
async function purgeOpfsStaging(keepName?: string): Promise<void> {
  try {
    const dir = await navigator.storage.getDirectory();
    const entries = (
      dir as unknown as {
        keys?: () => AsyncIterableIterator<string>;
      }
    ).keys?.();
    if (!entries) return;
    for await (const name of entries) {
      if (name.startsWith(OPFS_STAGING_PREFIX) && name !== keepName) {
        await dir.removeEntry(name).catch(() => {});
      }
    }
  } catch {
    // OPFS unavailable or not enumerable — nothing to clean.
  }
}

export interface ArchiveDelivery {
  strategy: SaveStrategy;
  /** Re-triggers the browser download, for a "Save again" affordance. `null`
   *  when the file was written straight to a location the user chose. */
  redeliver: (() => void) | null;
  sizeBytes: number | null;
}

export interface ArchiveWriter {
  strategy: SaveStrategy;
  addChunk(entryName: string, blob: Blob): Promise<void>;
  addJson(entryName: string, value: unknown): Promise<void>;
  close(): Promise<ArchiveDelivery>;
  abort(): Promise<void>;
}

interface WriteTarget {
  strategy: SaveStrategy;
  /** Sink handed to ZipWriter. */
  sink: WritableStream | BlobWriter;
  /** Produces the final delivery once the zip has been closed. */
  deliver: (closeResult: unknown) => Promise<ArchiveDelivery>;
  cleanup: () => Promise<void>;
}

/**
 * Picks the best available way to get a multi-gigabyte file onto the user's
 * disk, in descending order of quality:
 *
 *  1. `showSaveFilePicker` — streams directly to a chosen location, nothing
 *     buffered. Throws `SecurityError` in a cross-origin iframe, which is
 *     exactly where this app runs, so it usually falls through.
 *  2. OPFS staging file + anchor download — the bytes live in origin-private
 *     storage, and the object URL is backed by that file rather than by RAM.
 *  3. In-memory Blob + anchor download — last resort; a large backup can
 *     exhaust the tab's memory here.
 *
 * Must be called from a user gesture for strategy 1 to be permitted.
 */
async function resolveWriteTarget(fileName: string): Promise<WriteTarget> {
  // 1. File System Access API
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;
  if (typeof picker === "function") {
    try {
      const handle = await picker({
        suggestedName: fileName,
        types: [
          {
            description: "Content backup archive",
            accept: { "application/zip": [".zip"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      return {
        strategy: "file-picker",
        sink: writable as unknown as WritableStream,
        deliver: async () => ({
          strategy: "file-picker",
          redeliver: null,
          sizeBytes: await handle
            .getFile()
            .then((f) => f.size)
            .catch(() => null),
        }),
        cleanup: async () => {
          await (writable as unknown as { abort?: () => Promise<void> })
            .abort?.()
            .catch(() => {});
        },
      };
    } catch (err) {
      // AbortError means the user dismissed the dialog — that is a real
      // cancellation and must not silently fall back to a download.
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      // Anything else (SecurityError in a cross-origin iframe, NotAllowedError
      // without a user gesture) falls through to the next strategy.
    }
  }

  // 2. OPFS staging file
  try {
    const dir = await navigator.storage.getDirectory();
    const stagingName = `${OPFS_STAGING_PREFIX}${Date.now()}.zip`;
    const handle = await dir.getFileHandle(stagingName, { create: true });
    const createWritable = (
      handle as unknown as {
        createWritable?: () => Promise<FileSystemWritableFileStream>;
      }
    ).createWritable;
    if (typeof createWritable === "function") {
      await purgeOpfsStaging(stagingName);
      const writable = await handle.createWritable();
      return {
        strategy: "opfs-download",
        sink: writable as unknown as WritableStream,
        deliver: async () => {
          const file = await handle.getFile();
          const redeliver = () => triggerDownload(file, fileName);
          redeliver();
          return {
            strategy: "opfs-download",
            redeliver,
            sizeBytes: file.size,
          };
        },
        // The staging file is intentionally left in place: revoking it too
        // early cancels the download. It is purged at the start of the next
        // backup instead.
        cleanup: async () => {
          await dir.removeEntry(stagingName).catch(() => {});
        },
      };
    }
    await dir.removeEntry(stagingName).catch(() => {});
  } catch {
    // OPFS unavailable — fall through.
  }

  // 3. In-memory
  const blobWriter = new BlobWriter("application/zip");
  return {
    strategy: "memory-download",
    sink: blobWriter,
    deliver: async (closeResult) => {
      const blob = closeResult as Blob;
      const redeliver = () => triggerDownload(blob, fileName);
      redeliver();
      return {
        strategy: "memory-download",
        redeliver,
        sizeBytes: blob.size,
      };
    },
    cleanup: async () => {},
  };
}

/**
 * Opens a store-only, zip64 archive. Entries are never deflated: content
 * chunks are already encrypted and media chunks already compressed, so
 * compression would burn CPU for nothing, and the chunk bytes must survive
 * byte-for-byte to be replayable by saveChunk.
 *
 * Call from a user gesture so the save dialog can be offered.
 */
export async function createArchiveWriter(
  fileName: string,
): Promise<ArchiveWriter> {
  const target = await resolveWriteTarget(fileName);
  const zipWriter = new ZipWriter(
    target.sink as unknown as WritableStream,
    // keepOrder keeps entries physically ordered, so a truncated archive is
    // still coherent up to the point it stops.
    { level: 0, zip64: true, keepOrder: true },
  );
  let closed = false;

  return {
    strategy: target.strategy,
    async addChunk(entryName, blob) {
      // BlobReader streams the blob rather than materialising it.
      await zipWriter.add(entryName, new BlobReader(blob), { level: 0 });
    },
    async addJson(entryName, value) {
      const text = JSON.stringify(value, null, 2);
      await zipWriter.add(entryName, new BlobReader(new Blob([text])), {
        level: 0,
      });
    },
    async close() {
      const result = await zipWriter.close();
      closed = true;
      return target.deliver(result);
    },
    async abort() {
      if (closed) return;
      try {
        await zipWriter.close();
      } catch {
        // Ignore — we are discarding this archive anyway.
      }
      await target.cleanup();
    },
  };
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export interface ArchiveReader {
  manifest: BackupManifest;
  /** Reads one chunk back as a Blob. Random access: the archive is never fully
   *  resident, so a multi-GB backup streams one chunk at a time. */
  getChunk(entryName: string): Promise<Blob>;
  close(): Promise<void>;
}

export async function readArchive(file: Blob): Promise<ArchiveReader> {
  // BlobReader gives ZipReader random access, so it seeks straight to the
  // central directory at the end of the file. Parsing the manifest is therefore
  // instant even on a multi-gigabyte archive.
  const zipReader = new ZipReader(new BlobReader(file));
  let entries;
  try {
    entries = await zipReader.getEntries();
  } catch (err) {
    await zipReader.close().catch(() => {});
    throw new ManifestError(
      `That file could not be read as a ZIP archive: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const byName = new Map(
    entries.filter((e) => !e.directory).map((e) => [e.filename, e]),
  );
  const manifestEntry = byName.get(MANIFEST_ENTRY);
  if (!manifestEntry) {
    await zipReader.close().catch(() => {});
    throw new ManifestError(
      "This ZIP has no manifest.json, so it is not a content backup archive.",
    );
  }

  const manifestText = await manifestEntry.getData(new TextWriter());
  const manifest = parseManifest(manifestText);

  // Fail before any upload starts if the archive is missing chunk data.
  for (const st of manifest.subTransfers) {
    for (const cs of st.chunkSets) {
      for (const chunk of cs.chunks) {
        if (!byName.has(chunk.entry)) {
          await zipReader.close().catch(() => {});
          throw new ManifestError(
            `The archive is incomplete: manifest.json references "${chunk.entry}", which is not in the ZIP.`,
          );
        }
      }
    }
  }

  return {
    manifest,
    async getChunk(entryName) {
      const entry = byName.get(entryName);
      if (!entry) {
        throw new ManifestError(`Chunk entry "${entryName}" is missing.`);
      }
      return entry.getData(new BlobWriter("application/octet-stream"));
    },
    async close() {
      await zipReader.close().catch(() => {});
    },
  };
}

// ─── Capability probe ────────────────────────────────────────────────────────

export interface DownloadCapabilities {
  /** showSaveFilePicker exists on window. */
  fileSystemAccessApi: boolean;
  /** Running inside an iframe at all. */
  inIframe: boolean;
  /** Inside an iframe whose parent is a different origin — where
   *  showSaveFilePicker is blocked. */
  crossOriginIframe: boolean;
  /** Sandbox flags on our own frame element, when readable. */
  sandboxFlags: string | null;
  /** OPFS was writable and readable in this context. */
  opfsWritable: boolean;
  opfsError: string | null;
  /** The strategy a backup would use right now. */
  expectedStrategy: SaveStrategy;
}

/**
 * Reports how a backup would be delivered in the current browsing context.
 * Everything here is non-destructive — it writes and removes a few bytes in
 * OPFS and never opens a dialog or starts a download.
 */
export async function probeDownloadCapabilities(): Promise<DownloadCapabilities> {
  const fileSystemAccessApi =
    typeof (window as unknown as { showSaveFilePicker?: unknown })
      .showSaveFilePicker === "function";

  const inIframe = window.self !== window.top;
  let crossOriginIframe = false;
  if (inIframe) {
    try {
      // Throws on cross-origin access.
      void window.top!.location.origin;
    } catch {
      crossOriginIframe = true;
    }
  }

  let sandboxFlags: string | null = null;
  try {
    const frame = window.frameElement as HTMLIFrameElement | null;
    sandboxFlags = frame?.getAttribute("sandbox") ?? null;
  } catch {
    // Cross-origin parent: frameElement is not readable.
    sandboxFlags = null;
  }

  let opfsWritable = false;
  let opfsError: string | null = null;
  try {
    const dir = await navigator.storage.getDirectory();
    const probeName = `${OPFS_STAGING_PREFIX}probe`;
    const handle = await dir.getFileHandle(probeName, { create: true });
    const createWritable = (
      handle as unknown as { createWritable?: unknown }
    ).createWritable;
    if (typeof createWritable !== "function") {
      opfsError = "OPFS is present but createWritable() is not supported.";
    } else {
      const writable = await handle.createWritable();
      await writable.write(new Blob(["probe"]));
      await writable.close();
      const size = (await handle.getFile()).size;
      opfsWritable = size === 5;
      if (!opfsWritable) {
        opfsError = `OPFS write-back mismatch (wrote 5 bytes, read ${size}).`;
      }
    }
    await dir.removeEntry(probeName).catch(() => {});
  } catch (err) {
    opfsError = err instanceof Error ? err.message : String(err);
  }

  const expectedStrategy: SaveStrategy =
    fileSystemAccessApi && !crossOriginIframe
      ? "file-picker"
      : opfsWritable
        ? "opfs-download"
        : "memory-download";

  return {
    fileSystemAccessApi,
    inIframe,
    crossOriginIframe,
    sandboxFlags,
    opfsWritable,
    opfsError,
    expectedStrategy,
  };
}
