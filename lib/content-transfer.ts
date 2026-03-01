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

export interface TransferRecord {
  transferId: string;
  label: string;
  sourceContextId: string;
  destinationContextId: string;
  sourceTenantName: string;
  destinationTenantName: string;
  createdAt: string; // ISO string
  itemPaths: string[];
  phase: TransferPhase;
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

export function formatTransferId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}...${id.slice(-4)}`;
}

export function isTransferActive(phase: TransferPhase): boolean {
  return (
    phase === "creating" ||
    phase === "preparing" ||
    phase === "transferring" ||
    phase === "importing"
  );
}

export function generateTransferId(): string {
  return crypto.randomUUID();
}
