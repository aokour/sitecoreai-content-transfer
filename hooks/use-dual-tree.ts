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
  updated?: { value: string } | null;
  updatedBy?: { value: string } | null;
  revision?: { value: string } | null;
}

interface GraphQLItemResponse {
  item?: {
    children?: {
      nodes: RawTreeNode[];
    };
  };
}

// ── GraphQL query ──────────────────────────────────────────────────────────
// Fetches children plus the __Updated standard field for diff comparison.

const GET_CHILDREN_WITH_META = /* GraphQL */ `
  query GetSitecoreItemsDual($path: String!, $systemLocale: String!) {
    item(
      where: {
        database: "master"
        path: $path
        language: $systemLocale
      }
    ) {
      children {
        nodes {
          itemId
          name
          hasChildren
          path
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

// ── Merge helpers ──────────────────────────────────────────────────────────

function mergeNodes(
  sourceNodes: RawTreeNode[],
  destNodes: RawTreeNode[]
): DualTreeNode[] {
  const byPath = new Map<string, DualTreeNode>();

  for (const n of sourceNodes) {
    byPath.set(n.path, {
      itemId: n.itemId,
      name: n.name,
      path: n.path,
      hasChildren: n.hasChildren,
      template: n.template,
      existsInSource: true,
      existsInDestination: false,
      sourceUpdated: n.updated?.value,
      sourceUpdatedBy: n.updatedBy?.value,
      sourceRevision: n.revision?.value,
      isDifferent: false,
    });
  }

  for (const n of destNodes) {
    const existing = byPath.get(n.path);
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
      byPath.set(n.path, {
        itemId: n.itemId,
        name: n.name,
        path: n.path,
        hasChildren: n.hasChildren,
        template: n.template,
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
  return [...byPath.values()].sort((a, b) => {
    const aScore = a.existsInSource && a.existsInDestination ? 0 : a.existsInSource ? 1 : 2;
    const bScore = b.existsInSource && b.existsInDestination ? 0 : b.existsInSource ? 1 : 2;
    if (aScore !== bScore) return aScore - bScore;
    return a.name.localeCompare(b.name);
  });
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useDualTree(
  sourceContextId: string | null,
  destinationContextId: string | null
) {
  const client = useMarketplaceClient();

  // Map<path, DualTreeNode[]> — merged children per parent path
  const [childrenMap, setChildrenMap] = useState<Map<string, DualTreeNode[]>>(
    new Map()
  );
  // Set of paths currently being fetched
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  // Map<path, error message>
  const [errorMap, setErrorMap] = useState<Map<string, string>>(new Map());

  const childrenMapRef = useRef(childrenMap);
  childrenMapRef.current = childrenMap;

  const fetchChildren = useCallback(
    async (path: string) => {
      if (!sourceContextId) return;
      if (childrenMapRef.current.has(path)) return;

      setLoadingPaths((prev) => new Set(prev).add(path));
      setErrorMap((prev) => {
        const next = new Map(prev);
        next.delete(path);
        return next;
      });

      try {
        const variables = { path, systemLocale: "en" };

        // Fire both environment fetches in parallel
        const [srcRes, dstRes] = await Promise.all([
          client.mutate("xmc.authoring.graphql", {
            params: {
              body: { query: GET_CHILDREN_WITH_META, variables },
              query: { sitecoreContextId: sourceContextId },
            },
          }),
          destinationContextId
            ? client.mutate("xmc.authoring.graphql", {
                params: {
                  body: { query: GET_CHILDREN_WITH_META, variables },
                  query: { sitecoreContextId: destinationContextId },
                },
              })
            : Promise.resolve(null),
        ]);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const srcData = (srcRes?.data as any)?.data as GraphQLItemResponse | undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dstData = (dstRes?.data as any)?.data as GraphQLItemResponse | undefined;

        const srcNodes: RawTreeNode[] = srcData?.item?.children?.nodes ?? [];
        const dstNodes: RawTreeNode[] = dstData?.item?.children?.nodes ?? [];

        const merged = mergeNodes(srcNodes, dstNodes);

        setChildrenMap((prev) => {
          const next = new Map(prev);
          next.set(path, merged);
          return next;
        });
      } catch (err) {
        setErrorMap((prev) => {
          const next = new Map(prev);
          next.set(
            path,
            err instanceof Error ? err.message : "Failed to load children"
          );
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
    [client, sourceContextId, destinationContextId]
  );

  const getDualChildren = useCallback(
    (path: string): DualTreeNode[] | undefined => childrenMap.get(path),
    [childrenMap]
  );

  const expandNode = useCallback(
    (path: string) => { fetchChildren(path); },
    [fetchChildren]
  );

  const isLoadingPath = useCallback(
    (path: string) => loadingPaths.has(path),
    [loadingPaths]
  );

  const getError = useCallback(
    (path: string) => errorMap.get(path) ?? null,
    [errorMap]
  );

  return { getDualChildren, expandNode, isLoadingPath, getError };
}
