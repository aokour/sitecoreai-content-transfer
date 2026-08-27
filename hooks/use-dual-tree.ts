"use client";

import { useMarketplaceClient } from "@/components/providers/marketplace";
import { useCallback, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

export interface DualTreeNode {
  /** itemId from whichever side has the item */
  itemId: string;
  name: string;
  path: string;
  /** true if EITHER side reports children */
  hasChildren: boolean;
  template?: { name: string };
  /** Icon URL from Sitecore — use transformIconUrl() before rendering */
  icon?: string;
  existsInSource: boolean;
  existsInDestination: boolean;
  /** ISO string from the source __Updated field */
  sourceUpdated?: string;
  /** ISO string from the destination __Updated field */
  destUpdated?: string;
  /** Username from the source __Updated By field */
  sourceUpdatedBy?: string;
  /** Username from the destination __Updated By field */
  destUpdatedBy?: string;
  /** GUID from the source __Revision field (changes on every save) */
  sourceRevision?: string;
  /** GUID from the destination __Revision field */
  destRevision?: string;
  /** true when both sides have the item but __Revision (or __Updated) values differ */
  isDifferent: boolean;
}

interface RawTreeNode {
  itemId: string;
  name: string;
  path: string;
  hasChildren: boolean;
  template?: { name: string };
  icon?: string;
  updated?: { value: string } | null;
  updatedBy?: { value: string } | null;
  revision?: { value: string } | null;
}

/**
 * The full GraphQL HTTP response envelope. `nodes` entries can be `null` at
 * runtime when a field on that item errors (e.g. a broken/inaccessible
 * template) — Sitecore null-propagates the whole node, not just the field —
 * even though the schema's declared type lies about this.
 */
interface GraphQLEnvelope {
  data?: {
    item?: {
      children?: {
        nodes: (RawTreeNode | null)[];
        pageInfo?: { endCursor: string | null; hasNextPage: boolean };
      };
    };
  };
  errors?: Array<{
    message?: string;
    path?: Array<string | number>;
  }>;
}

type Side = "source" | "destination";

export interface SideFetchError {
  /** "hard" = the whole side's query failed; "partial" = some item(s) were nulled by a GraphQL error */
  kind: "hard" | "partial";
  message: string;
}

type PathErrorState = Partial<Record<Side, SideFetchError>>;

/** Per-side pagination bookkeeping for one tree path — not rendered directly,
 * so it lives in a ref rather than state (see `paginationRef`). */
interface SidePageState {
  cursor: string | null;
  hasMore: boolean;
  rawNodes: RawTreeNode[];
}

function freshSideState(): SidePageState {
  return { cursor: null, hasMore: false, rawNodes: [] };
}

// ── GraphQL query ──────────────────────────────────────────────────────────
// Fetches children plus the __Updated standard field for diff comparison.
// Paginated: `first`'s GraphQL type is the custom scalar `PaginationAmount`
// (not `Int`) — confirmed via schema introspection. A variable declared as
// `Int` fails validation against it, so this must stay `PaginationAmount`.

const PAGE_SIZE = 1000;

const GET_CHILDREN_WITH_META = /* GraphQL */ `
  query GetSitecoreItemsDual($path: String!, $systemLocale: String!, $first: PaginationAmount!, $after: String) {
    item(where: { database: "master", path: $path, language: $systemLocale }) {
      children(first: $first, after: $after) {
        pageInfo {
          endCursor
          hasNextPage
        }
        nodes {
          itemId
          name
          hasChildren
          path
          icon
          template {
            name
          }
          updated: field(name: "__Updated") {
            value
          }
          updatedBy: field(name: "__Updated by") {
            value
          }
          revision: field(name: "__Revision") {
            value
          }
        }
      }
    }
  }
`;

// ── Icon URL transform ─────────────────────────────────────────────────────
// Sitecore's GraphQL returns /-/icon/ URLs which are redirect aliases;
// the actual browser-accessible path uses /temp/iconcache/.

export function transformIconUrl(url: string): string {
  return url
    .replace("/-/icon/", "/temp/iconcache/")
    .replace("/32x32/", "/16x16/")
    .toLowerCase();
}

// ── Error helpers ────────────────────────────────────────────────────────────

function extractErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const rec = err as Record<string, unknown>;
    if (typeof rec.message === "string") return rec.message;
    if (typeof rec.Message === "string") return rec.Message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return "Failed to load children";
  }
}

/** Scans GraphQL error paths for a "nodes" segment and returns the numeric index that follows it, if any. */
function extractBadIndices(
  errors: NonNullable<GraphQLEnvelope["errors"]>,
): number[] {
  const indices = new Set<number>();
  for (const e of errors) {
    const path = e.path;
    if (!path) continue;
    const nodesPos = path.indexOf("nodes");
    if (nodesPos >= 0 && typeof path[nodesPos + 1] === "number") {
      indices.add(path[nodesPos + 1] as number);
    }
  }
  return [...indices];
}

function summarizePartialErrors(
  errors: NonNullable<GraphQLEnvelope["errors"]>,
  badCount: number,
): string {
  const messages = [
    ...new Set(errors.map((e) => e.message).filter((m): m is string => !!m)),
  ];
  const firstMessage = messages[0] ?? "unknown error";
  return `${badCount} item${badCount === 1 ? "" : "s"} couldn't be loaded (${firstMessage})`;
}

// ── Merge helpers ──────────────────────────────────────────────────────────

function mergeNodes(
  sourceNodes: RawTreeNode[],
  destNodes: RawTreeNode[],
): DualTreeNode[] {
  const byItemId = new Map<string, DualTreeNode>();

  for (const n of sourceNodes) {
    byItemId.set(n.itemId, {
      itemId: n.itemId,
      name: n.name,
      path: n.path,
      hasChildren: n.hasChildren,
      template: n.template,
      icon: n.icon,
      existsInSource: true,
      existsInDestination: false,
      sourceUpdated: n.updated?.value,
      sourceUpdatedBy: n.updatedBy?.value,
      sourceRevision: n.revision?.value,
      isDifferent: false,
    });
  }

  for (const n of destNodes) {
    const existing = byItemId.get(n.itemId);
    if (existing) {
      existing.existsInDestination = true;
      existing.destUpdated = n.updated?.value;
      existing.destUpdatedBy = n.updatedBy?.value;
      existing.destRevision = n.revision?.value;
      // If either side has children, the merged node reports children
      existing.hasChildren = existing.hasChildren || n.hasChildren;
      // Use __Revision as primary diff signal — it's a GUID Sitecore regenerates
      // on every save, so it's more reliable than comparing timestamps.
      // Fall back to __Updated if either revision is missing.
      const srcRev = existing.sourceRevision;
      const dstRev = n.revision?.value;
      if (srcRev && dstRev) {
        existing.isDifferent = srcRev !== dstRev;
      } else {
        const srcUpd = existing.sourceUpdated;
        const dstUpd = n.updated?.value;
        existing.isDifferent = !!srcUpd && !!dstUpd && srcUpd !== dstUpd;
      }
    } else {
      byItemId.set(n.itemId, {
        itemId: n.itemId,
        name: n.name,
        path: n.path,
        hasChildren: n.hasChildren,
        template: n.template,
        icon: n.icon,
        existsInSource: false,
        existsInDestination: true,
        destUpdated: n.updated?.value,
        destUpdatedBy: n.updatedBy?.value,
        destRevision: n.revision?.value,
        isDifferent: false,
      });
    }
  }

  // Sort: items that exist on both sides first, then source-only, then dest-only;
  // within each group sort alphabetically by name.
  return [...byItemId.values()].sort((a, b) => {
    const aScore =
      a.existsInSource && a.existsInDestination ? 0 : a.existsInSource ? 1 : 2;
    const bScore =
      b.existsInSource && b.existsInDestination ? 0 : b.existsInSource ? 1 : 2;
    if (aScore !== bScore) return aScore - bScore;
    return a.name.localeCompare(b.name);
  });
}

// ── Per-side fetch ───────────────────────────────────────────────────────────
// Throws (so Promise.allSettled reports it as a rejection, uniformly with a
// transport-level exception) when the side's query failed outright. Otherwise
// returns the successfully-parsed nodes (nulls filtered out) plus an optional
// "partial" error describing any items that were nulled by a GraphQL error.

async function fetchSideNodes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  contextId: string,
  variables: { path: string; systemLocale: string; first: number; after: string | null },
): Promise<{
  nodes: RawTreeNode[];
  partialError: SideFetchError | null;
  endCursor: string | null;
  hasMore: boolean;
}> {
  const res = await client.mutate("xmc.authoring.graphql", {
    params: {
      body: { query: GET_CHILDREN_WITH_META, variables },
      query: { sitecoreContextId: contextId },
    },
  });

  const resAny = res as unknown as { data?: unknown; error?: unknown };
  if (resAny.error || !resAny.data) {
    throw new Error(extractErrorMessage(resAny.error ?? "Failed to load children"));
  }

  const envelope = resAny.data as GraphQLEnvelope;
  const rawNodes = envelope.data?.item?.children?.nodes ?? [];
  const pageInfo = envelope.data?.item?.children?.pageInfo;
  const endCursor = pageInfo?.endCursor ?? null;
  const hasMore = pageInfo?.hasNextPage ?? false;
  const errors = envelope.errors ?? [];
  const filtered = rawNodes.filter((n): n is RawTreeNode => n !== null);

  if (errors.length === 0) {
    return { nodes: filtered, partialError: null, endCursor, hasMore };
  }

  const badIndices = extractBadIndices(errors);
  if (badIndices.length > 0) {
    return {
      nodes: filtered,
      partialError: {
        kind: "partial",
        message: summarizePartialErrors(errors, badIndices.length),
      },
      endCursor,
      hasMore,
    };
  }

  // Errors present but none map to a nodes[] index — likely a broader failure
  // (e.g. bad path/auth on the `item` field itself), so treat the whole side
  // as failed rather than silently rendering an empty/partial list.
  throw new Error(extractErrorMessage(errors[0]?.message ?? "Failed to load children"));
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useDualTree(
  sourceContextId: string | null,
  destinationContextId: string | null,
) {
  const client = useMarketplaceClient();

  // Map<path, DualTreeNode[]> — merged children per parent path
  const [childrenMap, setChildrenMap] = useState<Map<string, DualTreeNode[]>>(
    new Map(),
  );
  // Set of paths currently being fetched
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  // Map<path, per-side error state>
  const [errorMap, setErrorMap] = useState<Map<string, PathErrorState>>(
    new Map(),
  );
  // Map<path, true if either side has more pages to load>
  const [hasMoreMap, setHasMoreMap] = useState<Map<string, boolean>>(
    new Map(),
  );

  const childrenMapRef = useRef(childrenMap);
  childrenMapRef.current = childrenMap;
  const errorMapRef = useRef(errorMap);
  errorMapRef.current = errorMap;
  const loadingPathsRef = useRef(loadingPaths);
  loadingPathsRef.current = loadingPaths;
  // Per-path, per-side pagination bookkeeping (cursor/hasMore/accumulated raw
  // nodes) — internal to fetching, never rendered directly, so a ref rather
  // than state.
  const paginationRef = useRef(
    new Map<string, { source: SidePageState; destination: SidePageState }>(),
  );

  const fetchChildren = useCallback(
    async (path: string, opts?: { loadMore?: boolean }) => {
      if (!sourceContextId) return;
      if (loadingPathsRef.current.has(path)) return;

      const loadMore = opts?.loadMore ?? false;
      const priorErrors = errorMapRef.current.get(path);
      const hadChildrenBefore = childrenMapRef.current.has(path);

      if (!loadMore) {
        // Any existing error (not just "hard") makes this path eligible for a
        // manual retry — a "partial" item error may have been a transient/fixed
        // server-side issue, so there's no reason to lock it out forever.
        const needsRetry = !!(priorErrors?.source || priorErrors?.destination);
        if (hadChildrenBefore && !needsRetry) return;
        // Fresh load (or full retry) — reset pagination bookkeeping for this path.
        paginationRef.current.set(path, {
          source: freshSideState(),
          destination: freshSideState(),
        });
      }

      const pageState =
        paginationRef.current.get(path) ??
        { source: freshSideState(), destination: freshSideState() };
      paginationRef.current.set(path, pageState);

      setLoadingPaths((prev) => new Set(prev).add(path));
      setErrorMap((prev) => {
        const next = new Map(prev);
        next.delete(path);
        return next;
      });

      try {
        const fetchSide = (contextId: string, side: Side) =>
          fetchSideNodes(client, contextId, {
            path,
            systemLocale: "en",
            first: PAGE_SIZE,
            after: pageState[side].cursor,
          });

        // On a loadMore call, skip a side entirely once it has no more pages —
        // same reasoning as skipping the destination fetch when there's no
        // destination context at all.
        const shouldFetchSource = !loadMore || pageState.source.hasMore;
        const shouldFetchDestination =
          !!destinationContextId && (!loadMore || pageState.destination.hasMore);

        // Fetch both environments independently — a hard failure on one side
        // must not prevent the other side's data from rendering.
        const [srcOutcome, dstOutcome] = await Promise.allSettled([
          shouldFetchSource
            ? fetchSide(sourceContextId, "source")
            : Promise.resolve(null),
          shouldFetchDestination
            ? fetchSide(destinationContextId as string, "destination")
            : Promise.resolve(null),
        ]);

        const pathErrors: PathErrorState = {};

        if (shouldFetchSource) {
          if (srcOutcome.status === "fulfilled" && srcOutcome.value) {
            pageState.source.rawNodes = pageState.source.rawNodes.concat(
              srcOutcome.value.nodes,
            );
            pageState.source.cursor = srcOutcome.value.endCursor;
            pageState.source.hasMore = srcOutcome.value.hasMore;
            if (srcOutcome.value.partialError) {
              pathErrors.source = srcOutcome.value.partialError;
            }
          } else if (srcOutcome.status === "rejected") {
            // On the very first page, a hard failure means "we have nothing
            // reliable." On a loadMore page, we already have prior pages —
            // don't discard them or advance the cursor, so the same "Load
            // more" click naturally retries; report it as "partial" since
            // "hard" suppresses children rendering entirely in the UI.
            pathErrors.source = {
              kind: loadMore ? "partial" : "hard",
              message: extractErrorMessage(srcOutcome.reason),
            };
          }
        }

        // Only evaluate the destination outcome when a destination fetch was
        // actually attempted — otherwise it's "not attempted," not "failed."
        if (shouldFetchDestination) {
          if (dstOutcome.status === "fulfilled" && dstOutcome.value) {
            pageState.destination.rawNodes = pageState.destination.rawNodes.concat(
              dstOutcome.value.nodes,
            );
            pageState.destination.cursor = dstOutcome.value.endCursor;
            pageState.destination.hasMore = dstOutcome.value.hasMore;
            if (dstOutcome.value.partialError) {
              pathErrors.destination = dstOutcome.value.partialError;
            }
          } else if (dstOutcome.status === "rejected") {
            pathErrors.destination = {
              kind: loadMore ? "partial" : "hard",
              message: extractErrorMessage(dstOutcome.reason),
            };
          }
        }

        // A hard failure on a side that previously succeeded for this path is
        // a regression, not new information — don't let it clobber good cached
        // data with a degraded merge (which would misrepresent "we don't know"
        // as "confirmed identical/source-only"). Keep the last-known-good
        // children and just record the fresh error so it's still surfaced.
        const sourceRegressed =
          hadChildrenBefore && !priorErrors?.source && pathErrors.source?.kind === "hard";
        const destRegressed =
          hadChildrenBefore &&
          !priorErrors?.destination &&
          pathErrors.destination?.kind === "hard";

        if (!sourceRegressed && !destRegressed) {
          const merged = mergeNodes(
            pageState.source.rawNodes,
            pageState.destination.rawNodes,
          );
          setChildrenMap((prev) => {
            const next = new Map(prev);
            next.set(path, merged);
            return next;
          });
        }

        setErrorMap((prev) => {
          const next = new Map(prev);
          if (pathErrors.source || pathErrors.destination) {
            next.set(path, pathErrors);
          } else {
            next.delete(path);
          }
          return next;
        });

        setHasMoreMap((prev) => {
          const next = new Map(prev);
          next.set(path, pageState.source.hasMore || pageState.destination.hasMore);
          return next;
        });
      } catch (err) {
        // Last-resort safety net for unexpected exceptions in the processing
        // logic itself (not a per-side fetch failure, which is already
        // handled above via Promise.allSettled). We don't know which side
        // actually caused it, so mark both rather than falsely blaming source.
        const message = extractErrorMessage(
          err instanceof Error ? err.message : err,
        );
        setErrorMap((prev) => {
          const next = new Map(prev);
          next.set(path, {
            source: { kind: "hard", message },
            ...(destinationContextId
              ? { destination: { kind: "hard", message } }
              : {}),
          });
          return next;
        });
      } finally {
        setLoadingPaths((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [client, sourceContextId, destinationContextId],
  );

  const getDualChildren = useCallback(
    (path: string): DualTreeNode[] | undefined => childrenMap.get(path),
    [childrenMap],
  );

  const expandNode = useCallback(
    (path: string) => {
      fetchChildren(path);
    },
    [fetchChildren],
  );

  const isLoadingPath = useCallback(
    (path: string) => loadingPaths.has(path),
    [loadingPaths],
  );

  const getError = useCallback(
    (path: string, side: Side): SideFetchError | null =>
      errorMap.get(path)?.[side] ?? null,
    [errorMap],
  );

  const hasMoreChildren = useCallback(
    (path: string) => hasMoreMap.get(path) ?? false,
    [hasMoreMap],
  );

  const loadMoreChildren = useCallback(
    (path: string) => {
      fetchChildren(path, { loadMore: true });
    },
    [fetchChildren],
  );

  return {
    getDualChildren,
    expandNode,
    isLoadingPath,
    getError,
    hasMoreChildren,
    loadMoreChildren,
  };
}
