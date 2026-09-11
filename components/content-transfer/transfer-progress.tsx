"use client";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ChunkSetMetadata, TransferPhase } from "@/lib/content-transfer";
import {
  TRANSFER_PHASE_LABELS,
  getPhaseColorScheme,
  isActivePhase,
} from "@/lib/content-transfer";
import { CheckCircle2, XCircle } from "lucide-react";

export interface ProgressStep {
  key: TransferPhase;
  label: string;
}

/** The phases a source → destination transfer moves through, in order. */
const TRANSFER_STEPS: ProgressStep[] = [
  { key: "creating", label: "Create" },
  { key: "preparing", label: "Package" },
  { key: "transferring", label: "Transfer" },
  { key: "importing", label: "Import" },
];

interface TransferProgressProps {
  phase: TransferPhase;
  progress: number;
  error: string | null;
  chunkSetsMetadata: ChunkSetMetadata[];
  transferId: string | null;
  /** Overrides the step breakdown so backup and restore can show their own
   *  phases. Defaults to the transfer sequence. */
  steps?: ProgressStep[];
  /** Extra detail rendered under the status header, e.g. the current chunk. */
  detail?: string | null;
}

export function TransferProgressDisplay({
  phase,
  progress,
  error,
  chunkSetsMetadata,
  transferId,
  steps = TRANSFER_STEPS,
  detail,
}: TransferProgressProps) {
  const isActive = isActivePhase(phase);

  return (
    <div className="space-y-6">
      {/* Status header */}
      <div className="flex items-center gap-3">
        {isActive && <Spinner className="size-5 text-primary" />}
        {phase === "completed" && (
          <CheckCircle2 className="size-5 text-success-fg" />
        )}
        {phase === "failed" && (
          <XCircle className="size-5 text-danger-fg" />
        )}
        <div className="space-y-1 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{TRANSFER_PHASE_LABELS[phase]}</span>
            <Badge colorScheme={getPhaseColorScheme(phase)} size="sm">
              {phase}
            </Badge>
          </div>
          {detail && (
            <p className="text-xs text-muted-foreground">{detail}</p>
          )}
          {transferId && (
            <p className="text-xs text-muted-foreground font-mono">
              ID: {transferId}
            </p>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {phase !== "idle" && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {/* Phase steps breakdown */}
      <div
        className="grid grid-cols-2 gap-3"
        style={{
          gridTemplateColumns: `repeat(${Math.min(steps.length, 4)}, minmax(0, 1fr))`,
        }}
      >
        {steps.map((step) => {
          // Terminal phases sit past every step, so a completed or failed run
          // resolves each box against the sequence it actually ran.
          const phases: TransferPhase[] = [
            ...steps.map((s) => s.key),
            "completed",
            "failed",
          ];
          const stepIndex = phases.indexOf(step.key);
          const currentIndex = phases.indexOf(phase);

          let stepStatus: "completed" | "active" | "pending" = "pending";
          if (phase === "failed" && currentIndex > stepIndex) {
            stepStatus = "completed";
          } else if (phase === "completed") {
            stepStatus = "completed";
          } else if (currentIndex > stepIndex) {
            stepStatus = "completed";
          } else if (currentIndex === stepIndex) {
            stepStatus = "active";
          }

          return (
            <div
              key={step.key}
              className={`rounded-md border p-2.5 text-center text-xs ${
                stepStatus === "completed"
                  ? "border-primary/30 bg-primary/5 text-primary"
                  : stepStatus === "active"
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-border text-muted-foreground"
              }`}
            >
              {step.label}
            </div>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md border border-danger-fg/30 bg-danger-bg p-3">
          <p className="text-sm text-danger-fg font-medium">Error</p>
          <p className="text-sm text-danger-fg mt-1">{error}</p>
        </div>
      )}

      {/* Chunk sets metadata */}
      {chunkSetsMetadata.length > 0 && (
        <>
          <Separator />
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Chunk Sets</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Chunk Set ID</TableHead>
                  <TableHead className="text-right">Chunks</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chunkSetsMetadata.map((cs) => (
                  <TableRow key={cs.ChunkSetId}>
                    <TableCell className="font-mono text-xs">
                      {cs.ChunkSetId.length > 20
                        ? `${cs.ChunkSetId.slice(0, 8)}...${cs.ChunkSetId.slice(-4)}`
                        : cs.ChunkSetId}
                    </TableCell>
                    <TableCell className="text-right">{cs.ChunkCount}</TableCell>
                    <TableCell className="text-right">
                      {cs.TotalItemCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
