"use client";

import { useAppContext } from "@/components/providers/marketplace";
import type {
  EnvironmentEntry,
  ResourceAccessEntry,
} from "@/lib/content-transfer";
import { LOCAL_DOCKER_ENABLED } from "@/lib/feature-flags";
import { useMemo } from "react";
import { useLocalDockerEnvironments } from "./use-local-docker-environments";

/** Returns every environment this app can talk to — both real SitecoreAI
 *  environments granted via the Marketplace (resourceAccess) and any locally
 *  registered Docker instances. */
export function useEnvironments(): EnvironmentEntry[] {
  const appContext = useAppContext();
  const { environments: dockerEnvironments } = useLocalDockerEnvironments();

  return useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any[] = appContext?.resourceAccess?.length
      ? appContext.resourceAccess
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : (appContext as any)?.resources ?? [];
    const marketplaceEnvironments: EnvironmentEntry[] = (
      raw as ResourceAccessEntry[]
    ).map((e) => ({ ...e, kind: "marketplace" as const }));
    // Previously saved Docker entries stay in localStorage but are hidden
    // while the feature is disabled.
    if (!LOCAL_DOCKER_ENABLED) return marketplaceEnvironments;
    return [...marketplaceEnvironments, ...dockerEnvironments];
  }, [appContext, dockerEnvironments]);
}
