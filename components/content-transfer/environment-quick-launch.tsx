"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useEnvironments } from "@/hooks/use-environments";
import {
  canBeDestination,
  getEnvironmentId,
  getEnvironmentLabel,
  type EnvironmentEntry,
} from "@/lib/content-transfer";
import { ArrowRight, Layers } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AddLocalEnvironmentButton } from "./add-local-environment-button";

interface EnvironmentCardGridProps {
  environments: EnvironmentEntry[];
  sourceId: string | null;
  destinationId: string | null;
  onSelect: (id: string) => void;
}

function EnvironmentCardGrid({
  environments,
  sourceId,
  destinationId,
  onSelect,
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

        return (
          <Card
            key={id}
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
                <Layers className="size-4 shrink-0" />
                <p className="text-sm font-medium text-foreground truncate">
                  {getEnvironmentLabel(env)}
                </p>
              </div>
              <Badge
                colorScheme={
                  isSource ? "primary" : isDestination ? "success" : "neutral"
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

  if (environments.length === 0) {
    return (
      <div className="space-y-3">
        <Alert variant="warning">
          <AlertDescription>
            No environments found in application context. Ensure this app has
            been granted access to SitecoreAI environments when you installed
            it, or add a local Docker environment below.
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
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Local Docker
          </p>
          <EnvironmentCardGrid
            environments={dockerEnvs}
            sourceId={sourceId}
            destinationId={destinationId}
            onSelect={selectCard}
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
