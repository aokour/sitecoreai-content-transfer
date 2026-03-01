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
} from "@/lib/content-transfer";
import { CheckCircle2, XCircle } from "lucide-react";

interface TransferProgressProps {
  phase: TransferPhase;
  progress: number;
  error: string | null;
  chunkSetsMetadata: ChunkSetMetadata[];
  transferId: string | null;
}

export function TransferProgressDisplay({
  phase,
  progress,
  error,
  chunkSetsMetadata,
  transferId,
}: TransferProgressProps) {
  const isActive =
    phase === "creating" ||
    phase === "preparing" ||
    phase === "transferring" ||
    phase === "importing";

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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(
          [
            { key: "creating", label: "Create" },
            { key: "preparing", label: "Package" },
            { key: "transferring", label: "Transfer" },
            { key: "importing", label: "Import" },
          ] as { key: TransferPhase; label: string }[]
        ).map((step) => {
          const phases: TransferPhase[] = [
            "creating",
            "preparing",
            "transferring",
            "importing",
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
