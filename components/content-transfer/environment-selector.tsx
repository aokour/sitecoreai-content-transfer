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
import { getEnvironmentLabel, type ResourceAccessEntry } from "@/lib/content-transfer";
import { ArrowRight, X } from "lucide-react";

interface EnvironmentSelectorProps {
  environments: ResourceAccessEntry[];
  sourceId: string | null;
  destinationId: string | null;
  onSourceChange: (id: string | null) => void;
  onDestinationChange: (id: string | null) => void;
  disabled?: boolean;
}

export function EnvironmentSelector({
  environments,
  sourceId,
  destinationId,
  onSourceChange,
  onDestinationChange,
  disabled = false,
}: EnvironmentSelectorProps) {
  const sourceEnv = environments.find(
    (e) => e.context.preview === sourceId
  );
  const destEnv = environments.find(
    (e) => e.context.preview === destinationId
  );

  return (
    <Card>
      <CardContent className="pt-6">
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
                  {environments.map((env) => (
                    <SelectItem
                      key={env.context.preview}
                      value={env.context.preview}
                      disabled={env.context.preview === destinationId}
                    >
                      <div className="flex items-center gap-2">
                        <span>{getEnvironmentLabel(env)}</span>
                        <Badge colorScheme="neutral" size="sm">
                          {env.tenantId.slice(0, 6)}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {sourceId && !disabled && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onSourceChange(null); }}
                  className="absolute inset-y-0 right-8 flex items-center px-1 text-muted-foreground hover:text-foreground"
                  aria-label="Clear source environment"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate min-h-[1rem]">
              {sourceEnv ? `Context: ${sourceEnv.context.preview}` : ""}
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
                  {environments.map((env) => (
                    <SelectItem
                      key={env.context.preview}
                      value={env.context.preview}
                      disabled={env.context.preview === sourceId}
                    >
                      <div className="flex items-center gap-2">
                        <span>{getEnvironmentLabel(env)}</span>
                        <Badge colorScheme="neutral" size="sm">
                          {env.tenantId.slice(0, 6)}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {destinationId && !disabled && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDestinationChange(null); }}
                  className="absolute inset-y-0 right-8 flex items-center px-1 text-muted-foreground hover:text-foreground"
                  aria-label="Clear destination environment"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate min-h-[1rem]">
              {destEnv ? `Context: ${destEnv.context.preview}` : ""}
            </p>
          </div>
        </div>

        {environments.length === 0 && (
          <p className="text-sm text-muted-foreground mt-3">
            No environments available. Ensure the app is granted access to XM Cloud tenants.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
