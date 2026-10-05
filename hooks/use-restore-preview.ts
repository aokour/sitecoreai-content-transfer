"use client";

import { useMarketplaceClient } from "@/components/providers/marketplace";
import { findEnvironmentById, type DataTreeItem } from "@/lib/content-transfer";
import { resolveEnvironmentClient } from "@/lib/environment-client/resolve";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEnvironments } from "./use-environments";

// The archive payload is opaque — content chunks are encrypted and no endpoint
// enumerates a package's contents. So the preview is built entirely from what
// the manifest declares plus one live query per root path against the
// destination. It reports the state of each target path, never the archive's.

export interface PreviewChild {
  itemId: string;
  name: string;
  path: string;
  templateName?: string;
  updated?: string;
  hasChildren: boolean;
}

export interface PathPreview {
  path: string;
  status: "loading" | "found" | "missing" | "error";
  error?: string;
  /** Metadata of the destination item at this exact path. */
  name?: string;
  templateName?: string;
  updated?: string;
  updatedBy?: string;
  /** Direct children in the destination, capped by the page size below. */
  children: PreviewChild[];
  childrenTruncated: boolean;
}

const CHILD_PAGE_SIZE = 100;

// One query answers both halves: the item itself and its direct children.
const GET_PATH_PREVIEW = /* GraphQL */ `
  query GetRestorePathPreview(
    $path: String!
    $systemLocale: String!
    $first: PaginationAmount!
  ) {
    item(where: { database: "master", path: $path, language: $systemLocale }) {
      itemId
      name
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
      children(first: $first) {
        pageInfo {
          hasNextPage
        }
        nodes {
          itemId
          name
          path
          hasChildren
          template {
            name
          }
          updated: field(name: "__Updated") {
            value
          }
        }
      }
    }
  }
`;

interface PreviewItemData {
  item?: {
    itemId: string;
    name: string;
    path: string;
    template?: { name: string } | null;
    updated?: { value: string } | null;
    updatedBy?: { value: string } | null;
    children?: {
      pageInfo?: { hasNextPage: boolean };
      nodes: (
        | {
            itemId: string;
            name: string;
            path: string;
            hasChildren: boolean;
            template?: { name: string } | null;
            updated?: { value: string } | null;
          }
        | null
      )[];
    } | null;
  } | null;
}

function errorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const rec = err as Record<string, unknown>;
    if (typeof rec.message === "string") return rec.message;
    if (typeof rec.Message === "string") return rec.Message;
  }
  return "Could not read the destination.";
}

/**
 * Loads destination state for each root path an archive declares.
 * Re-runs whenever the destination changes.
 */
export function useRestorePreview(
  dataTrees: DataTreeItem[],
  destinationContextId: string | null,
) {
  const sdkClient = useMarketplaceClient();
  const environments = useEnvironments();
  const [previews, setPreviews] = useState<Record<string, PathPreview>>({});
  const [isLoading, setIsLoading] = useState(false);
  // Guards against a slow response for a previously-selected destination
  // overwriting results for the current one.
  const runIdRef = useRef(0);

  const paths = dataTrees.map((dt) => dt.itemPath);
  const pathKey = paths.join("|");

  const load = useCallback(async () => {
    if (!destinationContextId || paths.length === 0) {
      setPreviews({});
      return;
    }
    const destinationEnv = findEnvironmentById(
      environments,
      destinationContextId,
    );
    if (!destinationEnv) {
      setPreviews({});
      return;
    }
    const envClient = resolveEnvironmentClient(destinationEnv, sdkClient);
    const runId = ++runIdRef.current;
    setIsLoading(true);
    setPreviews(
      Object.fromEntries(
        paths.map((p) => [
          p,
          { path: p, status: "loading", children: [], childrenTruncated: false },
        ]),
      ),
    );

    const results = await Promise.all(
      paths.map(async (path): Promise<PathPreview> => {
        try {
          const envelope = await envClient.graphql<PreviewItemData>(
            GET_PATH_PREVIEW,
            { path, systemLocale: "en", first: CHILD_PAGE_SIZE },
          );
          const item = envelope.data?.item;
          if (!item) {
            // A null item with no errors means the path simply is not there,
            // which is a perfectly normal "will be created" outcome.
            if (envelope.errors?.length) {
              return {
                path,
                status: "error",
                error: errorMessage(envelope.errors[0]?.message),
                children: [],
                childrenTruncated: false,
              };
            }
            return {
              path,
              status: "missing",
              children: [],
              childrenTruncated: false,
            };
          }
          const nodes = (item.children?.nodes ?? []).filter(
            (n): n is NonNullable<typeof n> => n !== null,
          );
          return {
            path,
            status: "found",
            name: item.name,
            templateName: item.template?.name,
            updated: item.updated?.value || undefined,
            updatedBy: item.updatedBy?.value || undefined,
            children: nodes.map((n) => ({
              itemId: n.itemId,
              name: n.name,
              path: n.path,
              templateName: n.template?.name,
              updated: n.updated?.value || undefined,
              hasChildren: n.hasChildren,
            })),
            childrenTruncated: item.children?.pageInfo?.hasNextPage ?? false,
          };
        } catch (err) {
          return {
            path,
            status: "error",
            error: errorMessage(err),
            children: [],
            childrenTruncated: false,
          };
        }
      }),
    );

    if (runId !== runIdRef.current) return;
    setPreviews(Object.fromEntries(results.map((r) => [r.path, r])));
    setIsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkClient, environments, destinationContextId, pathKey]);

  useEffect(() => {
    load();
  }, [load]);

  return { previews, isLoading, refetch: load };
}
