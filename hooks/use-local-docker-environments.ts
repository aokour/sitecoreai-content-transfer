"use client";

import type { LocalDockerEnvironmentEntry } from "@/lib/content-transfer";
import * as storage from "@/lib/environment-client/local-docker-storage";
import { useCallback, useEffect, useState } from "react";

/** React wrapper over the localStorage-backed local Docker environment
 *  registry, re-syncing when another tab changes it. */
export function useLocalDockerEnvironments() {
  const [environments, setEnvironments] = useState<
    LocalDockerEnvironmentEntry[]
  >(() => storage.list());

  const refresh = useCallback(() => {
    setEnvironments(storage.list());
  }, []);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === null || e.key === storage.STORAGE_KEY) refresh();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  const addEnvironment = useCallback(
    (entry: Omit<LocalDockerEnvironmentEntry, "kind" | "id">) => {
      const created = storage.add(entry);
      refresh();
      return created;
    },
    [refresh],
  );

  const updateEnvironment = useCallback(
    (
      id: string,
      patch: Partial<Omit<LocalDockerEnvironmentEntry, "kind" | "id">>,
    ) => {
      storage.update(id, patch);
      refresh();
    },
    [refresh],
  );

  const removeEnvironment = useCallback(
    (id: string) => {
      storage.remove(id);
      refresh();
    },
    [refresh],
  );

  return { environments, addEnvironment, updateEnvironment, removeEnvironment };
}
