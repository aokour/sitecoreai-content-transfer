"use client";

import type { LocalDockerEnvironmentEntry } from "@/lib/content-transfer";
import { checkDockerConnection } from "@/lib/environment-client/docker-health-check";
import { useEffect, useState } from "react";

export type DockerConnectionStatus =
  | { state: "checking" }
  | { state: "ok" }
  | { state: "error"; message: string };

// Module-level cache: the check runs once per browser session (this survives
// client-side navigation between routes, since the module stays loaded, but
// resets on a full page reload) rather than re-firing every time a component
// showing Docker environments mounts. Keyed so that editing an environment's
// URL or token is treated as new and gets rechecked automatically.
const cache = new Map<string, DockerConnectionStatus>();

function cacheKey(env: LocalDockerEnvironmentEntry): string {
  return `${env.id}:${env.baseUrl}:${env.token ?? ""}`;
}

/** Background-checks each Docker environment's reachability/auth, once per
 *  session per (id, baseUrl, token) combination. Informational only — never
 *  blocks selection, just reports a status to render alongside each entry. */
export function useDockerConnectionStatus(
  environments: LocalDockerEnvironmentEntry[],
): Record<string, DockerConnectionStatus> {
  const [statuses, setStatuses] = useState<
    Record<string, DockerConnectionStatus>
  >(() =>
    Object.fromEntries(
      environments.map((e) => [
        e.id,
        cache.get(cacheKey(e)) ?? { state: "checking" },
      ]),
    ),
  );

  const depKey = environments.map((e) => cacheKey(e)).join("|");

  useEffect(() => {
    let cancelled = false;
    for (const env of environments) {
      const key = cacheKey(env);
      if (cache.has(key)) continue;
      checkDockerConnection(env).then((result) => {
        if (cancelled) return;
        const status: DockerConnectionStatus = result.ok
          ? { state: "ok" }
          : { state: "error", message: result.message };
        cache.set(key, status);
        setStatuses((prev) => ({ ...prev, [env.id]: status }));
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);

  return statuses;
}
