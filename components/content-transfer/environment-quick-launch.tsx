"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DockerConnectionStatus } from "@/hooks/use-docker-connection-status";
import { useDockerConnectionStatus } from "@/hooks/use-docker-connection-status";
import { useEnvironments } from "@/hooks/use-environments";
import {
  canBeDestination,
  getEnvironmentId,
  getEnvironmentLabel,
  type EnvironmentEntry,
} from "@/lib/content-transfer";
import { LOCAL_DOCKER_ENABLED } from "@/lib/feature-flags";
import {
  ArrowRight,
  CheckCircle2,
  Layers,
  Loader2,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AddLocalEnvironmentButton } from "./add-local-environment-button";
import { DockerIcon } from "./docker-icon";

interface EnvironmentCardGridProps {
  environments: EnvironmentEntry[];
  sourceId: string | null;
  destinationId: string | null;
  onSelect: (id: string) => void;
  /** Per-environment reachability status — only meaningful for Docker
   *  entries; omitted for the marketplace grid. */
  connectionStatuses?: Record<string, DockerConnectionStatus>;
}

function ConnectionStatusDot({ status }: { status: DockerConnectionStatus }) {
  if (status.state === "checking") {
    return (
      <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
    );
  }
  if (status.state === "ok") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <CheckCircle2 className="size-3 shrink-0 text-success-fg" />
        </TooltipTrigger>
        <TooltipContent>Connected</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <XCircle className="size-3 shrink-0 text-danger-fg" />
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{status.message}</TooltipContent>
    </Tooltip>
  );
}

function EnvironmentCardGrid({
  environments,
  sourceId,
  destinationId,
  onSelect,
  connectionStatuses,
}: EnvironmentCardGridProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {environments.map((env) => {
        const id = getEnvironmentId(env);
        const isSource = id === sourceId;
        const isDestination = id === destinationId;
        const selected = isSource || isDestination;
        // The next click on an unselected card assigns it to whichever role
        // is still open — source first, destination once source is set.
        const wouldBecomeDestination = !selected && !!sourceId;
        const disabled = wouldBecomeDestination && !canBeDestination(env);
        const status = connectionStatuses?.[id];
        const hint = isSource
          ? "Click to clear as source"
          : isDestination
            ? "Click to clear as destination"
            : disabled
              ? "Local Docker environments can only be used as a source right now"
              : wouldBecomeDestination
                ? "Select this as destination"
                : "Select this as source";

        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <Card
                role="button"
                tabIndex={disabled ? -1 : 0}
                aria-disabled={disabled}
                onClick={disabled ? undefined : () => onSelect(id)}
                onKeyDown={
                  disabled
                    ? undefined
                    : (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelect(id);
                        }
                      }
                }
                className={`transition-colors ${
                  disabled
                    ? "cursor-not-allowed opacity-60"
                    : "cursor-pointer " +
                      (isSource
                        ? "border-primary ring-1 ring-primary"
                        : isDestination
                          ? "border-success-fg ring-1 ring-success-fg"
                          : "hover:border-primary/50")
                }`}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    {env.kind === "local-docker" ? (
                      <DockerIcon className="size-4 shrink-0" />
                    ) : (
                      <Layers className="size-4 shrink-0" />
                    )}
                    <p className="text-sm font-medium text-foreground truncate">
                      {getEnvironmentLabel(env)}
                    </p>
                    {status && <ConnectionStatusDot status={status} />}
                  </div>
                  <Badge
                    colorScheme={
                      isSource
                        ? "primary"
                        : isDestination
                          ? "success"
                          : "neutral"
                    }
                    size="sm"
                  >
                    {isSource
                      ? "Source"
                      : isDestination
                        ? "Destination"
                        : disabled
                          ? "Source only"
                          : selected
                            ? ""
                            : "Select"}
                  </Badge>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent className="max-w-56">{hint}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function EnvironmentQuickLaunch() {
  const environments = useEnvironments();
  const router = useRouter();
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState<string | null>(null);

  const marketplaceEnvs = environments.filter((e) => e.kind === "marketplace");
  const dockerEnvs = environments.filter((e) => e.kind === "local-docker");
  const connectionStatuses = useDockerConnectionStatus(dockerEnvs);

  if (environments.length === 0) {
    return (
      <div className="space-y-3">
        <Alert variant="warning">
          <AlertDescription>
            No environments found in application context. Ensure this app has
            been granted access to SitecoreAI environments when you installed it
            {LOCAL_DOCKER_ENABLED &&
              ", or add a local Docker environment below"}
            .
          </AlertDescription>
        </Alert>
        <AddLocalEnvironmentButton />
      </div>
    );
  }

  function selectCard(id: string) {
    if (id === sourceId) {
      setSourceId(null);
    } else if (id === destinationId) {
      setDestinationId(null);
    } else if (!sourceId) {
      setSourceId(id);
    } else {
      setDestinationId(id);
    }
  }

  const source = environments.find((e) => getEnvironmentId(e) === sourceId);
  const destination = environments.find(
    (e) => getEnvironmentId(e) === destinationId,
  );

  return (
    <div className="space-y-4">
      <EnvironmentCardGrid
        environments={marketplaceEnvs}
        sourceId={sourceId}
        destinationId={destinationId}
        onSelect={selectCard}
      />

      {dockerEnvs.length > 0 && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <DockerIcon className="size-3.5 shrink-0" />
            Local Docker
          </p>
          <EnvironmentCardGrid
            environments={dockerEnvs}
            sourceId={sourceId}
            destinationId={destinationId}
            onSelect={selectCard}
            connectionStatuses={connectionStatuses}
          />
        </div>
      )}

      {source && destination && (
        <div className="flex items-center justify-between rounded-lg border bg-subtle-bg p-4">
          <div className="flex items-center gap-3 text-sm font-medium">
            <span>{getEnvironmentLabel(source)}</span>
            <ArrowRight className="size-4 text-muted-foreground" />
            <span>{getEnvironmentLabel(destination)}</span>
          </div>
          <Button
            size="sm"
            onClick={() =>
              router.push(
                `/transfer/new?source=${encodeURIComponent(sourceId!)}&destination=${encodeURIComponent(destinationId!)}`,
              )
            }
          >
            Start Transfer
            <ArrowRight className="size-4 ml-2" />
          </Button>
        </div>
      )}

      <AddLocalEnvironmentButton />
    </div>
  );
}
