"use client";

import { useMarketplaceClient } from "@/components/providers/marketplace";
import type { ChunkSetMetadata, ContentTransferStatus } from "@/lib/content-transfer";
import { useCallback, useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 3000;

interface UseTransferStatusResult {
  state: string | null;
  chunkSetsMetadata: ChunkSetMetadata[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Polls getContentTransferStatus every 3s while the transfer is InProgress.
 * Stops automatically when state is Completed or Failed.
 */
export function useTransferStatus(
  transferId: string | null,
  sourceContextId: string | null
): UseTransferStatusResult {
  const client = useMarketplaceClient();
  const [state, setState] = useState<string | null>(null);
  const [chunkSetsMetadata, setChunkSetsMetadata] = useState<ChunkSetMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  const fetchStatus = useCallback(async () => {
    if (!transferId || !sourceContextId) return;
    setIsLoading(true);
    try {
      const res = await client.query(
        "xmc.contentTransfer.getContentTransferStatus",
        {
          params: {
            path: { transferId },
            query: { sitecoreContextId: sourceContextId },
          },
        }
      );
      if (!isMountedRef.current) return;
      // client.query() returns QueryResult<K>; actual payload is at .data.data
      const data = (res?.data as unknown as { data?: ContentTransferStatus })?.data;
      if (data) {
        setState(data.State ?? null);
        setChunkSetsMetadata(data.ChunkSetsMetadata ?? []);
        // Stop polling when terminal state reached
        if (data.State === "Completed" || data.State === "Failed") {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to fetch status");
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [client, transferId, sourceContextId]);

  useEffect(() => {
    isMountedRef.current = true;
    if (!transferId || !sourceContextId) return;
    // Fetch immediately
    fetchStatus();
    // Then poll
    intervalRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [transferId, sourceContextId, fetchStatus]);

  return { state, chunkSetsMetadata, isLoading, error, refresh: fetchStatus };
}
