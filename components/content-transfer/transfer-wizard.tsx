"use client";

import { useAppContext } from "@/components/providers/marketplace";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Stepper } from "@/components/ui/stepper";
import { EnvironmentSelector } from "./environment-selector";
import { ItemPathInput } from "./item-path-input";
import { TransferProgressDisplay } from "./transfer-progress";
import { useContentTransfer } from "@/hooks/use-content-transfer";
import { useTransferHistory } from "@/hooks/use-transfer-history";
import type {
  DataTreeItem,
  ResourceAccessEntry,
  TransferRecord,
} from "@/lib/content-transfer";
import {
  generateTransferId,
  getEnvironmentLabel,
  MERGE_STRATEGY_OPTIONS,
  SCOPE_OPTIONS,
} from "@/lib/content-transfer";
import { ArrowLeft, ArrowRight, CheckCircle2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

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
  const appContext = useAppContext();
  const { addTransfer, updateTransferPhase } = useTransferHistory();
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
  const [dataTrees, setDataTrees] = useState<DataTreeItem[]>([
    {
      itemPath: "",
      scope: "ItemAndDescendants",
      mergeStrategy: "OverrideExistingItem",
    },
  ]);

  // ── Derived environment info ──────────────────────────────────────────────
  const environments = useMemo((): ResourceAccessEntry[] => {
    // The SDK returns data in `resourceAccess` (preferred) or `resources` (legacy).
    // In real responses tenantName may be null — use tenantDisplayName instead.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any[] = appContext?.resourceAccess?.length
      ? appContext.resourceAccess
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : (appContext as any)?.resources ?? [];
    return raw as ResourceAccessEntry[];
  }, [appContext]);

  const sourceEnv = environments.find((e) => e.context.preview === sourceId);
  const destEnv = environments.find((e) => e.context.preview === destinationId);

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
      const record: TransferRecord = {
        transferId: tid,
        label: label.trim() || "Content Transfer",
        sourceContextId: sourceId,
        destinationContextId: destinationId,
        sourceTenantName: getEnvironmentLabel(sourceEnv),
        destinationTenantName: getEnvironmentLabel(destEnv),
        createdAt: new Date().toISOString(),
        itemPaths: dataTrees.map((d) => d.itemPath),
        phase: "creating",
      };
      addTransfer(record);
      startTransfer({
        transferId: tid,
        label: record.label,
        sourceContextId: sourceId,
        destinationContextId: destinationId,
        sourceTenantName: getEnvironmentLabel(sourceEnv),
        destinationTenantName: getEnvironmentLabel(destEnv),
        dataTrees,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  // Sync phase changes back to localStorage
  useEffect(() => {
    if (transferId && phase !== "idle") {
      updateTransferPhase(transferId, phase);
    }
  }, [transferId, phase, updateTransferPhase]);

  // ── Navigation ────────────────────────────────────────────────────────────
  function goNext() {
    setCurrentStep((s) => Math.min(s + 1, 3));
  }
  function goBack() {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Stepper */}
      <Stepper steps={STEPS} currentStep={currentStep} />

      {/* Step content */}
      <Card>
        {/* ── Step 0: Environments ─────────────────────────────────────── */}
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

        {/* ── Step 1: Items ────────────────────────────────────────────── */}
        {currentStep === 1 && (
          <>
            <CardHeader>
              <CardTitle>Configure Content Items</CardTitle>
              <CardDescription>
                Add the Sitecore item paths you want to transfer. For each
                item, choose how far down the tree to include and how to handle
                existing content.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Transfer label */}
              <div className="space-y-2">
                <Label htmlFor="transfer-label">Transfer Label (optional)</Label>
                <Input
                  id="transfer-label"
                  placeholder="e.g. Homepage content migration"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={100}
                />
                <p className="text-xs text-muted-foreground">
                  A human-readable name to identify this transfer in the history.
                </p>
              </div>

              <Separator />

              {/* Item paths */}
              <ItemPathInput
                items={dataTrees}
                onChange={setDataTrees}
                sourceContextId={sourceId}
                destinationContextId={destinationId}
              />
            </CardContent>
          </>
        )}

        {/* ── Step 2: Review ───────────────────────────────────────────── */}
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
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Destination
                    </p>
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

              <Alert variant="warning">
                <AlertDescription>
                  <strong>Note:</strong> Items with &quot;Override Existing&quot;
                  strategy will overwrite content in the destination environment.
                  This action cannot be undone.
                </AlertDescription>
              </Alert>
            </CardContent>
          </>
        )}

        {/* ── Step 3: Progress ─────────────────────────────────────────── */}
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

      {/* Navigation footer */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={currentStep === 3 ? () => router.push("/") : goBack}
          disabled={currentStep === 3 && isRunning}
        >
          {currentStep === 3 ? (
            <>
              <ArrowLeft className="size-4 mr-2" />
              Back to Dashboard
            </>
          ) : currentStep === 0 ? (
            <>
              <ArrowLeft className="size-4 mr-2" />
              Cancel
            </>
          ) : (
            <>
              <ArrowLeft className="size-4 mr-2" />
              Back
            </>
          )}
        </Button>

        <div className="flex items-center gap-3">
          {/* Step 3 completion actions */}
          {currentStep === 3 && phase === "completed" && (
            <>
              <Button
                variant="outline"
                onClick={() => router.push(`/transfer/${transferId}`)}
              >
                <CheckCircle2 className="size-4 mr-2" />
                View Details
              </Button>
              <Button
                onClick={() => {
                  router.push("/transfer/new");
                  window.location.reload();
                }}
              >
                <RotateCcw className="size-4 mr-2" />
                New Transfer
              </Button>
            </>
          )}

          {/* Forward navigation for steps 0–2 */}
          {currentStep < 3 && (
            <Button
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
        </div>
      </div>
    </div>
  );
}
