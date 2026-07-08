"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useEnvironments } from "@/hooks/use-environments";
import { getEnvironmentLabel } from "@/lib/content-transfer";
import { ArrowRight, Layers } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function EnvironmentQuickLaunch() {
  const environments = useEnvironments();
  const router = useRouter();
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState<string | null>(null);

  if (environments.length === 0) {
    return (
      <Alert variant="warning">
        <AlertDescription>
          No environments found in application context. Ensure this app has
          been granted access to XM Cloud tenants in the Sitecore Cloud
          Portal.
        </AlertDescription>
      </Alert>
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

  const source = environments.find((e) => e.context.preview === sourceId);
  const destination = environments.find(
    (e) => e.context.preview === destinationId
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {environments.map((env) => {
          const id = env.context.preview;
          const isSource = id === sourceId;
          const isDestination = id === destinationId;
          const selected = isSource || isDestination;

          return (
            <Card
              key={id}
              role="button"
              tabIndex={0}
              onClick={() => selectCard(id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectCard(id);
                }
              }}
              className={`cursor-pointer transition-colors ${
                isSource
                  ? "border-primary ring-1 ring-primary"
                  : isDestination
                    ? "border-success-fg ring-1 ring-success-fg"
                    : "hover:border-primary/50"
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
                  {isSource ? "Source" : isDestination ? "Destination" : selected ? "" : "Select"}
                </Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>

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
                `/transfer/new?source=${encodeURIComponent(sourceId!)}&destination=${encodeURIComponent(destinationId!)}`
              )
            }
          >
            Start Transfer
            <ArrowRight className="size-4 ml-2" />
          </Button>
        </div>
      )}
    </div>
  );
}
