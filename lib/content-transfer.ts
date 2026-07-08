// ─── Types ───────────────────────────────────────────────────────────────────

// Scope values supported by the SDK (no "DescendantsOnly")
export type TransferScope = "SingleItem" | "ItemAndDescendants";

// MergeStrategy values supported by the SDK
export type MergeStrategy =
  | "OverrideExistingItem"
  | "KeepExistingItem"
  | "LatestWin"
  | "OverrideExistingTree";

export type TransferPhase =
  | "idle"
  | "creating"
  | "preparing"
  | "transferring"
  | "importing"
  | "completed"
  | "failed";

export interface DataTreeItem {
  itemPath: string;
  scope: TransferScope;
  mergeStrategy: MergeStrategy;
}

export interface TransferConfig {
  transferId: string;
  label: string;
  sourceContextId: string;
  destinationContextId: string;
  sourceTenantName: string;
  destinationTenantName: string;
  dataTrees: DataTreeItem[];
}

export interface ChunkSetMetadata {
  ChunkSetId: string;
  ChunkCount: number;
  TotalItemCount: number;
}

export interface ContentTransferStatus {
  State: string;
  ChunkSetsMetadata: ChunkSetMetadata[];
}

/**
 * Actual runtime shape of the GetBlobState response.
 * Note: the SDK-generated types have { status, details } but the real API
 * returns { BlobState, Error, Actions, ConsumedName }.
 */
export interface BlobStateResponse {
  BlobState?: string;
  Error?: string | null;
  ConsumedName?: string | null;
  Actions?: Record<string, unknown>;
}

export interface ResourceAccessEntry {
  resourceId: string;
  tenantId: string;
  /** Preferred display label — present in real responses */
  tenantDisplayName?: string | null;
  /** Legacy field — often null in real responses; use tenantDisplayName instead */
  tenantName?: string | null;
  context: {
    live: string;
    preview: string;
  };
}

/** Returns the best available human-readable label for an environment entry */
export function getEnvironmentLabel(entry: ResourceAccessEntry): string {
  return (
    entry.tenantDisplayName ||
    entry.tenantName ||
    entry.tenantId
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const SCOPE_OPTIONS: { value: TransferScope; label: string; description: string }[] = [
  {
    value: "SingleItem",
    label: "Single Item",
    description: "Transfer only the selected item, no children",
  },
  {
    value: "ItemAndDescendants",
    label: "Item & Descendants",
    description: "Transfer the item and all its children recursively",
  },
];

export const MERGE_STRATEGY_OPTIONS: { value: MergeStrategy; label: string; description: string }[] = [
  {
    value: "OverrideExistingItem",
    label: "Override Existing",
    description: "Overwrite the item if it already exists in the destination",
  },
  {
    value: "KeepExistingItem",
    label: "Keep Existing",
    description: "Leave untouched if the item already exists in the destination",
  },
  {
    value: "LatestWin",
    label: "Latest Wins",
    description: "Keep whichever version was most recently modified",
  },
  {
    value: "OverrideExistingTree",
    label: "Override Tree",
    description: "Override the entire tree rooted at this item",
  },
];

export const TRANSFER_PHASE_LABELS: Record<TransferPhase, string> = {
  idle: "Not started",
  creating: "Creating transfer...",
  preparing: "Packaging content...",
  transferring: "Transferring chunks...",
  importing: "Importing to destination...",
  completed: "Completed",
  failed: "Failed",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true if the given Sitecore item path is under the Media Library. */
export function isMediaPath(itemPath: string): boolean {
  return itemPath.toLowerCase().startsWith("/sitecore/media library");
}

export type StatusColorScheme = "neutral" | "primary" | "success" | "danger" | "warning";

export function getPhaseColorScheme(phase: TransferPhase): StatusColorScheme {
  switch (phase) {
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "idle":
      return "neutral";
    default:
      return "primary";
  }
}

export function generateTransferId(): string {
  return crypto.randomUUID();
}

/**
 * Returns a Map<coveredIndex, coveringIndex> for items where one entry's path
 * is a descendant of another entry that has ItemAndDescendants scope.
 */
export function findOverlaps(items: DataTreeItem[]): Map<number, number> {
  const covered = new Map<number, number>();
  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      if (
        items[j].scope === "ItemAndDescendants" &&
        items[i].itemPath.startsWith(items[j].itemPath + "/")
      ) {
        covered.set(i, j);
        break;
      }
    }
  }
  return covered;
}
