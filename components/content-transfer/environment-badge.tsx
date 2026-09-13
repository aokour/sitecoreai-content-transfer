"use client";

import { Badge } from "@/components/ui/badge";
import { getEnvironmentLabel, type EnvironmentEntry } from "@/lib/content-transfer";

/** Small identity badge next to an environment's name — the marketplace
 *  tenant id prefix for real environments, or a "Local Docker" tag. */
export function EnvironmentBadge({ env }: { env: EnvironmentEntry }) {
  if (env.kind === "local-docker") {
    return (
      <Badge colorScheme="warning" size="sm">
        Local Docker
      </Badge>
    );
  }
  return (
    <Badge colorScheme="neutral" size="sm">
      {env.tenantId.slice(0, 6)}
    </Badge>
  );
}

/**
 * Label + badge for one environment inside a <Select> option. When
 * `disabledAsDestination` is set, an inline caption explains why it's
 * unselectable here — deliberately not a hover tooltip: disabled form
 * controls commonly suppress the pointer/focus events tooltips rely on, so a
 * hover-only explanation could end up reaching nobody. This stays visible
 * regardless.
 */
export function EnvironmentOptionLabel({
  env,
  disabledAsDestination = false,
}: {
  env: EnvironmentEntry;
  disabledAsDestination?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span>{getEnvironmentLabel(env)}</span>
      <EnvironmentBadge env={env} />
      {disabledAsDestination && (
        <span className="text-xs text-muted-foreground italic">
          destination coming soon
        </span>
      )}
    </div>
  );
}
