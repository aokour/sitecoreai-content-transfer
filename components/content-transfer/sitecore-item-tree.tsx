"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { SitecoreTreeNode } from "@/hooks/use-sitecore-tree";
import type { DualTreeNode } from "@/hooks/use-dual-tree";
import { transformIconUrl } from "@/hooks/use-dual-tree";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronRight,
  CloudOff,
  File,
  Folder,
  FolderOpen,
} from "lucide-react";
import { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

interface SitecoreItemTreeProps {
  /** Path to render children of (root of the visible tree) */
  rootPath: string;
  getChildren: (path: string) => SitecoreTreeNode[] | undefined;
  expandNode: (path: string) => void;
  isLoadingPath: (path: string) => boolean;
  getError: (path: string) => string | null;
  selectedPath: string | null;
  onSelect: (node: SitecoreTreeNode) => void;
  /** Paths already added to the transfer list — show a checkmark */
  existingPaths?: string[];
  /** Filter string — hides nodes whose names don't match */
  filter?: string;
}

// ── Single tree row ────────────────────────────────────────────────────────

interface TreeRowProps {
  node: SitecoreTreeNode;
  depth: number;
  getChildren: (path: string) => SitecoreTreeNode[] | undefined;
  expandNode: (path: string) => void;
  isLoadingPath: (path: string) => boolean;
  getError: (path: string) => string | null;
  selectedPath: string | null;
  onSelect: (node: SitecoreTreeNode) => void;
  existingPaths: string[];
  filter: string;
}

function TreeRow({
  node,
  depth,
  getChildren,
  expandNode,
  isLoadingPath,
  getError,
  selectedPath,
  onSelect,
  existingPaths,
  filter,
}: TreeRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const children = getChildren(node.path);
  const isLoading = isLoadingPath(node.path);
  const nodeError = getError(node.path);
  const isSelected = selectedPath === node.path;
  const isAlreadyAdded = existingPaths.includes(node.path);

  // When filter changes, auto-expand if node name matches to reveal context
  const nameMatchesFilter =
    filter.length > 0 &&
    node.name.toLowerCase().includes(filter.toLowerCase());

  function handleToggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (!node.hasChildren) return;
    const next = !isExpanded;
    setIsExpanded(next);
    if (next && children === undefined) {
      expandNode(node.path);
    }
  }

  function handleSelect() {
    onSelect(node);
  }

  // Hide nodes that don't match an active filter
  const hidden =
    filter.length > 0 && !node.name.toLowerCase().includes(filter.toLowerCase());

  if (hidden) return null;

  // Template label — skip generic/noisy ones
  const templateLabel =
    node.template?.name &&
    node.template.name !== "Node" &&
    node.template.name !== "Folder"
      ? node.template.name
      : null;

  return (
    <>
      {/* Row */}
      <div
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={node.hasChildren ? isExpanded : undefined}
        onClick={handleSelect}
        className={cn(
          "group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer select-none text-sm transition-colors",
          isSelected
            ? "bg-primary/10 text-primary"
            : "hover:bg-muted/60 text-foreground",
          nameMatchesFilter && !isSelected && "bg-yellow-50 dark:bg-yellow-900/20"
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {/* Expand chevron / loading */}
        <span
          onClick={handleToggle}
          className={cn(
            "shrink-0 size-4 flex items-center justify-center rounded transition-colors",
            node.hasChildren
              ? "hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
              : "cursor-default opacity-0 pointer-events-none"
          )}
        >
          {isLoading ? (
            <Spinner className="size-3" />
          ) : (
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform",
                isExpanded && "rotate-90"
              )}
            />
          )}
        </span>

        {/* Icon */}
        <span className="shrink-0 text-muted-foreground">
          {node.hasChildren ? (
            isExpanded ? (
              <FolderOpen className="size-4" />
            ) : (
              <Folder className="size-4" />
            )
          ) : (
            <File className="size-4" />
          )}
        </span>

        {/* Name */}
        <span className="flex-1 truncate font-medium">{node.name}</span>

        {/* Template badge */}
        {templateLabel && (
          <Badge colorScheme="neutral" size="sm" className="shrink-0 hidden group-hover:inline-flex">
            {templateLabel}
          </Badge>
        )}

        {/* Already-added indicator */}
        {isAlreadyAdded && (
          <span className="shrink-0 text-xs text-success-fg font-medium">
            Added
          </span>
        )}
      </div>

      {/* Error */}
      {nodeError && isExpanded && (
        <div
          className="text-xs text-danger-fg px-2 py-1"
          style={{ paddingLeft: `${8 + (depth + 1) * 16}px` }}
        >
          {nodeError}
        </div>
      )}

      {/* Children */}
      {isExpanded && children && children.length > 0 && (
        <>
          {children.map((child) => (
            <TreeRow
              key={child.itemId}
              node={child}
              depth={depth + 1}
              getChildren={getChildren}
              expandNode={expandNode}
              isLoadingPath={isLoadingPath}
              getError={getError}
              selectedPath={selectedPath}
              onSelect={onSelect}
              existingPaths={existingPaths}
              filter={filter}
            />
          ))}
        </>
      )}

      {/* Empty children */}
      {isExpanded && children && children.length === 0 && (
        <div
          className="text-xs text-muted-foreground px-2 py-1 italic"
          style={{ paddingLeft: `${8 + (depth + 1) * 16}px` }}
        >
          No children
        </div>
      )}
    </>
  );
}

// ── Tree root ──────────────────────────────────────────────────────────────

export function SitecoreItemTree({
  rootPath,
  getChildren,
  expandNode,
  isLoadingPath,
  getError,
  selectedPath,
  onSelect,
  existingPaths = [],
  filter = "",
}: SitecoreItemTreeProps) {
  // Trigger initial load for the root path
  useEffect(() => {
    expandNode(rootPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath]);

  const rootChildren = getChildren(rootPath);
  const isLoading = isLoadingPath(rootPath);
  const rootError = getError(rootPath);

  if (isLoading && !rootChildren) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
        <Spinner className="size-4" />
        <span>Loading Sitecore tree...</span>
      </div>
    );
  }

  if (rootError && !rootChildren) {
    return (
      <div className="py-8 text-center text-sm text-danger-fg">
        <p className="font-medium">Failed to load tree</p>
        <p className="text-xs mt-1">{rootError}</p>
      </div>
    );
  }

  if (!rootChildren || rootChildren.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No items found
      </div>
    );
  }

  return (
    <div role="tree" className="space-y-0.5">
      {rootChildren.map((node) => (
        <TreeRow
          key={node.itemId}
          node={node}
          depth={0}
          getChildren={getChildren}
          expandNode={expandNode}
          isLoadingPath={isLoadingPath}
          getError={getError}
          selectedPath={selectedPath}
          onSelect={onSelect}
          existingPaths={existingPaths}
          filter={filter}
        />
      ))}
    </div>
  );
}

// ── Dual-pane tree ─────────────────────────────────────────────────────────
// Used by the dual-pane tree picker to render source and destination sides
// with ghost nodes and modification indicators.

interface DualTreeRowProps {
  node: DualTreeNode;
  side: "source" | "destination";
  depth: number;
  getDualChildren: (path: string) => DualTreeNode[] | undefined;
  expandNode: (path: string) => void;
  isLoadingPath: (path: string) => boolean;
  getError: (path: string) => string | null;
  selectedPath: string | null;
  onSelect: (node: DualTreeNode) => void;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  existingPaths?: string[];
  onAdd?: (node: DualTreeNode) => void;
}

function DualTreeRow({
  node,
  side,
  depth,
  getDualChildren,
  expandNode,
  isLoadingPath,
  getError,
  selectedPath,
  onSelect,
  expandedPaths,
  onToggleExpand,
  existingPaths = [],
  onAdd,
}: DualTreeRowProps) {
  const isExpanded = expandedPaths.has(node.path);
  const [iconError, setIconError] = useState(false);
  const children = getDualChildren(node.path);
  const isLoading = isLoadingPath(node.path);
  const nodeError = getError(node.path);
  const isSelected = selectedPath === node.path;
  const isAlreadyAdded = side === "source" && existingPaths.includes(node.path);

  // Ghost: item doesn't exist on this side
  const isGhost =
    side === "source" ? !node.existsInSource : !node.existsInDestination;

  // Not selectable if it's a ghost on the source side (can't transfer what doesn't exist in source)
  const isSelectable = side === "source" ? node.existsInSource : false;

  function handleToggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (!node.hasChildren) return;
    const next = !isExpanded;
    onToggleExpand(node.path);
    if (next && children === undefined) {
      expandNode(node.path);
    }
  }

  function handleSelect() {
    if (isSelectable) onSelect(node);
  }

  function handleAdd(e: React.MouseEvent) {
    e.stopPropagation();
    onAdd?.(node);
  }

  const templateLabel =
    node.template?.name &&
    node.template.name !== "Node" &&
    node.template.name !== "Folder"
      ? node.template.name
      : null;

  return (
    <>
      <div
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={node.hasChildren ? isExpanded : undefined}
        onClick={handleSelect}
        title={
          isGhost
            ? side === "destination"
              ? "This item does not exist in the destination environment"
              : "This item does not exist in the source environment"
            : node.isDifferent
            ? [
                `Item differs between environments`,
                `Source:      updated ${node.sourceUpdated ?? "unknown"} by ${node.sourceUpdatedBy ?? "unknown"} · rev ${node.sourceRevision ?? "unknown"}`,
                `Destination: updated ${node.destUpdated ?? "unknown"} by ${node.destUpdatedBy ?? "unknown"} · rev ${node.destRevision ?? "unknown"}`,
              ].join("\n")
            : undefined
        }
        className={cn(
          "group flex items-center gap-1.5 px-2 py-1.5 rounded-md select-none text-sm transition-colors",
          // Ghost styling
          isGhost && "opacity-50 italic cursor-default",
          isGhost && "border-l-2 border-dashed border-muted-foreground/30 ml-0.5",
          // Selectable / selected
          !isGhost && side === "source" && isSelected && "bg-primary/10 text-primary cursor-pointer",
          !isGhost && side === "source" && !isSelected && "hover:bg-muted/60 cursor-pointer",
          !isGhost && side === "destination" && "cursor-default hover:bg-muted/30",
          // Modified indicator background
          node.isDifferent && !isGhost && "bg-amber-50 dark:bg-amber-900/10"
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {/* Expand chevron / loading — only on source side (shared state) */}
        {side === "source" ? (
          <span
            onClick={handleToggle}
            className={cn(
              "shrink-0 size-4 flex items-center justify-center rounded transition-colors",
              node.hasChildren
                ? "hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                : "cursor-default opacity-0 pointer-events-none"
            )}
          >
            {isLoading ? (
              <Spinner className="size-3" />
            ) : (
              <ChevronRight
                className={cn("size-3.5 transition-transform", isExpanded && "rotate-90")}
              />
            )}
          </span>
        ) : (
          // Destination side: show loading or spacer to keep alignment
          <span className="shrink-0 size-4 flex items-center justify-center">
            {isLoading ? (
              <Spinner className="size-3" />
            ) : (
              <span
                className={cn(
                  "size-3.5",
                  node.hasChildren ? "opacity-0" : "opacity-0"
                )}
              />
            )}
          </span>
        )}

        {/* Icon — ghost uses CloudOff, otherwise use Sitecore icon with lucide fallback */}
        <span className={cn("shrink-0", isGhost ? "text-muted-foreground/50" : "text-muted-foreground")}>
          {isGhost ? (
            <CloudOff className="size-4" />
          ) : node.icon && !iconError ? (
            <img
              src={transformIconUrl(node.icon)}
              width={16}
              height={16}
              alt=""
              className="size-4 object-contain"
              onError={() => setIconError(true)}
            />
          ) : node.hasChildren ? (
            isExpanded ? (
              <FolderOpen className="size-4" />
            ) : (
              <Folder className="size-4" />
            )
          ) : (
            <File className="size-4" />
          )}
        </span>

        {/* Name */}
        <span className={cn("flex-1 truncate font-medium", isGhost && "text-muted-foreground/60")}>
          {node.name}
        </span>

        {/* Already-added indicator (source side only) */}
        {isAlreadyAdded && (
          <Check className="shrink-0 size-3.5 text-primary" aria-label="Added to transfer" />
        )}

        {/* Add to transfer — revealed on hover, source side only. Always laid out
            (opacity-toggled, not hidden/inline-flex-toggled) so appearing on
            hover doesn't reflow/shift the row. */}
        {onAdd && side === "source" && !isGhost && !isAlreadyAdded && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 inline-flex h-6 px-2 text-xs opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto"
            onClick={handleAdd}
          >
            Add to Transfer
          </Button>
        )}

        {/* Modified indicator */}
        {node.isDifferent && !isGhost && (
          <span className="shrink-0 size-2 rounded-full bg-amber-400 dark:bg-amber-500" aria-label="Modified" />
        )}

        {/* Template badge — same opacity-toggle reasoning as the Add button above */}
        {templateLabel && !isGhost && (
          <Badge
            colorScheme="neutral"
            size="sm"
            className="shrink-0 inline-flex opacity-0 transition-opacity group-hover:opacity-100"
          >
            {templateLabel}
          </Badge>
        )}
      </div>

      {/* Error */}
      {nodeError && isExpanded && (
        <div
          className="text-xs text-danger-fg px-2 py-1"
          style={{ paddingLeft: `${8 + (depth + 1) * 16}px` }}
        >
          {nodeError}
        </div>
      )}

      {/* Children */}
      {isExpanded && children && children.length > 0 && (
        <>
          {children.map((child) => (
            <DualTreeRow
              key={child.itemId}
              node={child}
              side={side}
              depth={depth + 1}
              getDualChildren={getDualChildren}
              expandNode={expandNode}
              isLoadingPath={isLoadingPath}
              getError={getError}
              selectedPath={selectedPath}
              onSelect={onSelect}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              existingPaths={existingPaths}
              onAdd={onAdd}
            />
          ))}
        </>
      )}

      {isExpanded && children && children.length === 0 && (
        <div
          className="text-xs text-muted-foreground px-2 py-1 italic"
          style={{ paddingLeft: `${8 + (depth + 1) * 16}px` }}
        >
          No children
        </div>
      )}
    </>
  );
}

// ── DualTreePane ───────────────────────────────────────────────────────────

export interface DualTreePaneProps {
  side: "source" | "destination";
  rootPath: string;
  getDualChildren: (path: string) => DualTreeNode[] | undefined;
  expandNode: (path: string) => void;
  isLoadingPath: (path: string) => boolean;
  getError: (path: string) => string | null;
  selectedPath: string | null;
  onSelect: (node: DualTreeNode) => void;
  /** Shared expansion state owned by the parent */
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  /** Paths already added to the transfer — shown with a check icon on source side */
  existingPaths?: string[];
  /** Called when the hover "Add to Transfer" button is clicked on a source row */
  onAdd?: (node: DualTreeNode) => void;
}

export function DualTreePane({
  side,
  rootPath,
  getDualChildren,
  expandNode,
  isLoadingPath,
  getError,
  selectedPath,
  onSelect,
  expandedPaths,
  onToggleExpand,
  existingPaths = [],
  onAdd,
}: DualTreePaneProps) {
  // Trigger initial load of the root on mount
  useEffect(() => {
    expandNode(rootPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath]);

  const rootChildren = getDualChildren(rootPath);
  const isLoading = isLoadingPath(rootPath);
  const rootError = getError(rootPath);

  if (isLoading && !rootChildren) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
        <Spinner className="size-4" />
        <span>Loading tree...</span>
      </div>
    );
  }

  if (rootError && !rootChildren) {
    return (
      <div className="py-8 text-center text-sm text-danger-fg">
        <p className="font-medium">Failed to load tree</p>
        <p className="text-xs mt-1">{rootError}</p>
      </div>
    );
  }

  if (!rootChildren || rootChildren.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No items found
      </div>
    );
  }

  return (
    <div role="tree" className="space-y-0.5">
      {rootChildren.map((node) => (
        <DualTreeRow
          key={node.path}
          node={node}
          side={side}
          depth={0}
          getDualChildren={getDualChildren}
          expandNode={expandNode}
          isLoadingPath={isLoadingPath}
          getError={getError}
          selectedPath={selectedPath}
          onSelect={onSelect}
          expandedPaths={expandedPaths}
          onToggleExpand={onToggleExpand}
          existingPaths={existingPaths}
          onAdd={onAdd}
        />
      ))}
    </div>
  );
}
