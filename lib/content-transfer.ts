import { ALLOW_LOCAL_DOCKER_DESTINATION } from "@/lib/feature-flags";

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
  // Backup-only: pulling chunks from the source and writing them to the archive.
  | "downloading"
  | "archiving"
  // Restore-only: reading chunks back out of the archive.
  | "reading"
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

/**
 * A locally-registered Docker/on-prem SitecoreAI instance, reached via direct
 * REST/GraphQL calls instead of the Marketplace SDK's PostMessage bridge
 * (which only knows how to route to environments registered in
 * `appContext.resourceAccess` — a local container has no such registration).
 * Persisted client-side only; see `lib/environment-client/local-docker-storage.ts`.
 */
export interface LocalDockerEnvironmentEntry {
  kind: "local-docker";
  /** Generated on creation (crypto.randomUUID()) — this entry's stable id. */
  id: string;
  displayName: string;
  /** e.g. "https://xmcloudcm.localhost" — no trailing slash. */
  baseUrl: string;
  /**
   * Pasted bearer token, obtained out-of-band via the Sitecore CLI login
   * flow. Bearer token is the only supported auth mode for a Docker
   * environment — there's no automatable client-credentials exchange without
   * a backend to run the CLI from, so this is always a manual paste.
   */
  token?: string;
}

/** A real SitecoreAI environment reached through the Marketplace SDK bridge. */
export type MarketplaceEnvironmentEntry = ResourceAccessEntry & {
  kind: "marketplace";
};

export type EnvironmentEntry =
  | MarketplaceEnvironmentEntry
  | LocalDockerEnvironmentEntry;

/** Stable identifier for an environment, usable as a Select value / lookup key
 *  regardless of which kind it is. */
export function getEnvironmentId(entry: EnvironmentEntry): string {
  return entry.kind === "marketplace" ? entry.context.preview : entry.id;
}

/** Looks up an environment by its getEnvironmentId() value. */
export function findEnvironmentById(
  environments: EnvironmentEntry[],
  id: string | null | undefined,
): EnvironmentEntry | undefined {
  if (!id) return undefined;
  return environments.find((e) => getEnvironmentId(e) === id);
}

/**
 * A stable "which distinct environment is this" identifier used to detect a
 * same-environment round trip (e.g. backing up from and restoring into the
 * same place) — the Marketplace tenant id for real environments, or the
 * local entry's own id for a Docker instance (which has no tenant concept).
 */
export function getEnvironmentTenantId(entry: EnvironmentEntry): string {
  return entry.kind === "marketplace" ? entry.tenantId : entry.id;
}

/**
 * Whether an environment can be picked as a transfer/restore *destination*.
 * Local Docker environments can't by default — the Content Transfer API's
 * chunk-staging pipeline needs a valid Azure Blob Storage connection string
 * configured on the destination container, which most local setups won't
 * have — see ALLOW_LOCAL_DOCKER_DESTINATION. Source-side selection is never
 * restricted; this only gates destination pickers.
 */
export function canBeDestination(entry: EnvironmentEntry): boolean {
  return entry.kind === "marketplace" || ALLOW_LOCAL_DOCKER_DESTINATION;
}

/** Returns the best available human-readable label for an environment entry */
export function getEnvironmentLabel(entry: EnvironmentEntry): string {
  if (entry.kind === "local-docker") return entry.displayName;
  return entry.tenantDisplayName || entry.tenantName || entry.tenantId;
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
  downloading: "Downloading chunks...",
  archiving: "Writing archive...",
  reading: "Reading archive...",
  completed: "Completed",
  failed: "Failed",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true if the given Sitecore item path is under the Media Library. */
export function isMediaPath(itemPath: string): boolean {
  return itemPath.toLowerCase().startsWith("/sitecore/media library");
}

/** Phases where work is in flight, across transfer, backup and restore. */
export const ACTIVE_PHASES: TransferPhase[] = [
  "creating",
  "preparing",
  "transferring",
  "importing",
  "downloading",
  "archiving",
  "reading",
];

export function isActivePhase(phase: TransferPhase): boolean {
  return ACTIVE_PHASES.includes(phase);
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
