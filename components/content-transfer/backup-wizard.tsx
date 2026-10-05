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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useContentBackup } from "@/hooks/use-content-backup";
import { useEnvironments } from "@/hooks/use-environments";
import {
  SAVE_STRATEGY_LABELS,
  archiveFileName,
  formatBytes,
} from "@/lib/backup-archive";
import type { DataTreeItem } from "@/lib/content-transfer";
import {
  MERGE_STRATEGY_OPTIONS,
  SCOPE_OPTIONS,
  getEnvironmentId,
  getEnvironmentLabel,
  getEnvironmentTenantId,
} from "@/lib/content-transfer";
import { ArrowLeft, ArrowRight, Download, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AddLocalEnvironmentButton } from "./add-local-environment-button";
import { DockerIcon } from "./docker-icon";
import { EnvironmentOptionLabel } from "./environment-badge";
import { InlineItemSelector } from "./inline-item-selector";
import {
  TransferProgressDisplay,
  type ProgressStep,
} from "./transfer-progress";
import { WizardEnvironmentPanel, WizardShell } from "./wizard-shell";

const STEPS = [
  { label: "Environment", description: "Choose what to back up" },
  { label: "Items", description: "Configure content paths" },
  { label: "Review", description: "Confirm the archive" },
  { label: "Download", description: "Package and save" },
];

const BACKUP_PROGRESS_STEPS: ProgressStep[] = [
  { key: "creating", label: "Create" },
  { key: "preparing", label: "Package" },
  { key: "downloading", label: "Download" },
  { key: "archiving", label: "Archive" },
];

interface BackupWizardProps {
  initialSourceId?: string | null;
}

export function BackupWizard({ initialSourceId }: BackupWizardProps) {
  const router = useRouter();
  const {
    startBackup,
    phase,
    progress,
    error,
    detail,
    chunkSetsMetadata,
    delivery,
    fileName,
    isRunning,
  } = useContentBackup();

  const [currentStep, setCurrentStep] = useState(0);
  const [sourceId, setSourceId] = useState<string | null>(
    initialSourceId ?? null,
  );
  const [label, setLabel] = useState("");
  const [dataTrees, setDataTrees] = useState<DataTreeItem[]>([]);

  const environments = useEnvironments();
  const marketplaceEnvs = environments.filter((e) => e.kind === "marketplace");
  const dockerEnvs = environments.filter((e) => e.kind === "local-docker");
  const sourceEnv = environments.find((e) => getEnvironmentId(e) === sourceId);

  const previewFileName = useMemo(
    () => archiveFileName(label.trim() || "Content Backup", new Date()),
    [label],
  );

  const step0Valid = !!sourceId;
  const step1Valid =
    dataTrees.length > 0 &&
    dataTrees.every((item) => item.itemPath.trim().length > 0);

  const wizardSteps = STEPS.map((step, i) => {
    if (i !== STEPS.length - 1) return step;
    if (phase === "completed") {
      return { ...step, status: "completed" as const, description: "Saved" };
    }
    if (phase === "failed") return { ...step, description: "Failed" };
    return step;
  });

  // The save dialog can only be opened from a user gesture, so the backup is
  // started by the button rather than by an effect on entering the last step.
  async function startAndAdvance() {
    if (!sourceId || !sourceEnv) return;
    setCurrentStep(3);
    await startBackup({
      label: label.trim() || "Content Backup",
      sourceContextId: sourceId,
      sourceTenantId: getEnvironmentTenantId(sourceEnv),
      sourceTenantName: getEnvironmentLabel(sourceEnv),
      dataTrees,
    });
  }

  return (
    <WizardShell
      title="New Content Backup"
      subtitle="Package content from an environment into a downloadable archive"
      steps={wizardSteps}
      currentStep={currentStep}
      aside={
        currentStep > 0 && sourceEnv ? (
          <WizardEnvironmentPanel
            heading="Source"
            name={getEnvironmentLabel(sourceEnv)}
          />
        ) : null
      }
      actions={
        <>
          <Button
            variant="outline"
            className="w-full"
            onClick={
              currentStep === 3
                ? () => router.push("/")
                : () => setCurrentStep((s) => Math.max(s - 1, 0))
            }
            disabled={currentStep === 3 && isRunning}
          >
            <ArrowLeft className="size-4 mr-2" />
            {currentStep === 3 ? "Back to Dashboard" : "Back"}
          </Button>

          {currentStep < 3 && (
            <Button
              className="w-full"
              onClick={
                currentStep === 2
                  ? startAndAdvance
                  : () => setCurrentStep((s) => s + 1)
              }
              disabled={
                (currentStep === 0 && !step0Valid) ||
                (currentStep === 1 && !step1Valid)
              }
            >
              {currentStep === 2 ? (
                <>
                  <Download className="size-4 mr-2" />
                  Create Backup
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="size-4 ml-2" />
                </>
              )}
            </Button>
          )}

          {currentStep === 3 &&
            phase === "completed" &&
            delivery?.redeliver && (
              <Button
                variant="outline"
                className="w-full"
                onClick={delivery.redeliver}
              >
                <Download className="size-4 mr-2" />
                Save again
              </Button>
            )}

          {currentStep === 3 &&
            (phase === "completed" || phase === "failed") && (
              <Button
                className="w-full"
                onClick={() => {
                  router.push("/backup/new");
                  window.location.reload();
                }}
              >
                <RotateCcw className="size-4 mr-2" />
                New Backup
              </Button>
            )}
        </>
      }
    >
      {/* ── Step 0: Environment ─────────────────────────────────────────── */}
      {currentStep === 0 && (
        <>
          <CardHeader className="mx-auto w-full max-w-2xl">
            <CardTitle>Select Environment</CardTitle>
            <CardDescription>
              Choose the environment to package content from. A backup only
              reads — nothing in this environment is modified.
            </CardDescription>
          </CardHeader>
          <CardContent className="mx-auto w-full max-w-2xl space-y-4">
            <div className="space-y-2">
              <Label htmlFor="backup-source">Source Environment</Label>
              <Select
                value={sourceId ?? ""}
                onValueChange={setSourceId}
                disabled={environments.length === 0}
              >
                <SelectTrigger id="backup-source" className="w-full">
                  <SelectValue placeholder="Select environment..." />
                </SelectTrigger>
                <SelectContent>
                  {marketplaceEnvs.map((env) => {
                    const id = getEnvironmentId(env);
                    return (
                      <SelectItem key={id} value={id}>
                        <EnvironmentOptionLabel env={env} />
                      </SelectItem>
                    );
                  })}
                  {dockerEnvs.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="flex items-center gap-1.5">
                        <DockerIcon className="size-3.5 shrink-0" />
                        Local Docker
                      </SelectLabel>
                      {dockerEnvs.map((env) => {
                        const id = getEnvironmentId(env);
                        return (
                          <SelectItem key={id} value={id}>
                            <EnvironmentOptionLabel env={env} />
                          </SelectItem>
                        );
                      })}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
              {sourceEnv && (
                <p className="text-xs text-muted-foreground truncate">
                  {sourceEnv.kind === "marketplace"
                    ? `Context: ${sourceEnv.context.preview}`
                    : sourceEnv.baseUrl}
                </p>
              )}
            </div>
            {environments.length === 0 && (
              <Alert variant="warning">
                <AlertDescription>
                  No environments found in application context. Ensure this app
                  has been granted access to SitecoreAI environments in the
                  Sitecore Cloud Portal.
                </AlertDescription>
              </Alert>
            )}
            <AddLocalEnvironmentButton />
          </CardContent>
        </>
      )}

      {/* ── Step 1: Items ───────────────────────────────────────────────── */}
      {currentStep === 1 && (
        <CardContent className="mx-auto w-full max-w-6xl">
          <InlineItemSelector
            items={dataTrees}
            onChange={setDataTrees}
            sourceContextId={sourceId}
            destinationContextId={null}
            sourceEnvName={
              sourceEnv ? getEnvironmentLabel(sourceEnv) : undefined
            }
            label={label}
            onLabelChange={setLabel}
            mode="backup"
          />
        </CardContent>
      )}

      {/* ── Step 2: Review ──────────────────────────────────────────────── */}
      {currentStep === 2 && (
        <>
          <CardHeader>
            <CardTitle>Review Backup</CardTitle>
            <CardDescription>
              Confirm what goes into the archive. Packaging runs on the source
              environment and the archive is saved to your computer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-lg border p-4 space-y-2">
              <h4 className="text-sm font-medium">Source</h4>
              <p className="text-sm text-muted-foreground">
                {sourceEnv ? getEnvironmentLabel(sourceEnv) : ""}
              </p>
            </div>

            <div className="rounded-lg border p-4 space-y-2">
              <h4 className="text-sm font-medium">Archive</h4>
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono break-all">
                {previewFileName}
              </code>
            </div>

            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Content Items</h4>
                <Badge colorScheme="neutral" size="sm">
                  {dataTrees.length} item{dataTrees.length !== 1 ? "s" : ""}
                </Badge>
              </div>
              <div className="space-y-2">
                {dataTrees.map((item, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                      {item.itemPath}
                    </code>
                    <Badge colorScheme="primary" size="sm">
                      {SCOPE_OPTIONS.find((s) => s.value === item.scope)
                        ?.label ?? item.scope}
                    </Badge>
                    <Badge colorScheme="neutral" size="sm">
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
                Scope and merge strategy are frozen into the package when it is
                built. A restore replays exactly these settings and cannot
                change them — only the destination is chosen later.
              </AlertDescription>
            </Alert>
          </CardContent>
        </>
      )}

      {/* ── Step 3: Progress and download ───────────────────────────────── */}
      {currentStep === 3 && (
        <>
          <CardHeader>
            <CardTitle>Creating Backup</CardTitle>
            <CardDescription>
              Content is packaged on the source and streamed into the archive.
              Do not close this window while the backup is running.
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
              steps={BACKUP_PROGRESS_STEPS}
            />

            {phase === "completed" && delivery && (
              <Alert variant="success">
                <AlertDescription>
                  <span className="font-medium">{fileName}</span> is ready
                  {delivery.sizeBytes
                    ? ` (${formatBytes(delivery.sizeBytes)})`
                    : ""}
                  . Delivered via {SAVE_STRATEGY_LABELS[delivery.strategy]}.
                  {delivery.redeliver && (
                    <>
                      {" "}
                      If the download did not appear, use{" "}
                      <span className="font-medium">Save again</span>.
                    </>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </>
      )}
    </WizardShell>
  );
}
