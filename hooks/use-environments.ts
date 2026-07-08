"use client";

import { useAppContext } from "@/components/providers/marketplace";
import type { ResourceAccessEntry } from "@/lib/content-transfer";
import { useMemo } from "react";

/** Returns the XM Cloud environments this app has been granted access to. */
export function useEnvironments(): ResourceAccessEntry[] {
  const appContext = useAppContext();

  return useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any[] = appContext?.resourceAccess?.length
      ? appContext.resourceAccess
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : (appContext as any)?.resources ?? [];
    return raw as ResourceAccessEntry[];
  }, [appContext]);
}
