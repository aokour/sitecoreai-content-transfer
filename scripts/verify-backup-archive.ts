/**
 * Verifies the archive format contract that the backup and restore hooks both
 * depend on: chunk bytes survive a round trip untouched, the manifest replays
 * the media/content split and the original transfer ids, and a damaged archive
 * is rejected before anything is uploaded.
 *
 *   node scripts/verify-backup-archive.ts
 */
import { BlobReader, BlobWriter, ZipReader, ZipWriter } from "@zip.js/zip.js";
import {
  BACKUP_FORMAT_VERSION,
  MANIFEST_ENTRY,
  ManifestError,
  archiveFileName,
  chunkEntryName,
  parseManifest,
  readArchive,
  totalChunkBytes,
  totalChunkCount,
  totalItemCount,
  type BackupManifest,
} from "../lib/backup-archive.ts";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function expectReject(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    failures++;
    console.error(`  ✗ ${name} — expected a rejection but it resolved`);
  } catch (err) {
    const isManifestError = err instanceof ManifestError;
    check(
      name,
      isManifestError,
      isManifestError ? "" : `threw ${(err as Error).name} instead`,
    );
  }
}

function randomBytes(n: number) {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = (i * 7 + 13) % 256;
  return a;
}

/** Builds an archive the way the backup hook does: store-only, zip64, chunks
 *  first and the manifest sealed in last. */
async function buildArchive(
  manifest: BackupManifest,
  chunkData: Map<string, Uint8Array>,
) {
  const zw = new ZipWriter(new BlobWriter("application/zip"), {
    level: 0,
    zip64: true,
    keepOrder: true,
  });
  for (const [entry, bytes] of chunkData) {
    await zw.add(entry, new BlobReader(new Blob([bytes as BufferSource])), {
      level: 0,
    });
  }
  await zw.add(
    MANIFEST_ENTRY,
    new BlobReader(new Blob([JSON.stringify(manifest, null, 2)])),
    { level: 0 },
  );
  return zw.close();
}

async function main() {
  // A mixed backup: one media sub-transfer and one content sub-transfer, each
  // with its own transferId, exactly as the hook splits them.
  const mediaTransferId = "11111111-1111-4111-8111-111111111111";
  const contentTransferId = "22222222-2222-4222-8222-222222222222";
  const chunkData = new Map<string, Uint8Array>();

  const mediaEntry0 = chunkEntryName(true, "media-set-1", 0);
  const mediaEntry1 = chunkEntryName(true, "media-set-1", 1);
  const contentEntry0 = chunkEntryName(false, "content-set-1", 0);
  chunkData.set(mediaEntry0, randomBytes(4096));
  chunkData.set(mediaEntry1, randomBytes(1024));
  chunkData.set(contentEntry0, randomBytes(2048));

  const manifest: BackupManifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: "2026-09-07T00:00:00.000Z",
    createdBy: { id: "u1", name: "Ada Lovelace", email: "ada@example.com" },
    label: "Nightly Home backup",
    sourceTenantId: "tenant-abc",
    sourceTenantName: "Prod EU",
    subTransfers: [
      {
        isMedia: true,
        transferId: mediaTransferId,
        dataTrees: [
          {
            itemPath: "/sitecore/media library/Images",
            scope: "ItemAndDescendants",
            mergeStrategy: "OverrideExistingItem",
          },
        ],
        chunkSets: [
          {
            chunkSetId: "media-set-1",
            chunkCount: 2,
            totalItemCount: 40,
            chunks: [
              { chunkId: 0, entry: mediaEntry0, size: 4096 },
              { chunkId: 1, entry: mediaEntry1, size: 1024 },
            ],
          },
        ],
      },
      {
        isMedia: false,
        transferId: contentTransferId,
        dataTrees: [
          {
            itemPath: "/sitecore/content/Home",
            scope: "ItemAndDescendants",
            mergeStrategy: "OverrideExistingTree",
          },
        ],
        chunkSets: [
          {
            chunkSetId: "content-set-1",
            chunkCount: 1,
            totalItemCount: 412,
            chunks: [{ chunkId: 0, entry: contentEntry0, size: 2048 }],
          },
        ],
      },
    ],
  };

  console.log("\nArchive round trip");
  const zipBlob = await buildArchive(manifest, chunkData);
  const archive = await readArchive(zipBlob);

  check(
    "manifest survives the round trip",
    JSON.stringify(archive.manifest) === JSON.stringify(manifest),
  );
  check(
    "media/content split is preserved",
    archive.manifest.subTransfers.length === 2 &&
      archive.manifest.subTransfers[0].isMedia === true &&
      archive.manifest.subTransfers[1].isMedia === false,
  );
  check(
    "transfer ids are replayable verbatim",
    archive.manifest.subTransfers[0].transferId === mediaTransferId &&
      archive.manifest.subTransfers[1].transferId === contentTransferId,
  );
  check(
    "createdBy provenance is retained",
    archive.manifest.createdBy?.email === "ada@example.com",
  );

  for (const [entry, expected] of chunkData) {
    const blob = await archive.getChunk(entry);
    const actual = new Uint8Array(await blob.arrayBuffer());
    const identical =
      actual.length === expected.length &&
      actual.every((v, i) => v === expected[i]);
    check(`chunk bytes identical — ${entry}`, identical);
  }
  await archive.close();

  console.log("\nStorage is store-only (chunks must not be re-encoded)");
  const zr = new ZipReader(new BlobReader(zipBlob));
  const entries = await zr.getEntries();
  check(
    "every entry uses compression method 0",
    entries.every((e) => e.compressionMethod === 0),
    entries.map((e) => `${e.filename}=${e.compressionMethod}`).join(", "),
  );
  check(
    "archive is not smaller than its payload (nothing was compressed)",
    zipBlob.size >= totalChunkBytes(manifest),
  );
  await zr.close();

  console.log("\nManifest helpers");
  check("totalChunkCount", totalChunkCount(manifest) === 3);
  check("totalItemCount", totalItemCount(manifest) === 452);
  check("totalChunkBytes", totalChunkBytes(manifest) === 7168);
  check(
    "entry names separate media from content",
    mediaEntry0.startsWith("chunks/media/") &&
      contentEntry0.startsWith("chunks/content/"),
  );
  check(
    "archiveFileName slugifies and stamps",
    /^nightly-home-backup_\d{4}-\d{2}-\d{2}T/.test(
      archiveFileName("Nightly Home backup", new Date()),
    ),
  );
  check(
    "archiveFileName falls back when the label is unusable",
    archiveFileName("!!!", new Date()).startsWith("content-backup_"),
  );

  console.log("\nCorrupt and unsupported archives are refused");
  await expectReject("a future formatVersion is rejected", async () =>
    parseManifest(JSON.stringify({ ...manifest, formatVersion: 99 })),
  );
  await expectReject("a manifest with no sub-transfers is rejected", async () =>
    parseManifest(JSON.stringify({ ...manifest, subTransfers: [] })),
  );
  await expectReject("malformed JSON is rejected", async () =>
    parseManifest("{not json"),
  );

  const missingChunk: BackupManifest = JSON.parse(JSON.stringify(manifest));
  missingChunk.subTransfers[0].chunkSets[0].chunks[0].entry =
    "chunks/media/media-set-1/999.raif";
  await expectReject(
    "a manifest referencing an absent chunk is rejected before upload",
    async () => readArchive(await buildArchive(missingChunk, chunkData)),
  );

  const noManifest = new ZipWriter(new BlobWriter("application/zip"), {
    level: 0,
  });
  await noManifest.add("readme.txt", new BlobReader(new Blob(["hi"])));
  await expectReject("a zip with no manifest.json is rejected", async () =>
    readArchive(await noManifest.close()),
  );

  await expectReject("a non-zip file is rejected", async () =>
    readArchive(new Blob(["definitely not a zip"])),
  );

  console.log(
    failures === 0
      ? "\nAll archive format checks passed.\n"
      : `\n${failures} check(s) failed.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
