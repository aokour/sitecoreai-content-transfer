"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  SAVE_STRATEGY_LABELS,
  createArchiveWriter,
  probeDownloadCapabilities,
  readArchive,
  type DownloadCapabilities,
} from "@/lib/backup-archive";
import { CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

// Standalone on purpose: this route sits outside the (marketplace) group, so it
// renders without the SDK handshake and can be opened directly inside the
// Marketplace iframe to confirm a backup can actually reach the user's disk.

type TestResult = { ok: boolean; detail: string } | null;

function ResultRow({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail?: string | null;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="size-4 text-success-fg mt-0.5 shrink-0" />
      ) : (
        <XCircle className="size-4 text-danger-fg mt-0.5 shrink-0" />
      )}
      <div className="min-w-0">
        <span className="font-medium">{label}</span>
        {detail && (
          <p className="text-xs text-muted-foreground break-words">{detail}</p>
        )}
      </div>
    </div>
  );
}

export default function DownloadDiagnosticsPage() {
  const [caps, setCaps] = useState<DownloadCapabilities | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [roundTrip, setRoundTrip] = useState<TestResult>(null);
  const [saveTest, setSaveTest] = useState<TestResult>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    probeDownloadCapabilities()
      .then(setCaps)
      .catch((e) => setProbeError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Writes a small archive in memory and reads it straight back, proving the
  // zip writer, the manifest round-trip and the random-access reader all agree.
  async function runRoundTrip() {
    setBusy(true);
    setRoundTrip(null);
    try {
      const { BlobWriter, BlobReader, ZipWriter } = await import(
        "@zip.js/zip.js"
      );
      const payload = new Blob([crypto.getRandomValues(new Uint8Array(2048))]);
      const zw = new ZipWriter(new BlobWriter("application/zip"), {
        level: 0,
        zip64: true,
      });
      await zw.add(
        "manifest.json",
        new BlobReader(
          new Blob([
            JSON.stringify({
              formatVersion: 1,
              createdAt: new Date().toISOString(),
              createdBy: null,
              label: "diagnostic",
              sourceTenantId: "t",
              sourceTenantName: "t",
              subTransfers: [
                {
                  isMedia: false,
                  transferId: "diag",
                  dataTrees: [],
                  chunkSets: [
                    {
                      chunkSetId: "cs",
                      chunkCount: 1,
                      totalItemCount: 0,
                      chunks: [
                        {
                          chunkId: 0,
                          entry: "chunks/content/cs/0.raif",
                          size: payload.size,
                        },
                      ],
                    },
                  ],
                },
              ],
            }),
          ]),
        ),
        { level: 0 },
      );
      await zw.add("chunks/content/cs/0.raif", new BlobReader(payload), {
        level: 0,
      });
      const zipBlob = await zw.close();

      const reader = await readArchive(zipBlob);
      const back = await reader.getChunk("chunks/content/cs/0.raif");
      const [a, b] = await Promise.all([
        payload.arrayBuffer(),
        back.arrayBuffer(),
      ]);
      const same =
        a.byteLength === b.byteLength &&
        new Uint8Array(a).every((v, i) => v === new Uint8Array(b)[i]);
      await reader.close();

      setRoundTrip({
        ok: same,
        detail: same
          ? `Wrote and read back ${payload.size} bytes identically (archive ${zipBlob.size} bytes).`
          : "Bytes did not survive the round trip.",
      });
    } catch (e) {
      setRoundTrip({
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  // The real thing: build a tiny archive through the same code path a backup
  // uses, and try to get it onto disk.
  async function runSaveTest() {
    setBusy(true);
    setSaveTest(null);
    try {
      const writer = await createArchiveWriter("download-probe.zip");
      await writer.addJson("manifest.json", {
        formatVersion: 1,
        note: "diagnostic probe, not a real backup",
      });
      await writer.addChunk(
        "chunks/content/probe/0.raif",
        new Blob([crypto.getRandomValues(new Uint8Array(4096))]),
      );
      const delivery = await writer.close();
      setSaveTest({
        ok: true,
        detail: `Delivered via "${SAVE_STRATEGY_LABELS[delivery.strategy]}"${
          delivery.sizeBytes ? ` — ${delivery.sizeBytes} bytes` : ""
        }. Check your downloads for download-probe.zip. If nothing arrived, the iframe is blocking downloads.`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const aborted = e instanceof DOMException && e.name === "AbortError";
      setSaveTest({
        ok: false,
        detail: aborted ? "You dismissed the save dialog." : msg,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-6 py-8 max-w-3xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Download diagnostics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Open this page inside the Marketplace iframe to confirm a backup
            archive can reach your disk from here.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Browsing context</CardTitle>
            <CardDescription>
              Detected automatically. No dialogs, no downloads.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {probeError && (
              <Alert variant="danger">
                <AlertDescription>{probeError}</AlertDescription>
              </Alert>
            )}
            {!caps && !probeError && (
              <p className="text-sm text-muted-foreground">Probing…</p>
            )}
            {caps && (
              <>
                <ResultRow
                  label="File System Access API present"
                  ok={caps.fileSystemAccessApi}
                  detail={
                    caps.fileSystemAccessApi
                      ? "window.showSaveFilePicker is available."
                      : "Not available in this browser."
                  }
                />
                <ResultRow
                  label={
                    caps.crossOriginIframe
                      ? "Cross-origin iframe"
                      : caps.inIframe
                        ? "Same-origin iframe"
                        : "Top-level window"
                  }
                  ok={!caps.crossOriginIframe}
                  detail={
                    caps.crossOriginIframe
                      ? "showSaveFilePicker is blocked here; the OPFS download path will be used instead."
                      : "The save dialog is permitted in this context."
                  }
                />
                <ResultRow
                  label="Origin-private file system writable"
                  ok={caps.opfsWritable}
                  detail={
                    caps.opfsWritable
                      ? "Large archives can be staged outside of memory."
                      : (caps.opfsError ??
                        "Unavailable — archives would be held in memory.")
                  }
                />
                {caps.sandboxFlags !== null && (
                  <ResultRow
                    label="Frame sandbox attribute"
                    ok={caps.sandboxFlags.includes("allow-downloads")}
                    detail={`sandbox="${caps.sandboxFlags}"${
                      caps.sandboxFlags.includes("allow-downloads")
                        ? ""
                        : " — missing allow-downloads, so anchor downloads may be blocked."
                    }`}
                  />
                )}
                <Separator />
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">A backup here would use:</span>
                  <Badge colorScheme="primary" size="sm">
                    {SAVE_STRATEGY_LABELS[caps.expectedStrategy]}
                  </Badge>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Archive round trip</CardTitle>
            <CardDescription>
              Builds a small store-only archive in memory and reads it back to
              confirm chunk bytes survive byte-for-byte. Nothing is downloaded.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={runRoundTrip} disabled={busy} size="sm">
              Run round trip
            </Button>
            {roundTrip && (
              <ResultRow
                label={roundTrip.ok ? "Passed" : "Failed"}
                ok={roundTrip.ok}
                detail={roundTrip.detail}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Save to disk</CardTitle>
            <CardDescription>
              Runs the real delivery path and produces a small
              download-probe.zip. This one does open a dialog or start a
              download.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={runSaveTest} disabled={busy} size="sm">
              Try saving a probe archive
            </Button>
            {saveTest && (
              <ResultRow
                label={saveTest.ok ? "Delivery attempted" : "Failed"}
                ok={saveTest.ok}
                detail={saveTest.detail}
              />
            )}
            <Alert>
              <AlertDescription className="text-xs">
                A browser cannot report a download that the host page silently
                blocked. If this says it succeeded but no file appears, the
                iframe is missing <code>allow-downloads</code> and the host
                needs to add it.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
