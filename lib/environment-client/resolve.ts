import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import type { EnvironmentEntry } from "@/lib/content-transfer";
import { createLocalDockerEnvironmentClient } from "./local-docker-client";
import { createMarketplaceEnvironmentClient } from "./marketplace-client";
import type { EnvironmentClient } from "./types";

/** Single dispatch point: builds the right EnvironmentClient implementation
 *  for whichever kind of environment entry this is. */
export function resolveEnvironmentClient(
  entry: EnvironmentEntry,
  sdkClient: ClientSDK,
): EnvironmentClient {
  return entry.kind === "marketplace"
    ? createMarketplaceEnvironmentClient(sdkClient, entry.context.preview)
    : createLocalDockerEnvironmentClient(entry);
}
