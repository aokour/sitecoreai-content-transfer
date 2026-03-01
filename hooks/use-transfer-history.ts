"use client";

import type { TransferPhase, TransferRecord } from "@/lib/content-transfer";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "sitecore-content-transfers";

function loadFromStorage(): TransferRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TransferRecord[]) : [];
  } catch {
    return [];
  }
}

function saveToStorage(records: TransferRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // ignore storage errors
  }
}

export function useTransferHistory() {
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);

  // Hydrate from localStorage on mount
  useEffect(() => {
    setTransfers(loadFromStorage());
  }, []);

  const addTransfer = useCallback((record: TransferRecord) => {
    setTransfers((prev) => {
      const updated = [record, ...prev];
      saveToStorage(updated);
      return updated;
    });
  }, []);

  const removeTransfer = useCallback((transferId: string) => {
    setTransfers((prev) => {
      const updated = prev.filter((r) => r.transferId !== transferId);
      saveToStorage(updated);
      return updated;
    });
  }, []);

  const updateTransferPhase = useCallback(
    (transferId: string, phase: TransferPhase) => {
      setTransfers((prev) => {
        const updated = prev.map((r) =>
          r.transferId === transferId ? { ...r, phase } : r
        );
        saveToStorage(updated);
        return updated;
      });
    },
    []
  );

  const getTransfer = useCallback(
    (transferId: string): TransferRecord | undefined => {
      return transfers.find((r) => r.transferId === transferId);
    },
    [transfers]
  );

  // Derived stats
  const stats = {
    total: transfers.length,
    active: transfers.filter(
      (t) =>
        t.phase === "creating" ||
        t.phase === "preparing" ||
        t.phase === "transferring" ||
        t.phase === "importing"
    ).length,
    completed: transfers.filter((t) => t.phase === "completed").length,
    failed: transfers.filter((t) => t.phase === "failed").length,
  };

  return {
    transfers,
    addTransfer,
    removeTransfer,
    updateTransferPhase,
    getTransfer,
    stats,
  };
}
