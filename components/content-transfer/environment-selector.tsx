"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getEnvironmentId,
  getEnvironmentLabel,
  type EnvironmentEntry,
} from "@/lib/content-transfer";
import { ArrowRight, X } from "lucide-react";
import { AddLocalEnvironmentButton } from "./add-local-environment-button";

interface EnvironmentSelectorProps {
  environments: EnvironmentEntry[];
  sourceId: string | null;
  destinationId: string | null;
  onSourceChange: (id: string | null) => void;
  onDestinationChange: (id: string | null) => void;
  disabled?: boolean;
}

/** Small identity badge next to an environment's name — the marketplace
 *  tenant id prefix for real environments, or a "Local Docker" tag. */
function EnvironmentBadge({ env }: { env: EnvironmentEntry }) {
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

export function EnvironmentSelector({
  environments,
  sourceId,
  destinationId,
  onSourceChange,
  onDestinationChange,
  disabled = false,
}: EnvironmentSelectorProps) {
  const sourceEnv = environments.find((e) => getEnvironmentId(e) === sourceId);
  const destEnv = environments.find(
    (e) => getEnvironmentId(e) === destinationId,
  );

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          {/* Source */}
          <div className="flex-1 space-y-2 w-full">
            <Label htmlFor="source-env" className="text-sm font-medium">
              Source Environment
            </Label>
            <div className="relative">
              <Select
                value={sourceId ?? ""}
                onValueChange={onSourceChange}
                disabled={disabled || environments.length === 0}
              >
                <SelectTrigger id="source-env" className="w-full">
                  <SelectValue placeholder="Select source environment..." />
                </SelectTrigger>
                <SelectContent>
                  {environments.map((env) => {
                    const id = getEnvironmentId(env);
                    return (
                      <SelectItem
                        key={id}
                        value={id}
                        disabled={id === destinationId}
                      >
                        <div className="flex items-center gap-2">
                          <span>{getEnvironmentLabel(env)}</span>
                          <EnvironmentBadge env={env} />
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {sourceId && !disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSourceChange(null);
                  }}
                  className="absolute inset-y-0 right-8 flex items-center px-1 text-muted-foreground hover:text-foreground"
                  aria-label="Clear source environment"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate min-h-[1rem]">
              {sourceEnv
                ? sourceEnv.kind === "marketplace"
                  ? `Context: ${sourceEnv.context.preview}`
                  : sourceEnv.baseUrl
                : ""}
            </p>
          </div>

          {/* Arrow */}
          <div className="flex items-center justify-center shrink-0 mt-2 sm:mt-6">
            <div className="flex items-center justify-center size-8 rounded-full bg-muted">
              <ArrowRight className="size-4 text-muted-foreground" />
            </div>
          </div>

          {/* Destination */}
          <div className="flex-1 space-y-2 w-full">
            <Label htmlFor="dest-env" className="text-sm font-medium">
              Destination Environment
            </Label>
            <div className="relative">
              <Select
                value={destinationId ?? ""}
                onValueChange={onDestinationChange}
                disabled={disabled || environments.length === 0}
              >
                <SelectTrigger id="dest-env" className="w-full">
                  <SelectValue placeholder="Select destination environment..." />
                </SelectTrigger>
                <SelectContent>
                  {environments.map((env) => {
                    const id = getEnvironmentId(env);
                    return (
                      <SelectItem
                        key={id}
                        value={id}
                        disabled={id === sourceId}
                      >
                        <div className="flex items-center gap-2">
                          <span>{getEnvironmentLabel(env)}</span>
                          <EnvironmentBadge env={env} />
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {destinationId && !disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDestinationChange(null);
                  }}
                  className="absolute inset-y-0 right-8 flex items-center px-1 text-muted-foreground hover:text-foreground"
                  aria-label="Clear destination environment"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate min-h-[1rem]">
              {destEnv
                ? destEnv.kind === "marketplace"
                  ? `Context: ${destEnv.context.preview}`
                  : destEnv.baseUrl
                : ""}
            </p>
          </div>
        </div>

        {environments.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No environments available. Ensure the app is granted access to
            SitecoreAI environments.
          </p>
        )}

        <AddLocalEnvironmentButton />
      </CardContent>
    </Card>
  );
}
