"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MERGE_STRATEGY_OPTIONS,
  SCOPE_OPTIONS,
  type DataTreeItem,
  type MergeStrategy,
  type TransferScope,
} from "@/lib/content-transfer";
import { FolderSearch, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { SitecoreTreePicker } from "./sitecore-tree-picker";

interface ItemPathInputProps {
  items: DataTreeItem[];
  onChange: (items: DataTreeItem[]) => void;
  disabled?: boolean;
  /** Preview context ID of the selected source environment for the tree browser */
  sourceContextId?: string | null;
  /** Preview context ID of the selected destination environment for the comparison pane */
  destinationContextId?: string | null;
}

const DEFAULT_ITEM: DataTreeItem = {
  itemPath: "",
  scope: "ItemAndDescendants",
  mergeStrategy: "OverrideExistingItem",
};

export function ItemPathInput({
  items,
  onChange,
  disabled = false,
  sourceContextId = null,
  destinationContextId = null,
}: ItemPathInputProps) {
  // Track which row has the tree picker open (-1 = none)
  const [openPickerForIndex, setOpenPickerForIndex] = useState<number>(-1);

  function addRow() {
    onChange([...items, { ...DEFAULT_ITEM }]);
  }

  function removeRow(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  function updateRow(index: number, patch: Partial<DataTreeItem>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function handleTreeSelect(index: number, path: string) {
    updateRow(index, { itemPath: path });
    setOpenPickerForIndex(-1);
  }

  // All currently configured paths (for "Added" indicators in the tree)
  const existingPaths = items.map((i) => i.itemPath).filter(Boolean);

  return (
    <div className="space-y-3">
      {/* Header row labels (hidden on mobile) */}
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
          {/* Item path — text input + browse button */}
          <div className="w-full space-y-1">
            <Label className="text-xs text-muted-foreground md:hidden">
              Item Path
            </Label>
            <div className="flex gap-2">
              <Input
                value={item.itemPath}
                onChange={(e) => updateRow(index, { itemPath: e.target.value })}
                placeholder="/sitecore/content/Home"
                disabled={disabled}
                className="font-mono text-sm flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setOpenPickerForIndex(index)}
                disabled={disabled || !sourceContextId}
                title={
                  sourceContextId
                    ? "Browse content tree"
                    : "Select a source environment first"
                }
                className="shrink-0"
              >
                <FolderSearch className="size-4" />
              </Button>
            </div>
          </div>

          {/* Scope */}
          <div className="w-full md:w-auto space-y-1">
            <Label className="text-xs text-muted-foreground md:hidden">
              Scope
            </Label>
            <Select
              value={item.scope}
              onValueChange={(v) => updateRow(index, { scope: v as TransferScope })}
              disabled={disabled}
            >
              <SelectTrigger className="w-full">
                {/* Show only the short label in the trigger; description stays in the dropdown */}
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
            <Label className="text-xs text-muted-foreground md:hidden">
              Merge Strategy
            </Label>
            <Select
              value={item.mergeStrategy}
              onValueChange={(v) =>
                updateRow(index, { mergeStrategy: v as MergeStrategy })
              }
              disabled={disabled}
            >
              <SelectTrigger className="w-full">
                {/* Show only the short label in the trigger; description stays in the dropdown */}
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
              onClick={() => removeRow(index)}
              disabled={disabled || items.length <= 1}
              className="text-muted-foreground hover:text-destructive shrink-0"
              aria-label="Remove item"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>

          {/* Tree picker dialog — one per row, opened on demand */}
          <SitecoreTreePicker
            open={openPickerForIndex === index}
            onOpenChange={(open) => {
              if (!open) setOpenPickerForIndex(-1);
            }}
            sourceContextId={sourceContextId}
            destinationContextId={destinationContextId}
            existingPaths={existingPaths}
            onSelect={(path) => handleTreeSelect(index, path)}
          />
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addRow}
        disabled={disabled}
        className="w-full"
      >
        <Plus className="size-4 mr-2" />
        Add Item Path
      </Button>

      {!sourceContextId && (
        <p className="text-xs text-muted-foreground text-center">
          Select a source environment in Step 1 to enable the tree browser.
        </p>
      )}
    </div>
  );
}
