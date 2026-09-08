"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DualTreeNode, SideFetchError } from "@/hooks/use-dual-tree";
import { useSitecoreIcon } from "@/lib/sitecore-icon";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  CloudOff,
  File,
  Folder,
  FolderOpen,
} from "lucide-react";
import { useEffect } from "react";

// ── Dual-pane tree ─────────────────────────────────────────────────────────
// Used by the dual-pane tree picker to render source and destination sides
// with ghost nodes and modification indicators.

/** Shared by DualTreeRow (per-row) and DualTreePane (root-level) — a compact,
 * always-clickable, keyboard/touch-accessible indicator for a children-fetch
 * error on one side. "kind" only changes color/message, not interactivity. */
function ChildrenFetchErrorIndicator({
  error,
  onRetry,
}: {
  error: SideFetchError;
  onRetry: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "shrink-0",
            error.kind === "hard" ? "text-danger-fg" : "text-warning-fg",
          )}
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
        >
          <AlertTriangle className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{error.message} — click to retry</TooltipContent>
    </Tooltip>
  );
}

/** A row offering to fetch the next page of children for a path. Rendered at
 * the same height/indentation on both sides so the panes stay aligned — only
 * the source side is an actual clickable control, mirroring the expand
 * chevron pattern above. */
function LoadMoreRow({
  side,
  depth,
  isLoading,
  onLoadMore,
}: {
  side: "source" | "destination";
  depth: number;
  isLoading: boolean;
  onLoadMore: () => void;
}) {
  return (
    <div
      className="flex h-8 items-center"
      style={{ paddingLeft: `${8 + depth * 16}px` }}
    >
      {side === "source" && (
        <button
          type="button"
          disabled={isLoading}
          onClick={(e) => {
            e.stopPropagation();
            onLoadMore();
          }}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {isLoading ? <Spinner className="size-3" /> : <ChevronDown className="size-3" />}
          Load more
        </button>
      )}
    </div>
  );
}

interface DualTreeRowProps {
  node: DualTreeNode;
  side: "source" | "destination";
  depth: number;
  getDualChildren: (path: string) => DualTreeNode[] | undefined;
  expandNode: (path: string) => void;
  isLoadingPath: (path: string) => boolean;
  getError: (path: string, side: "source" | "destination") => SideFetchError | null;
  hasMoreChildren: (path: string) => boolean;
  loadMoreChildren: (path: string) => void;
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
  hasMoreChildren,
  loadMoreChildren,
  selectedPath,
  onSelect,
  expandedPaths,
  onToggleExpand,
  existingPaths = [],
  onAdd,
}: DualTreeRowProps) {
  const isExpanded = expandedPaths.has(node.path);
  const icon = useSitecoreIcon(node.icon);
  const children = getDualChildren(node.path);
  const isLoading = isLoadingPath(node.path);
  const nodeError = getError(node.path, side);
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
    // Re-fetch on expand if we've never loaded this path, or if the last
    // attempt errored on this side — collapsing and re-expanding a row is a
    // natural, discoverable way to retry, not just the error icon's onClick.
    if (next && (children === undefined || nodeError)) {
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
          // Fixed height (not content-driven) so source rows — which always mount
          // the Add-to-Transfer button, even invisibly — stay exactly as tall as
          // destination rows. Otherwise the two panes drift out of sync going down.
          "group flex h-8 items-center gap-1.5 px-2 rounded-md select-none text-sm transition-colors",
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
          ) : icon.src ? (
            <img
              src={icon.src}
              width={16}
              height={16}
              alt=""
              className="size-4 object-contain"
              onError={icon.onError}
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

        {/* Children-fetch error for this side — an icon, not a block, so it never
            adds row height (which would break the source/destination row sync). */}
        {nodeError && isExpanded && (
          <ChildrenFetchErrorIndicator
            error={nodeError}
            onRetry={() => expandNode(node.path)}
          />
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

      {/* Children — suppressed on a hard error for this side; the error+retry
          line above already covers that state, and the merged list would
          otherwise misleadingly show only the other side's (ghosted) items. */}
      {nodeError?.kind !== "hard" && isExpanded && children && children.length > 0 && (
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
              hasMoreChildren={hasMoreChildren}
              loadMoreChildren={loadMoreChildren}
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

      {nodeError?.kind !== "hard" && isExpanded && children && children.length === 0 && (
        <div
          className="text-xs text-muted-foreground px-2 py-1 italic"
          style={{ paddingLeft: `${8 + (depth + 1) * 16}px` }}
        >
          No children
        </div>
      )}

      {nodeError?.kind !== "hard" && isExpanded && children && hasMoreChildren(node.path) && (
        <LoadMoreRow
          side={side}
          depth={depth + 1}
          isLoading={isLoading}
          onLoadMore={() => loadMoreChildren(node.path)}
        />
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
  getError: (path: string, side: "source" | "destination") => SideFetchError | null;
  hasMoreChildren: (path: string) => boolean;
  loadMoreChildren: (path: string) => void;
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
  hasMoreChildren,
  loadMoreChildren,
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
  const rootError = getError(rootPath, side);

  if (isLoading && !rootChildren) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
        <Spinner className="size-4" />
        <span>Loading tree...</span>
      </div>
    );
  }

  // A hard failure on THIS side takes priority over rendering the merged list —
  // even if rootChildren has entries (from the other side succeeding), showing
  // them here would misleadingly look like "nothing exists on this side" rather
  // than "this side's fetch failed."
  if (rootError?.kind === "hard") {
    return (
      <div className="py-8 text-center text-sm text-danger-fg">
        <p className="font-medium">Failed to load tree</p>
        <p className="text-xs mt-1">{rootError.message}</p>
        <button
          type="button"
          className="mt-2 text-xs underline hover:no-underline"
          onClick={() => expandNode(rootPath)}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!rootChildren || rootChildren.length === 0) {
    return (
      <div>
        {/* Root-level partial error — no parent row exists at the root to
            attach this to, so it's rendered inline above the (possibly
            empty) list instead of being silently dropped. */}
        {rootError?.kind === "partial" && (
          <div className="flex items-center gap-1.5 px-2 py-1">
            <ChildrenFetchErrorIndicator
              error={rootError}
              onRetry={() => expandNode(rootPath)}
            />
          </div>
        )}
        <div className="py-8 text-center text-sm text-muted-foreground">
          No items found
        </div>
        {hasMoreChildren(rootPath) && (
          <LoadMoreRow
            side={side}
            depth={0}
            isLoading={isLoading}
            onLoadMore={() => loadMoreChildren(rootPath)}
          />
        )}
      </div>
    );
  }

  return (
    <div role="tree" className="space-y-0.5">
      {rootError?.kind === "partial" && (
        <div className="flex items-center gap-1.5 px-2 py-1">
          <ChildrenFetchErrorIndicator
            error={rootError}
            onRetry={() => expandNode(rootPath)}
          />
        </div>
      )}
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
          hasMoreChildren={hasMoreChildren}
          loadMoreChildren={loadMoreChildren}
          selectedPath={selectedPath}
          onSelect={onSelect}
          expandedPaths={expandedPaths}
          onToggleExpand={onToggleExpand}
          existingPaths={existingPaths}
          onAdd={onAdd}
        />
      ))}
      {hasMoreChildren(rootPath) && (
        <LoadMoreRow
          side={side}
          depth={0}
          isLoading={isLoading}
          onLoadMore={() => loadMoreChildren(rootPath)}
        />
      )}
    </div>
  );
}
