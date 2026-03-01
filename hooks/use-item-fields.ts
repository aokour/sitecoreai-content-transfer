"use client";

import { useMarketplaceClient } from "@/components/providers/marketplace";
import { useCallback, useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

export interface FieldComparison {
  name: string;
  /** true when the field name starts with __ (Sitecore standard fields) */
  isStandard: boolean;
  section: string;
  fieldType: string;
  /** value from the source environment; null when item doesn't exist there */
  sourceValue: string | null;
  /** value from the destination environment; null when item doesn't exist there */
  destValue: string | null;
  /** true when both sides have the item but the values differ */
  isDifferent: boolean;
}

interface RawField {
  name: string;
  value: string;
  templateField?: {
    type?: string | null;
    section?: { name: string } | null;
  } | null;
}

interface GraphQLFieldResponse {
  item?: {
    fields?: { nodes: RawField[] };
  } | null;
}

// ── GraphQL query ──────────────────────────────────────────────────────────
// Fetch ALL fields (excludeStandardFields:false) so we can filter client-side
// without an extra round-trip when the user toggles standard field visibility.

const GET_ITEM_FIELDS = /* GraphQL */ `
  query GetItemFields($path: String!, $language: String!) {
    item(
      where: { database: "master", path: $path, language: $language }
    ) {
      fields(excludeStandardFields: false, first: 500) {
        nodes {
          name
          value
          templateField {
            type
            section {
              name
            }
          }
        }
      }
    }
  }
`;

// ── Hook ───────────────────────────────────────────────────────────────────

export function useItemFields(
  path: string | null,
  sourceContextId: string | null,
  destinationContextId: string | null
) {
  const client = useMarketplaceClient();
  const [fields, setFields] = useState<FieldComparison[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFields = useCallback(async () => {
    if (!path || !sourceContextId) {
      setFields([]);
      return;
    }

    setIsLoading(true);
    setError(null);
    setFields([]);

    try {
      const variables = { path, language: "en" };

      const [srcRes, dstRes] = await Promise.all([
        client.mutate("xmc.authoring.graphql", {
          params: {
            body: { query: GET_ITEM_FIELDS, variables },
            query: { sitecoreContextId: sourceContextId },
          },
        }),
        destinationContextId
          ? client.mutate("xmc.authoring.graphql", {
              params: {
                body: { query: GET_ITEM_FIELDS, variables },
                query: { sitecoreContextId: destinationContextId },
              },
            })
          : Promise.resolve(null),
      ]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const srcData = (srcRes?.data as any)?.data as GraphQLFieldResponse | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dstData = (dstRes?.data as any)?.data as GraphQLFieldResponse | undefined;

      const srcFields: RawField[] = srcData?.item?.fields?.nodes ?? [];
      const dstFields: RawField[] = dstData?.item?.fields?.nodes ?? [];

      // Merge by field name
      const byName = new Map<string, FieldComparison>();

      for (const f of srcFields) {
        byName.set(f.name, {
          name: f.name,
          isStandard: f.name.startsWith("__"),
          section: f.templateField?.section?.name ?? "Other",
          fieldType: f.templateField?.type ?? "",
          sourceValue: f.value,
          destValue: null,
          isDifferent: false,
        });
      }

      for (const f of dstFields) {
        const existing = byName.get(f.name);
        if (existing) {
          existing.destValue = f.value;
          existing.isDifferent = existing.sourceValue !== f.value;
        } else {
          byName.set(f.name, {
            name: f.name,
            isStandard: f.name.startsWith("__"),
            section: f.templateField?.section?.name ?? "Other",
            fieldType: f.templateField?.type ?? "",
            sourceValue: null,
            destValue: f.value,
            isDifferent: false,
          });
        }
      }

      // Sort: content fields first, then by section name, then by field name
      const merged = [...byName.values()].sort((a, b) => {
        if (a.isStandard !== b.isStandard) return a.isStandard ? 1 : -1;
        if (a.section !== b.section) return a.section.localeCompare(b.section);
        return a.name.localeCompare(b.name);
      });

      setFields(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load fields");
    } finally {
      setIsLoading(false);
    }
  }, [path, sourceContextId, destinationContextId, client]);

  // Re-fetch whenever the selected item path changes
  useEffect(() => {
    fetchFields();
  }, [fetchFields]);

  return { fields, isLoading, error, refetch: fetchFields };
}
