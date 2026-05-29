"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { DualTreeNode } from "@/hooks/use-dual-tree";
import { useDualTree } from "@/hooks/use-dual-tree";
import { Check, CloudOff } from "lucide-react";
import { useState } from "react";
import { ItemFieldComparison } from "./item-field-comparison";
import { DualTreePane } from "./sitecore-item-tree";

// ── Root path shown in the tree ────────────────────────────────────────────
const TREE_ROOT = "/sitecore";

interface SitecoreTreePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceContextId: string | null;
  destinationContextId: string | null;
  /** Human-readable names shown in the column headers */
  sourceEnvName?: string;
  destinationEnvName?: string;
  /** Paths already added to the transfer list */
  existingPaths?: string[];
  onSelect: (path: string) => void;
}

export function SitecoreTreePicker({
  open,
  onOpenChange,
  sourceContextId,
  destinationContextId,
  sourceEnvName,
  destinationEnvName,
  onSelect,
}: SitecoreTreePickerProps) {
  const [pendingNode, setPendingNode] = useState<DualTreeNode | null>(null);
  // Shared expansion state — both panes stay in sync
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const { getDualChildren, expandNode, isLoadingPath, getError } = useDualTree(
    sourceContextId,
    destinationContextId
  );

  function handleToggleExpand(path: string) {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function handleNodeSelect(node: DualTreeNode) {
    // Only source-real nodes are selectable
    if (node.existsInSource) setPendingNode(node);
  }

  function handleConfirm() {
    if (!pendingNode) return;
    onSelect(pendingNode.path);
    onOpenChange(false);
    setPendingNode(null);
  }

  function handleCancel() {
    onOpenChange(false);
    setPendingNode(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wide dialog to fit two tree panes and the field comparison panel */}
      <DialogContent className="max-w-[92vw] w-[1300px] p-0 gap-0 flex flex-col max-h-[92vh]" size="lg">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
          <DialogTitle>Select Sitecore Item</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Browse the source content tree and select the root item to
            transfer. The destination pane shows what already exists — grey
            ghost items do not yet exist on that side.
          </p>
        </DialogHeader>

        <Separator />

        {/* Legend row */}
        <div className="flex items-center gap-6 px-6 py-2.5 bg-muted/30 text-xs text-muted-foreground shrink-0">
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm bg-primary/20 border border-primary/40" />
            Selected
          </span>
          <span className="flex items-center gap-1.5">
            <CloudOff className="size-3.5 opacity-50" />
            <span className="italic opacity-60">Not in this environment</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2 rounded-full bg-amber-400 dark:bg-amber-500" />
            Modified (revision differs)
          </span>
        </div>

        <Separator />

        {/* Dual-pane tree area — single shared scroll so both sides move together */}
        {sourceContextId ? (
          <>
            {/* Column headers — fixed above the scroll area */}
            <div className="grid grid-cols-2 divide-x border-b shrink-0">
              <div className="px-4 py-2 bg-muted/20">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Source
                </p>
                {sourceEnvName && (
                  <p className="text-xs font-medium text-foreground mt-0.5 truncate">
                    {sourceEnvName}
                  </p>
                )}
              </div>
              <div className="px-4 py-2 bg-muted/20">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Destination
                </p>
                {destinationEnvName && (
                  <p className="text-xs font-medium text-foreground mt-0.5 truncate">
                    {destinationEnvName}
                  </p>
                )}
              </div>
            </div>

            {/* One scroll area wrapping both columns */}
            <ScrollArea className="h-[380px] shrink-0">
              <div className="grid grid-cols-2 divide-x">
                {/* Source pane */}
                <div className="px-3 py-2 min-w-0">
                  <DualTreePane
                    side="source"
                    rootPath={TREE_ROOT}
                    getDualChildren={getDualChildren}
                    expandNode={expandNode}
                    isLoadingPath={isLoadingPath}
                    getError={getError}
                    selectedPath={pendingNode?.path ?? null}
                    onSelect={handleNodeSelect}
                    expandedPaths={expandedPaths}
                    onToggleExpand={handleToggleExpand}
                  />
                </div>

                {/* Destination pane */}
                <div className="px-3 py-2 min-w-0">
                  {destinationContextId ? (
                    <DualTreePane
                      side="destination"
                      rootPath={TREE_ROOT}
                      getDualChildren={getDualChildren}
                      expandNode={expandNode}
                      isLoadingPath={isLoadingPath}
                      getError={getError}
                      selectedPath={pendingNode?.path ?? null}
                      onSelect={handleNodeSelect}
                      expandedPaths={expandedPaths}
                      onToggleExpand={handleToggleExpand}
                    />
                  ) : (
                    <div className="py-12 text-center text-sm text-muted-foreground">
                      Select a destination environment to see the comparison.
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          </>
        ) : (
          <div className="py-16 text-center text-sm text-muted-foreground shrink-0">
            Select a source environment first to browse the content tree.
          </div>
        )}

        {/* Field comparison panel — shown when an item is selected, scrollable */}
        {pendingNode && sourceContextId && (
          <>
            <Separator />
            <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
              <ItemFieldComparison
                path={pendingNode.path}
                sourceContextId={sourceContextId}
                destinationContextId={destinationContextId}
                itemExistsInDestination={pendingNode.existsInDestination}
              />
            </div>
          </>
        )}

        <Separator />

        {/* Footer */}
        <DialogFooter className="px-6 py-4 shrink-0 flex-row items-center justify-between">
          {/* Selected path preview */}
          <div className="flex-1 min-w-0 mr-4">
            {pendingNode ? (
              <div className="flex items-center gap-2">
                <Check className="size-4 text-success-fg shrink-0" />
                <code className="text-xs font-mono text-muted-foreground truncate">
                  {pendingNode.path}
                </code>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Click a source item to select it
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={!pendingNode}>
              Select Item
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
