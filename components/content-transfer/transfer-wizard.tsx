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
import { Stepper } from "@/components/ui/stepper";
import { Timeline } from "@/components/ui/timeline";
import { EnvironmentSelector } from "./environment-selector";
import { InlineItemSelector } from "./inline-item-selector";
import { TransferProgressDisplay } from "./transfer-progress";
import { useContentTransfer } from "@/hooks/use-content-transfer";
import { useEnvironments } from "@/hooks/use-environments";
import type { DataTreeItem } from "@/lib/content-transfer";
import {
  generateTransferId,
  getEnvironmentLabel,
  MERGE_STRATEGY_OPTIONS,
  SCOPE_OPTIONS,
} from "@/lib/content-transfer";
import { ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const STEPS = [
  { label: "Environments", description: "Select source & destination" },
  { label: "Items", description: "Configure content paths" },
  { label: "Review", description: "Confirm your transfer" },
  { label: "Progress", description: "Live transfer status" },
];

interface TransferWizardProps {
  initialSourceId?: string | null;
  initialDestinationId?: string | null;
}

export function TransferWizard({
  initialSourceId,
  initialDestinationId,
}: TransferWizardProps) {
  const router = useRouter();
  const { startTransfer, phase, progress, error, transferId, chunkSetsMetadata, isRunning } =
    useContentTransfer();

  // ── Step state ────────────────────────────────────────────────────────────
  const [currentStep, setCurrentStep] = useState(0);

  // ── Form state ────────────────────────────────────────────────────────────
  const [sourceId, setSourceId] = useState<string | null>(initialSourceId ?? null);
  const [destinationId, setDestinationId] = useState<string | null>(
    initialDestinationId ?? null
  );
  const [label, setLabel] = useState("");
  const [dataTrees, setDataTrees] = useState<DataTreeItem[]>([]);

  // ── Derived environment info ──────────────────────────────────────────────
  const environments = useEnvironments();

  const sourceEnv = environments.find((e) => e.context.preview === sourceId);
  const destEnv = environments.find((e) => e.context.preview === destinationId);

  // Reflect the transfer's final outcome on the last stepper step, instead of
  // leaving it as "active" once the transfer has actually finished/failed.
  const wizardSteps = STEPS.map((step, i) => {
    if (i !== STEPS.length - 1) return step;
    if (phase === "completed") {
      return { ...step, status: "completed" as const, description: "Completed" };
    }
    if (phase === "failed") {
      return { ...step, description: "Failed" };
    }
    return step;
  });

  // ── Validation ────────────────────────────────────────────────────────────
  const step0Valid = !!sourceId && !!destinationId && sourceId !== destinationId;
  const step1Valid =
    dataTrees.length > 0 &&
    dataTrees.every((item) => item.itemPath.trim().length > 0);

  // Guard so StrictMode double-invocation only fires startTransfer once
  const transferStartedRef = useRef(false);

  // ── Kick off transfer when entering step 3 ────────────────────────────────
  useEffect(() => {
    if (currentStep === 3 && phase === "idle" && !transferStartedRef.current) {
      if (!sourceId || !destinationId || !sourceEnv || !destEnv) return;
      transferStartedRef.current = true;
      const tid = generateTransferId();
      startTransfer({
        transferId: tid,
        label: label.trim() || "Content Transfer",
        sourceContextId: sourceId,
        destinationContextId: destinationId,
        sourceTenantName: getEnvironmentLabel(sourceEnv),
        destinationTenantName: getEnvironmentLabel(destEnv),
        dataTrees,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  // ── Navigation ────────────────────────────────────────────────────────────
  function goNext() {
    setCurrentStep((s) => Math.min(s + 1, 3));
  }
  function goBack() {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen bg-background">
      {/* ── Sidebar — sticky so it never scrolls ─────────────────────────── */}
      <aside className="w-64 shrink-0 border-r bg-card flex flex-col px-6 py-6 gap-5 sticky top-0 h-screen overflow-y-auto">
        {/* Dashboard link */}
        <Button variant="ghost" size="sm" className="w-fit -ml-2" asChild>
          <Link href="/">
            <ArrowLeft className="size-4 mr-2" />
            Dashboard
          </Link>
        </Button>

        {/* Page title */}
        <div>
          <h1 className="text-sm font-semibold leading-tight">New Content Transfer</h1>
          <p className="text-xs text-muted-foreground mt-1 leading-snug">
            Configure and start a content transfer between environments
          </p>
        </div>

        <Separator />

        {/* Environment route — visible on steps 1–3 */}
        {currentStep > 0 && sourceEnv && destEnv && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Transfer Route
            </p>
            <div className="rounded-md border bg-muted/30 p-3">
              <Timeline.Root size="sm">
                <Timeline.Item>
                  <Timeline.Separator>
                    <Timeline.Indicator size="sm" className="size-2 bg-primary" />
                    <Timeline.Connector />
                  </Timeline.Separator>
                  <Timeline.Content className="gap-0.5 pb-2">
                    <Timeline.Description className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                      Source
                    </Timeline.Description>
                    <Timeline.Title className="text-xs font-medium truncate">
                      {getEnvironmentLabel(sourceEnv)}
                    </Timeline.Title>
                  </Timeline.Content>
                </Timeline.Item>
                <Timeline.Item>
                  <Timeline.Separator>
                    <Timeline.Indicator size="sm" className="size-2 bg-success-fg" />
                  </Timeline.Separator>
                  <Timeline.Content className="gap-0.5">
                    <Timeline.Description className="text-[10px] font-semibold uppercase tracking-wide text-success-fg">
                      Destination
                    </Timeline.Description>
                    <Timeline.Title className="text-xs font-medium truncate">
                      {getEnvironmentLabel(destEnv)}
                    </Timeline.Title>
                  </Timeline.Content>
                </Timeline.Item>
              </Timeline.Root>
            </div>
          </div>
        )}

        {/* Navigation buttons */}
        <div className="flex flex-col gap-2">
          {/* Back button */}
          <Button
            variant="outline"
            className="w-full"
            onClick={currentStep === 3 ? () => router.push("/") : goBack}
            disabled={currentStep === 3 && isRunning}
          >
            {currentStep === 3 ? (
              <>
                <ArrowLeft className="size-4 mr-2" />
                Back to Dashboard
              </>
            ) : (
              <>
                <ArrowLeft className="size-4 mr-2" />
                Back
              </>
            )}
          </Button>

          {/* Forward navigation for steps 0–2 */}
          {currentStep < 3 && (
            <Button
              className="w-full"
              onClick={goNext}
              disabled={
                (currentStep === 0 && !step0Valid) ||
                (currentStep === 1 && !step1Valid)
              }
            >
              {currentStep === 2 ? "Start Transfer" : "Next"}
              {currentStep !== 2 && <ArrowRight className="size-4 ml-2" />}
            </Button>
          )}

          {/* Step 3 completion actions */}
          {currentStep === 3 && phase === "completed" && (
            <Button
              className="w-full"
              onClick={() => {
                router.push("/transfer/new");
                window.location.reload();
              }}
            >
              <RotateCcw className="size-4 mr-2" />
              New Transfer
            </Button>
          )}
        </div>

        <Separator />

        {/* Vertical stepper */}
        <Stepper steps={wizardSteps} currentStep={currentStep} orientation="vertical" />
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-auto p-8">
        <Card>
          {/* ── Step 0: Environments ───────────────────────────────────── */}
          {currentStep === 0 && (
            <>
              <CardHeader>
                <CardTitle>Select Environments</CardTitle>
                <CardDescription>
                  Choose the source environment to transfer content from and the
                  destination environment to transfer content to.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <EnvironmentSelector
                  environments={environments}
                  sourceId={sourceId}
                  destinationId={destinationId}
                  onSourceChange={setSourceId}
                  onDestinationChange={setDestinationId}
                />
                {environments.length === 0 && (
                  <Alert variant="warning">
                    <AlertDescription>
                      No environments found in application context. Ensure this app
                      has been granted access to XM Cloud tenants in the Sitecore
                      Cloud Portal.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </>
          )}

          {/* ── Step 1: Items ──────────────────────────────────────────── */}
          {currentStep === 1 && (
            <>
              <CardContent>
                <InlineItemSelector
                  items={dataTrees}
                  onChange={setDataTrees}
                  sourceContextId={sourceId}
                  destinationContextId={destinationId}
                  sourceEnvName={sourceEnv ? getEnvironmentLabel(sourceEnv) : undefined}
                  destinationEnvName={destEnv ? getEnvironmentLabel(destEnv) : undefined}
                  label={label}
                  onLabelChange={setLabel}
                />
              </CardContent>
            </>
          )}

          {/* ── Step 2: Review ─────────────────────────────────────────── */}
          {currentStep === 2 && (
            <>
              <CardHeader>
                <CardTitle>Review Transfer</CardTitle>
                <CardDescription>
                  Confirm the details below before starting the transfer. This
                  operation will move content from the source environment to the
                  destination environment.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Environments summary */}
                <div className="rounded-lg border p-4 space-y-3">
                  <h4 className="text-sm font-medium">Environments</h4>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="flex-1 rounded-md bg-muted p-2.5 text-center">
                      <p className="font-medium">{sourceEnv ? getEnvironmentLabel(sourceEnv) : ""}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Source</p>
                    </div>
                    <ArrowRight className="size-5 text-muted-foreground shrink-0" />
                    <div className="flex-1 rounded-md bg-muted p-2.5 text-center">
                      <p className="font-medium">{destEnv ? getEnvironmentLabel(destEnv) : ""}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Destination</p>
                    </div>
                  </div>
                </div>

                {/* Label */}
                {label && (
                  <div className="rounded-lg border p-4">
                    <h4 className="text-sm font-medium mb-1">Label</h4>
                    <p className="text-sm text-muted-foreground">{label}</p>
                  </div>
                )}

                {/* Items */}
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">Content Items</h4>
                    <Badge colorScheme="neutral" size="sm">
                      {dataTrees.length} item{dataTrees.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {dataTrees.map((item, i) => {
                      const scopeLabel =
                        SCOPE_OPTIONS.find((s) => s.value === item.scope)?.label ??
                        item.scope;
                      const strategyLabel =
                        MERGE_STRATEGY_OPTIONS.find(
                          (s) => s.value === item.mergeStrategy
                        )?.label ?? item.mergeStrategy;
                      return (
                        <div
                          key={i}
                          className="flex flex-wrap items-center gap-2 text-sm"
                        >
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                            {item.itemPath}
                          </code>
                          <Badge colorScheme="primary" size="sm">
                            {scopeLabel}
                          </Badge>
                          <Badge colorScheme="neutral" size="sm">
                            {strategyLabel}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </>
          )}

          {/* ── Step 3: Progress ───────────────────────────────────────── */}
          {currentStep === 3 && (
            <>
              <CardHeader>
                <CardTitle>Transfer in Progress</CardTitle>
                <CardDescription>
                  The transfer is being orchestrated. Do not close this window
                  while the transfer is running.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TransferProgressDisplay
                  phase={phase}
                  progress={progress}
                  error={error}
                  chunkSetsMetadata={chunkSetsMetadata}
                  transferId={transferId}
                />
              </CardContent>
            </>
          )}
        </Card>
      </main>
    </div>
  );
}
