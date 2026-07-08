"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { DualTreeNode } from "@/hooks/use-dual-tree";
import { useDualTree } from "@/hooks/use-dual-tree";
import {
  findOverlaps,
  MERGE_STRATEGY_OPTIONS,
  SCOPE_OPTIONS,
  type DataTreeItem,
  type MergeStrategy,
  type TransferScope,
} from "@/lib/content-transfer";
import { AlertTriangle, Check, ChevronDown, CloudOff, Trash2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ItemFieldComparison } from "./item-field-comparison";
import { DualTreePane } from "./sitecore-item-tree";

const TREE_ROOT = "/sitecore";

const DEFAULT_SCOPE: TransferScope = "ItemAndDescendants";
const DEFAULT_STRATEGY: MergeStrategy = "OverrideExistingItem";

interface InlineItemSelectorProps {
  items: DataTreeItem[];
  onChange: (items: DataTreeItem[]) => void;
  sourceContextId: string | null;
  destinationContextId: string | null;
  sourceEnvName?: string;
  destinationEnvName?: string;
  label: string;
  onLabelChange: (label: string) => void;
}

export function InlineItemSelector({
  items,
  onChange,
  sourceContextId,
  destinationContextId,
  sourceEnvName,
  destinationEnvName,
  label,
  onLabelChange,
}: InlineItemSelectorProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [focusedNode, setFocusedNode] = useState<DualTreeNode | null>(null);
  const [isComparisonOpen, setIsComparisonOpen] = useState(false);
  const [addModalNode, setAddModalNode] = useState<DualTreeNode | null>(null);
  const [modalScope, setModalScope] = useState<TransferScope>(DEFAULT_SCOPE);
  const [modalStrategy, setModalStrategy] = useState<MergeStrategy>(DEFAULT_STRATEGY);

  const { getDualChildren, expandNode, isLoadingPath, getError } = useDualTree(
    sourceContextId,
    destinationContextId
  );

  function handleToggleExpand(path: string) {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function handleNodeSelect(node: DualTreeNode) {
    setFocusedNode(node);
    setIsComparisonOpen(false);
  }

  function handleRequestAdd(node: DualTreeNode) {
    setAddModalNode(node);
    setModalScope(DEFAULT_SCOPE);
    setModalStrategy(DEFAULT_STRATEGY);
  }

  function handleConfirmAdd() {
    if (!addModalNode) return;
    if (items.some((i) => i.itemPath === addModalNode.path)) {
      setAddModalNode(null);
      return;
    }
    onChange([
      ...items,
      { itemPath: addModalNode.path, scope: modalScope, mergeStrategy: modalStrategy },
    ]);
    setAddModalNode(null);
  }

  function updateItem(index: number, patch: Partial<DataTreeItem>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  const existingPaths = items.map((i) => i.itemPath).filter(Boolean);
  const overlaps = findOverlaps(items);

  return (
    <div className="space-y-0">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-1 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm bg-primary/20 border border-primary/40" />
          Focused (previewing)
        </span>
        <span className="flex items-center gap-1.5">
          <Check className="size-3.5 text-primary" />
          Added to transfer
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

      {/* Column headers */}
      <div className="grid grid-cols-2 divide-x border rounded-t-lg overflow-hidden">
        <div className="px-4 py-2.5 bg-muted/30">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Source
          </p>
          {sourceEnvName && (
            <p className="text-xs font-medium text-foreground mt-0.5 truncate">
              {sourceEnvName}
            </p>
          )}
        </div>
        <div className="px-4 py-2.5 bg-muted/30">
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

      {/* Dual-pane tree */}
      {sourceContextId ? (
        <ScrollArea className="h-[480px] border border-t-0 rounded-b-lg">
          <div className="grid grid-cols-2 divide-x">
            <div className="px-3 py-2 min-w-0">
              <DualTreePane
                side="source"
                rootPath={TREE_ROOT}
                getDualChildren={getDualChildren}
                expandNode={expandNode}
                isLoadingPath={isLoadingPath}
                getError={getError}
                selectedPath={focusedNode?.path ?? null}
                onSelect={handleNodeSelect}
                expandedPaths={expandedPaths}
                onToggleExpand={handleToggleExpand}
                existingPaths={existingPaths}
                onAdd={handleRequestAdd}
              />
            </div>
            <div className="px-3 py-2 min-w-0">
              {destinationContextId ? (
                <DualTreePane
                  side="destination"
                  rootPath={TREE_ROOT}
                  getDualChildren={getDualChildren}
                  expandNode={expandNode}
                  isLoadingPath={isLoadingPath}
                  getError={getError}
                  selectedPath={focusedNode?.path ?? null}
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
      ) : (
        <div className="border border-t-0 rounded-b-lg py-16 text-center text-sm text-muted-foreground">
          Select a source environment to browse the content tree.
        </div>
      )}

      {/* Collapsible field comparison — shown when a source node is focused */}
      {focusedNode && focusedNode.existsInSource && sourceContextId && (
          <div className="mt-3 space-y-2">
            {/* Collapsible field comparison */}
            <div className="border rounded-lg overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
                onClick={() => setIsComparisonOpen((o) => !o)}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
                    Field Comparison
                  </span>
                  {focusedNode.isDifferent && (
                    <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium shrink-0">
                      <AlertTriangle className="size-3" />
                      modified
                    </span>
                  )}
                  {!focusedNode.existsInDestination && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 italic">
                      <CloudOff className="size-3" />
                      new in destination
                    </span>
                  )}
                </div>
                <ChevronDown
                  className={cn(
                    "size-4 text-muted-foreground transition-transform shrink-0",
                    isComparisonOpen && "rotate-180"
                  )}
                />
              </button>

              {isComparisonOpen && (
                <ItemFieldComparison
                  path={focusedNode.path}
                  sourceContextId={sourceContextId}
                  destinationContextId={destinationContextId}
                  itemExistsInDestination={focusedNode.existsInDestination}
                />
              )}
            </div>
          </div>
      )}

      <Separator className="my-6" />

      {/* Selected items list */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Selected Items</h3>
          {items.length > 0 && (
            <Badge colorScheme="primary" size="sm">
              {items.length}
            </Badge>
          )}
        </div>

        {overlaps.size > 0 && (
          <Alert variant="warning">
            <AlertTriangle className="size-4" />
            <AlertDescription>
              {overlaps.size === 1 ? "1 selected item is" : `${overlaps.size} selected items are`} already covered by an ancestor with <strong>Item &amp; Descendants</strong> scope and will be transferred redundantly.
            </AlertDescription>
          </Alert>
        )}

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3 text-center border rounded-lg border-dashed">
            Click a source item in the tree above to add it to the transfer.
          </p>
        ) : (
          <>
            {/* Column headers */}
            <div className="hidden md:grid md:grid-cols-[1fr_170px_190px_36px] gap-3 px-1">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Item Path
              </Label>
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Scope
              </Label>
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Merge Strategy
              </Label>
              <span />
            </div>

            {items.map((item, index) => (
              <div
                key={index}
                className="flex flex-col md:grid md:grid-cols-[1fr_170px_190px_36px] gap-3 items-start md:items-center p-3 md:p-0 border md:border-0 rounded-lg md:rounded-none"
              >
                {/* Path (read-only display) */}
                <div className="w-full flex flex-col gap-1 min-w-0">
                  <code className="font-mono text-sm truncate bg-muted/50 px-2 py-1.5 rounded border text-muted-foreground">
                    {item.itemPath}
                  </code>
                  {overlaps.has(index) && (
                    <span className="flex items-center gap-1 text-xs text-warning-fg">
                      <AlertTriangle className="size-3 shrink-0" />
                      Covered by{" "}
                      <code className="font-mono">{items[overlaps.get(index)!].itemPath}</code>
                    </span>
                  )}
                </div>

                {/* Scope */}
                <div className="w-full md:w-auto space-y-1">
                  <Label className="text-xs text-muted-foreground md:hidden">Scope</Label>
                  <Select
                    value={item.scope}
                    onValueChange={(v) => updateItem(index, { scope: v as TransferScope })}
                  >
                    <SelectTrigger className="w-full">
                      <span className="truncate text-sm font-medium">
                        {SCOPE_OPTIONS.find((o) => o.value === item.scope)?.label ?? item.scope}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {SCOPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div className="py-0.5">
                            <div className="font-medium text-sm">{opt.label}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {opt.description}
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Merge strategy */}
                <div className="w-full md:w-auto space-y-1">
                  <Label className="text-xs text-muted-foreground md:hidden">Merge Strategy</Label>
                  <Select
                    value={item.mergeStrategy}
                    onValueChange={(v) => updateItem(index, { mergeStrategy: v as MergeStrategy })}
                  >
                    <SelectTrigger className="w-full">
                      <span className="truncate text-sm font-medium">
                        {MERGE_STRATEGY_OPTIONS.find((o) => o.value === item.mergeStrategy)?.label ?? item.mergeStrategy}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {MERGE_STRATEGY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div className="py-0.5">
                            <div className="font-medium text-sm">{opt.label}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {opt.description}
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Remove */}
                <div className="flex justify-end w-full md:w-auto">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeItem(index)}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                    aria-label="Remove item"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Transfer label */}
      <div className="space-y-2 pt-4">
        <Label htmlFor="transfer-label">Transfer Label (optional)</Label>
        <Input
          id="transfer-label"
          placeholder="e.g. Homepage content migration"
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          maxLength={100}
        />
        <p className="text-xs text-muted-foreground">
          A human-readable name to identify this transfer in the history.
        </p>
      </div>

      {/* Add to Transfer modal */}
      <Dialog open={!!addModalNode} onOpenChange={(open) => !open && setAddModalNode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to Transfer</DialogTitle>
            {addModalNode && (
              <code className="font-mono text-xs text-muted-foreground break-all">
                {addModalNode.path}
              </code>
            )}
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Scope
              </Label>
              <Select
                value={modalScope}
                onValueChange={(v) => setModalScope(v as TransferScope)}
              >
                <SelectTrigger className="w-full">
                  <span className="truncate text-sm font-medium">
                    {SCOPE_OPTIONS.find((o) => o.value === modalScope)?.label ?? modalScope}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {SCOPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="py-0.5">
                        <div className="font-medium text-sm">{opt.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Merge Strategy
              </Label>
              <Select
                value={modalStrategy}
                onValueChange={(v) => setModalStrategy(v as MergeStrategy)}
              >
                <SelectTrigger className="w-full">
                  <span className="truncate text-sm font-medium">
                    {MERGE_STRATEGY_OPTIONS.find((o) => o.value === modalStrategy)?.label ?? modalStrategy}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {MERGE_STRATEGY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="py-0.5">
                        <div className="font-medium text-sm">{opt.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {MERGE_STRATEGY_OPTIONS.find((o) => o.value === modalStrategy)?.description}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddModalNode(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmAdd}>
              <Check className="size-4 mr-1.5" />
              Add to Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
