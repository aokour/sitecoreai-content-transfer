"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { useRestorePreview } from "@/hooks/use-restore-preview";
import type { PathPreview } from "@/hooks/use-restore-preview";
import type { BackupManifest } from "@/lib/backup-archive";
import { manifestDataTrees } from "@/lib/backup-archive";
import type { DataTreeItem, MergeStrategy } from "@/lib/content-transfer";
import {
  MERGE_STRATEGY_OPTIONS,
  SCOPE_OPTIONS,
} from "@/lib/content-transfer";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";

/** What each merge strategy does to items already in the destination. */
const OUTCOME_COPY: Record<
  MergeStrategy,
  { tone: "default" | "warning" | "danger"; text: string }
> = {
  OverrideExistingItem: {
    tone: "default",
    text: "Items in the archive overwrite their counterparts in the destination. Destination items that are not in the archive are left alone.",
  },
  KeepExistingItem: {
    tone: "default",
    text: "Items that already exist in the destination are left untouched. Only items missing from the destination are created.",
  },
  LatestWin: {
    tone: "default",
    text: "For each item, whichever copy was modified most recently wins. Because the archive's contents cannot be read, which side wins per item cannot be predicted here.",
  },
  OverrideExistingTree: {
    tone: "danger",
    text: "The destination subtree is replaced wholesale. Items that exist in the destination but not in the archive WILL BE DELETED. The archive's contents cannot be read, so those deletions cannot be listed below.",
  },
};

function strategyLabel(s: MergeStrategy) {
  return MERGE_STRATEGY_OPTIONS.find((o) => o.value === s)?.label ?? s;
}

function scopeLabel(s: DataTreeItem["scope"]) {
  return SCOPE_OPTIONS.find((o) => o.value === s)?.label ?? s;
}

function formatDate(value?: string) {
  if (!value) return null;
  // Sitecore returns ISO-8601 basic format, e.g. 20260907T131500Z
  const iso = /^\d{8}T\d{6}/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`
    : value;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function DestinationState({ preview }: { preview: PathPreview }) {
  const [expanded, setExpanded] = useState(false);

  if (preview.status === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Checking the destination…
      </div>
    );
  }

  if (preview.status === "error") {
    return (
      <Alert variant="warning">
        <AlertDescription className="text-xs">
          Could not read this path in the destination: {preview.error}. The
          restore can still run, but its effect here is unknown.
        </AlertDescription>
      </Alert>
    );
  }

  if (preview.status === "missing") {
    return (
      <div className="flex items-start gap-2 text-sm">
        <FilePlus2 className="size-4 text-success-fg mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">Not in the destination</p>
          <p className="text-xs text-muted-foreground">
            This path will be created.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 text-sm">
        <RefreshCw className="size-4 text-primary mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium">Already in the destination</p>
          <div className="text-xs text-muted-foreground space-y-0.5 mt-0.5">
            {preview.templateName && <p>Template: {preview.templateName}</p>}
            {preview.updated && <p>Updated: {formatDate(preview.updated)}</p>}
            {preview.updatedBy && <p>By: {preview.updatedBy}</p>}
          </div>
        </div>
      </div>

      {preview.children.length > 0 && (
        <div className="pl-6">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 -ml-2 text-xs"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <ChevronDown className="size-3.5 mr-1" />
            ) : (
              <ChevronRight className="size-3.5 mr-1" />
            )}
            {preview.children.length}
            {preview.childrenTruncated ? "+" : ""} direct child
            {preview.children.length === 1 ? "" : "ren"} currently here
          </Button>
          {expanded && (
            <div className="mt-1 rounded-md border divide-y max-h-64 overflow-y-auto">
              {preview.children.map((c) => (
                <div
                  key={c.itemId}
                  className="px-2.5 py-1.5 flex items-center justify-between gap-2 text-xs"
                >
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="text-muted-foreground shrink-0">
                    {c.templateName}
                  </span>
                </div>
              ))}
              {preview.childrenTruncated && (
                <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
                  Only the first {preview.children.length} children are shown.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface RestorePreviewProps {
  manifest: BackupManifest;
  destinationContextId: string | null;
  destinationName: string;
  /** Acknowledgement of destructive merge strategies. */
  acknowledged: boolean;
  onAcknowledgedChange: (value: boolean) => void;
}

export function RestorePreview({
  manifest,
  destinationContextId,
  destinationName,
  acknowledged,
  onAcknowledgedChange,
}: RestorePreviewProps) {
  const dataTrees = manifestDataTrees(manifest);
  const { previews, isLoading, refetch } = useRestorePreview(
    dataTrees,
    destinationContextId,
  );

  const hasDestructive = dataTrees.some(
    (dt) => dt.mergeStrategy === "OverrideExistingTree",
  );

  return (
    <div className="space-y-5">
      <Alert>
        <AlertDescription className="text-xs">
          This is an impact report, not a selection. A package is imported whole,
          so everything below is applied together. The archive itself is
          encrypted and cannot be listed — each path shows what the manifest
          declares next to what is in{" "}
          <span className="font-medium">{destinationName}</span> right now.
        </AlertDescription>
      </Alert>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Reading the destination…
        </div>
      )}

      <div className="space-y-4">
        {dataTrees.map((tree, i) => {
          const preview = previews[tree.itemPath];
          const outcome = OUTCOME_COPY[tree.mergeStrategy];
          return (
            <div key={`${tree.itemPath}-${i}`} className="rounded-lg border">
              <div className="p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono break-all">
                    {tree.itemPath}
                  </code>
                  <Badge colorScheme="primary" size="sm">
                    {scopeLabel(tree.scope)}
                  </Badge>
                  <Badge
                    colorScheme={
                      tree.mergeStrategy === "OverrideExistingTree"
                        ? "danger"
                        : "neutral"
                    }
                    size="sm"
                  >
                    {strategyLabel(tree.mergeStrategy)}
                  </Badge>
                </div>

                <Separator />

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      In this archive
                    </p>
                    <p className="text-sm">
                      {scopeLabel(tree.scope) === "Single Item"
                        ? "This item only"
                        : "This item and all descendants"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Captured{" "}
                      {manifest.createdAt
                        ? new Date(manifest.createdAt).toLocaleString()
                        : "at an unknown time"}
                      {manifest.createdBy?.name
                        ? ` by ${manifest.createdBy.name}`
                        : ""}
                      .
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      In the destination now
                    </p>
                    {preview ? (
                      <DestinationState preview={preview} />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Select a destination to compare.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div
                className={`px-4 py-3 border-t text-xs rounded-b-lg ${
                  outcome.tone === "danger"
                    ? "bg-danger-bg text-danger-fg"
                    : "bg-muted/40 text-muted-foreground"
                }`}
              >
                <div className="flex items-start gap-2">
                  {outcome.tone === "danger" && (
                    <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                  )}
                  <span>{outcome.text}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!isLoading && destinationContextId && (
        <Button variant="outline" size="sm" onClick={refetch}>
          <RefreshCw className="size-3.5 mr-2" />
          Re-check destination
        </Button>
      )}

      {hasDestructive && (
        <Alert variant="danger">
          <AlertDescription className="space-y-3">
            <p>
              This archive contains at least one path set to{" "}
              <span className="font-medium">Override Tree</span>. Restoring it
              deletes items in {destinationName} that are not in the archive,
              and this preview cannot tell you which ones.
            </p>
            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(v) => onAcknowledgedChange(v === true)}
                className="mt-0.5"
              />
              <span className="text-sm">
                I understand that items in the destination which are not in this
                archive may be permanently deleted.
              </span>
            </label>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
