"use client";

import type { LocalDockerEnvironmentEntry } from "@/lib/content-transfer";
import * as storage from "@/lib/environment-client/local-docker-storage";
import { useCallback, useEffect, useState } from "react";

/**
 * React wrapper over the localStorage-backed local Docker environment
 * registry. Every call site (Dashboard, each wizard, the settings dialog)
 * holds its own independent state, so this re-syncs on both the native
 * "storage" event (fires in *other* tabs only) and a custom in-tab event
 * local-docker-storage.ts dispatches on every write (the native event never
 * fires in the same document that made the change).
 */
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
    window.addEventListener(
      storage.LOCAL_DOCKER_ENVIRONMENTS_CHANGED_EVENT,
      refresh,
    );
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        storage.LOCAL_DOCKER_ENVIRONMENTS_CHANGED_EVENT,
        refresh,
      );
    };
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
