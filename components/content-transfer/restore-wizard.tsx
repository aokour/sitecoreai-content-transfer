"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { useContentRestore } from "@/hooks/use-content-restore";
import { useEnvironments } from "@/hooks/use-environments";
import {
  ManifestError,
  formatBytes,
  manifestDataTrees,
  readArchive,
  totalChunkCount,
  totalItemCount,
  type BackupManifest,
} from "@/lib/backup-archive";
import {
  MERGE_STRATEGY_OPTIONS,
  SCOPE_OPTIONS,
  getEnvironmentId,
  getEnvironmentLabel,
  getEnvironmentTenantId,
} from "@/lib/content-transfer";
import { ArrowLeft, ArrowRight, RotateCcw, Upload, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AddLocalEnvironmentButton } from "./add-local-environment-button";
import { RestorePreview } from "./restore-preview";
import { TransferProgressDisplay, type ProgressStep } from "./transfer-progress";
import { WizardEnvironmentPanel, WizardShell } from "./wizard-shell";

const STEPS = [
  { label: "Archive", description: "Choose a backup file" },
  { label: "Details", description: "What is in the package" },
  { label: "Destination", description: "Where it will be applied" },
  { label: "Preview", description: "Confirm the impact" },
  { label: "Progress", description: "Live restore status" },
];

const RESTORE_PROGRESS_STEPS: ProgressStep[] = [
  { key: "reading", label: "Read" },
  { key: "transferring", label: "Upload" },
  { key: "importing", label: "Import" },
];

export function RestoreWizard() {
  const router = useRouter();
  const {
    startRestore,
    phase,
    progress,
    error,
    detail,
    chunkSetsMetadata,
    cancellable,
    isRunning,
    cancel,
  } = useContentRestore();

  const [currentStep, setCurrentStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [manifest, setManifest] = useState<BackupManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const environments = useEnvironments();
  const destEnv = environments.find(
    (e) => getEnvironmentId(e) === destinationId,
  );
  const destName = destEnv ? getEnvironmentLabel(destEnv) : "the destination";

  const dataTrees = manifest ? manifestDataTrees(manifest) : [];
  const needsAcknowledgement = dataTrees.some(
    (dt) => dt.mergeStrategy === "OverrideExistingTree",
  );
  // The archive's own tenant id is the reliable way to spot a round trip;
  // display names can repeat across environments.
  const restoringIntoSource =
    !!manifest?.sourceTenantId &&
    !!destEnv &&
    manifest.sourceTenantId === getEnvironmentTenantId(destEnv);

  async function acceptFile(picked: File) {
    setFile(picked);
    setManifest(null);
    setManifestError(null);
    setIsParsing(true);
    try {
      // Reads only the central directory and manifest.json, so this stays
      // instant even for a multi-gigabyte archive.
      const archive = await readArchive(picked);
      setManifest(archive.manifest);
      await archive.close();
    } catch (err) {
      setManifestError(
        err instanceof ManifestError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setIsParsing(false);
    }
  }

  async function startAndAdvance() {
    if (!file || !destinationId || !destEnv) return;
    setCurrentStep(4);
    await startRestore({
      file,
      destinationContextId: destinationId,
      destinationTenantName: getEnvironmentLabel(destEnv),
    });
  }

  const step0Valid = !!manifest && !manifestError;
  const step2Valid = !!destinationId;
  const step3Valid = !needsAcknowledgement || acknowledged;

  const wizardSteps = STEPS.map((step, i) => {
    if (i !== STEPS.length - 1) return step;
    if (phase === "completed") {
      return { ...step, status: "completed" as const, description: "Completed" };
    }
    if (phase === "failed") return { ...step, description: "Failed" };
    return step;
  });

  return (
    <WizardShell
      title="Restore from Backup"
      subtitle="Apply a previously downloaded package to an environment"
      steps={wizardSteps}
      currentStep={currentStep}
      aside={
        currentStep > 2 && destEnv ? (
          <WizardEnvironmentPanel
            heading="Destination"
            name={getEnvironmentLabel(destEnv)}
            tone="success"
          />
        ) : null
      }
      actions={
        <>
          <Button
            variant="outline"
            className="w-full"
            onClick={
              currentStep === 4
                ? () => router.push("/")
                : () => setCurrentStep((s) => Math.max(s - 1, 0))
            }
            disabled={currentStep === 4 && isRunning}
          >
            <ArrowLeft className="size-4 mr-2" />
            {currentStep === 4 ? "Back to Dashboard" : "Back"}
          </Button>

          {currentStep < 4 && (
            <Button
              className="w-full"
              onClick={
                currentStep === 3
                  ? startAndAdvance
                  : () => setCurrentStep((s) => s + 1)
              }
              disabled={
                (currentStep === 0 && !step0Valid) ||
                (currentStep === 2 && !step2Valid) ||
                (currentStep === 3 && !step3Valid)
              }
            >
              {currentStep === 3 ? (
                <>
                  <Play className="size-4 mr-2" />
                  Start Restore
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="size-4 ml-2" />
                </>
              )}
            </Button>
          )}

          {currentStep === 4 && isRunning && (
            <Button
              variant="outline"
              className="w-full"
              onClick={cancel}
              disabled={!cancellable}
              title={
                cancellable
                  ? undefined
                  : "A package is mid-import. Stopping now would leave a file on the destination that cannot be cleaned up."
              }
            >
              {cancellable ? "Cancel restore" : "Cannot cancel during import"}
            </Button>
          )}

          {currentStep === 4 && (phase === "completed" || phase === "failed") && (
            <Button
              className="w-full"
              onClick={() => {
                router.push("/restore/new");
                window.location.reload();
              }}
            >
              <RotateCcw className="size-4 mr-2" />
              New Restore
            </Button>
          )}
        </>
      }
    >
      {/* ── Step 0: Archive ─────────────────────────────────────────────── */}
      {currentStep === 0 && (
        <>
          <CardHeader>
            <CardTitle>Choose an Archive</CardTitle>
            <CardDescription>
              Select a .zip produced by this app&apos;s backup flow. Only the
              manifest is read now — nothing is uploaded yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) acceptFile(dropped);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-lg border-2 border-dashed p-10 text-center cursor-pointer transition-colors ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <Upload className="size-8 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium">
                Drop a backup archive here, or click to browse
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                .zip files created by Create Backup
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  if (picked) acceptFile(picked);
                }}
              />
            </div>

            {file && (
              <div className="rounded-lg border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(file.size)}
                    </p>
                  </div>
                  {isParsing && <Spinner className="size-4" />}
                </div>
              </div>
            )}

            {manifestError && (
              <Alert variant="danger">
                <AlertDescription>{manifestError}</AlertDescription>
              </Alert>
            )}

            {manifest && !manifestError && (
              <Alert variant="success">
                <AlertDescription>
                  Archive read successfully — {dataTrees.length} path
                  {dataTrees.length === 1 ? "" : "s"},{" "}
                  {totalChunkCount(manifest)} chunk
                  {totalChunkCount(manifest) === 1 ? "" : "s"}.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </>
      )}

      {/* ── Step 1: Details ─────────────────────────────────────────────── */}
      {currentStep === 1 && manifest && (
        <>
          <CardHeader>
            <CardTitle>Archive Details</CardTitle>
            <CardDescription>
              Recorded when this package was created. None of it can be changed
              at restore time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-lg border p-4 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Label</p>
                <p className="text-sm font-medium">
                  {manifest.label || "Untitled backup"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p className="text-sm font-medium">
                  {manifest.createdAt
                    ? new Date(manifest.createdAt).toLocaleString()
                    : "Unknown"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Created by</p>
                <p className="text-sm font-medium">
                  {manifest.createdBy?.name || "Not recorded"}
                </p>
                {manifest.createdBy?.email && (
                  <p className="text-xs text-muted-foreground">
                    {manifest.createdBy.email}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Source</p>
                <p className="text-sm font-medium">
                  {manifest.sourceTenantName || "Unknown"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Contents</p>
                <p className="text-sm font-medium">
                  {totalItemCount(manifest)} item
                  {totalItemCount(manifest) === 1 ? "" : "s"} across{" "}
                  {totalChunkCount(manifest)} chunk
                  {totalChunkCount(manifest) === 1 ? "" : "s"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Archive size</p>
                <p className="text-sm font-medium">
                  {file ? formatBytes(file.size) : "—"}
                </p>
              </div>
            </div>

            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Paths in this package</h4>
                <Badge colorScheme="neutral" size="sm">
                  {dataTrees.length} path{dataTrees.length === 1 ? "" : "s"}
                </Badge>
              </div>
              <div className="space-y-2">
                {dataTrees.map((item, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono break-all">
                      {item.itemPath}
                    </code>
                    <Badge colorScheme="primary" size="sm">
                      {SCOPE_OPTIONS.find((s) => s.value === item.scope)
                        ?.label ?? item.scope}
                    </Badge>
                    <Badge
                      colorScheme={
                        item.mergeStrategy === "OverrideExistingTree"
                          ? "danger"
                          : "neutral"
                      }
                      size="sm"
                    >
                      {MERGE_STRATEGY_OPTIONS.find(
                        (s) => s.value === item.mergeStrategy,
                      )?.label ?? item.mergeStrategy}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>

            <Alert variant="warning">
              <AlertDescription>
                Scope and merge strategy were frozen into the package when it
                was built. The restore replays them exactly — the only choice
                left is which environment to apply them to.
              </AlertDescription>
            </Alert>
          </CardContent>
        </>
      )}

      {/* ── Step 2: Destination ─────────────────────────────────────────── */}
      {currentStep === 2 && (
        <>
          <CardHeader>
            <CardTitle>Select Destination</CardTitle>
            <CardDescription>
              Choose the environment this package will be imported into.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 max-w-md">
              <Label htmlFor="restore-dest">Destination Environment</Label>
              <Select
                value={destinationId ?? ""}
                onValueChange={setDestinationId}
                disabled={environments.length === 0}
              >
                <SelectTrigger id="restore-dest" className="w-full">
                  <SelectValue placeholder="Select environment..." />
                </SelectTrigger>
                <SelectContent>
                  {environments.map((env) => {
                    const id = getEnvironmentId(env);
                    return (
                      <SelectItem key={id} value={id}>
                        <div className="flex items-center gap-2">
                          <span>{getEnvironmentLabel(env)}</span>
                          <Badge colorScheme="neutral" size="sm">
                            {env.kind === "local-docker"
                              ? "Local Docker"
                              : env.tenantId.slice(0, 6)}
                          </Badge>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {destEnv && (
                <p className="text-xs text-muted-foreground truncate">
                  {destEnv.kind === "marketplace"
                    ? `Context: ${destEnv.context.preview}`
                    : destEnv.baseUrl}
                </p>
              )}
              <AddLocalEnvironmentButton />
            </div>

            {restoringIntoSource && (
              <Alert variant="warning">
                <AlertDescription>
                  This archive was created from{" "}
                  <span className="font-medium">
                    {manifest?.sourceTenantName}
                  </span>
                  , which is the environment you have selected. Restoring rolls
                  this content back to how it looked when the backup was taken.
                </AlertDescription>
              </Alert>
            )}

            {environments.length === 0 && (
              <Alert variant="warning">
                <AlertDescription>
                  No environments found in application context. Ensure this app
                  has been granted access to SitecoreAI environments in the
                  Sitecore Cloud Portal.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </>
      )}

      {/* ── Step 3: Preview ─────────────────────────────────────────────── */}
      {currentStep === 3 && manifest && (
        <>
          <CardHeader>
            <CardTitle>Preview and Confirm</CardTitle>
            <CardDescription>
              What this package will do to {destName}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RestorePreview
              manifest={manifest}
              destinationContextId={destinationId}
              destinationName={destName}
              acknowledged={acknowledged}
              onAcknowledgedChange={setAcknowledged}
            />
          </CardContent>
        </>
      )}

      {/* ── Step 4: Progress ────────────────────────────────────────────── */}
      {currentStep === 4 && (
        <>
          <CardHeader>
            <CardTitle>Restore in Progress</CardTitle>
            <CardDescription>
              Chunks are uploaded to {destName}, assembled, and imported. Do not
              close this window while the restore is running.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <TransferProgressDisplay
              phase={phase}
              progress={progress}
              error={error}
              detail={detail}
              chunkSetsMetadata={chunkSetsMetadata}
              transferId={null}
              steps={RESTORE_PROGRESS_STEPS}
            />

            {isRunning && !cancellable && (
              <Alert variant="warning">
                <AlertDescription>
                  A package is being assembled and imported. Cancelling now
                  would strand a file on the destination that nothing collects
                  and no API can delete, so the restore has to finish this step.
                </AlertDescription>
              </Alert>
            )}

            {phase === "completed" && (
              <>
                <Separator />
                <Alert variant="success">
                  <AlertDescription>
                    Restore complete. The imported package remains on{" "}
                    {destName} as a retained source file — Sitecore keeps it for
                    import history and it cannot be removed through the
                    Marketplace SDK.
                  </AlertDescription>
                </Alert>
              </>
            )}
          </CardContent>
        </>
      )}
    </WizardShell>
  );
}
