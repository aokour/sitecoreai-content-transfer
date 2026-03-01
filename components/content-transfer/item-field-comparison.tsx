"use client";

import React, { useCallback, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FieldComparison } from "@/hooks/use-item-fields";
import { useItemFields } from "@/hooks/use-item-fields";
import { cn } from "@/lib/utils";
import { AlertTriangle, ChevronDown, ChevronUp, CloudOff } from "lucide-react";

// ── Value renderer ─────────────────────────────────────────────────────────

const VALUE_TRUNCATE = 160;

function FieldValue({ value }: { value: string }) {
  if (value === "") {
    return <span className="italic text-muted-foreground/50">(empty)</span>;
  }
  const truncated = value.length > VALUE_TRUNCATE;
  const display = truncated ? `${value.slice(0, VALUE_TRUNCATE)}…` : value;
  if (!truncated) return <>{display}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help">{display}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-sm break-all text-xs font-mono">
        {value}
      </TooltipContent>
    </Tooltip>
  );
}

// ── Single field row ───────────────────────────────────────────────────────

interface FieldRowProps {
  field: FieldComparison;
  isActive?: boolean;
  rowRef?: (el: HTMLTableRowElement | null) => void;
}

function FieldRow({ field, isActive, rowRef }: FieldRowProps) {
  const bothMissing = field.sourceValue === null && field.destValue === null;
  if (bothMissing) return null;

  return (
    <tr
      ref={rowRef}
      className={cn(
        "border-b last:border-0 align-top transition-colors",
        field.isDifferent && "bg-amber-50/60 dark:bg-amber-900/10",
        isActive && "outline outline-2 outline-offset-[-2px] outline-amber-400 dark:outline-amber-500"
      )}
    >
      {/* Field name */}
      <td className="px-3 py-2 w-[200px] shrink-0">
        <div className="flex items-center gap-1.5">
          {field.isDifferent && (
            <span
              className={cn(
                "shrink-0 size-1.5 rounded-full",
                isActive
                  ? "bg-amber-500 dark:bg-amber-400 shadow-[0_0_4px_1px] shadow-amber-400"
                  : "bg-amber-400 dark:bg-amber-500"
              )}
              aria-label="Values differ"
            />
          )}
          <span
            className={cn(
              "font-medium break-all",
              field.isStandard
                ? "text-muted-foreground/70 text-[11px]"
                : "text-foreground text-xs"
            )}
          >
            {field.name}
          </span>
        </div>
        {field.fieldType && (
          <span className="text-[10px] text-muted-foreground/50 block mt-0.5 pl-3.5">
            {field.fieldType}
          </span>
        )}
      </td>

      {/* Source value */}
      <td
        className={cn(
          "px-3 py-2 border-l font-mono text-[11px] break-all align-top",
          field.sourceValue === null
            ? "text-muted-foreground/30"
            : field.isDifferent
            ? "text-amber-700 dark:text-amber-300"
            : "text-foreground"
        )}
      >
        {field.sourceValue === null ? (
          <span className="flex items-center gap-1 not-italic font-sans text-xs text-muted-foreground/40">
            <CloudOff className="size-3" />
            not in source
          </span>
        ) : (
          <FieldValue value={field.sourceValue} />
        )}
      </td>

      {/* Destination value */}
      <td
        className={cn(
          "px-3 py-2 border-l font-mono text-[11px] break-all align-top",
          field.destValue === null
            ? "text-muted-foreground/30"
            : field.isDifferent
            ? "text-amber-700 dark:text-amber-300"
            : "text-foreground"
        )}
      >
        {field.destValue === null ? (
          <span className="flex items-center gap-1 not-italic font-sans text-xs text-muted-foreground/40">
            <CloudOff className="size-3" />
            not in destination
          </span>
        ) : (
          <FieldValue value={field.destValue} />
        )}
      </td>
    </tr>
  );
}

// ── Main comparison panel ──────────────────────────────────────────────────

interface ItemFieldComparisonProps {
  path: string;
  sourceContextId: string;
  destinationContextId: string | null;
  itemExistsInDestination: boolean;
}

export function ItemFieldComparison({
  path,
  sourceContextId,
  destinationContextId,
  itemExistsInDestination,
}: ItemFieldComparisonProps) {
  const [showStandard, setShowStandard] = useState(false);
  const [activeDiffIndex, setActiveDiffIndex] = useState<number | null>(null);

  // Ref map: field name → <tr> element
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  const { fields, isLoading, error } = useItemFields(
    path,
    sourceContextId,
    destinationContextId
  );

  // Reset navigation when fields change (new item selected)
  const prevPath = useRef(path);
  if (prevPath.current !== path) {
    prevPath.current = path;
    rowRefs.current.clear();
    // activeDiffIndex will be reset via the key on the outer div
  }

  // Filter standard fields based on toggle
  const visibleFields = showStandard
    ? fields
    : fields.filter((f) => !f.isStandard);

  // Group by section, preserving sort order
  const sections = [...new Set(visibleFields.map((f) => f.section))];

  // Build the ordered list of diff field names as they appear in the table
  // (section order × diffs-first within each section)
  const orderedDiffNames: string[] = sections.flatMap((section) =>
    visibleFields
      .filter((f) => f.section === section && f.isDifferent)
      .map((f) => f.name)
  );

  const totalDiffs = orderedDiffNames.length;
  const allDiffCount = fields.filter((f) => f.isDifferent && !f.isStandard).length;
  const stdDiffCount = fields.filter((f) => f.isDifferent && f.isStandard).length;

  const scrollToDiff = useCallback(
    (index: number) => {
      if (orderedDiffNames.length === 0) return;
      const clamped = (index + orderedDiffNames.length) % orderedDiffNames.length;
      setActiveDiffIndex(clamped);
      const el = rowRefs.current.get(orderedDiffNames[clamped]);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [orderedDiffNames]
  );

  function handlePrev() {
    scrollToDiff((activeDiffIndex ?? 0) - 1);
  }

  function handleNext() {
    scrollToDiff((activeDiffIndex ?? -1) + 1);
  }

  return (
    <div className="flex flex-col min-h-0" key={path}>
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/20 shrink-0 gap-4">
        {/* Left: title + badges */}
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
            Field Comparison
          </span>
          <code className="text-xs font-mono text-muted-foreground truncate">
            {path}
          </code>
          {allDiffCount > 0 && (
            <span className="flex items-center gap-1 shrink-0 text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium">
              <AlertTriangle className="size-3" />
              {allDiffCount} diff{allDiffCount !== 1 ? "s" : ""}
            </span>
          )}
          {stdDiffCount > 0 && showStandard && (
            <span className="shrink-0 text-xs text-muted-foreground">
              +{stdDiffCount} in standard
            </span>
          )}
          {!itemExistsInDestination && (
            <span className="flex items-center gap-1 shrink-0 text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full italic">
              <CloudOff className="size-3" />
              not in destination
            </span>
          )}
        </div>

        {/* Right: prev/next nav + standard toggle */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Diff navigation */}
          {totalDiffs > 0 && (
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={handlePrev}
                disabled={totalDiffs === 0}
                aria-label="Previous diff"
              >
                <ChevronUp className="size-3.5" />
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground min-w-[3.5rem] text-center">
                {activeDiffIndex === null
                  ? `${totalDiffs} diff${totalDiffs !== 1 ? "s" : ""}`
                  : `${activeDiffIndex + 1} / ${totalDiffs}`}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={handleNext}
                disabled={totalDiffs === 0}
                aria-label="Next diff"
              >
                <ChevronDown className="size-3.5" />
              </Button>
            </div>
          )}

          {/* Standard fields toggle */}
          <div className="flex items-center gap-2">
            <Switch
              id="show-standard-fields"
              checked={showStandard}
              onCheckedChange={(v) => {
                setShowStandard(v);
                setActiveDiffIndex(null);
              }}
            />
            <Label
              htmlFor="show-standard-fields"
              className="text-xs text-muted-foreground cursor-pointer select-none"
            >
              Standard fields
            </Label>
          </div>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground text-sm">
          <Spinner className="size-4" />
          <span>Loading fields...</span>
        </div>
      ) : error ? (
        <div className="py-5 text-center text-xs text-danger-fg">
          Failed to load fields: {error}
        </div>
      ) : visibleFields.length === 0 ? (
        <div className="py-5 text-center text-xs text-muted-foreground">
          No fields to display
        </div>
      ) : (
        <div className="overflow-y-auto">
          <table className="w-full text-xs border-collapse">
            {/* Sticky column headers */}
            <thead className="sticky top-0 z-10 bg-muted/50 backdrop-blur-sm">
              <tr className="border-b">
                <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-[200px] border-r">
                  Field
                </th>
                <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-1/2 border-r">
                  Source
                </th>
                <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-1/2">
                  Destination
                </th>
              </tr>
            </thead>
            <tbody>
              {sections.map((section) => {
                const all = visibleFields.filter((f) => f.section === section);
                // Diff fields first, then the rest — preserving alphabetical within each group
                const sectionFields = [
                  ...all.filter((f) => f.isDifferent),
                  ...all.filter((f) => !f.isDifferent),
                ];
                const sectionDiffCount = all.filter((f) => f.isDifferent).length;

                return (
                  <React.Fragment key={section}>
                    {/* Section header row */}
                    <tr>
                      <td
                        colSpan={3}
                        className="px-3 py-1.5 bg-muted/30 border-y text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                      >
                        <span className="flex items-center gap-2">
                          {section}
                          {sectionDiffCount > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400 font-semibold normal-case tracking-normal">
                              <AlertTriangle className="size-2.5" />
                              {sectionDiffCount} diff{sectionDiffCount !== 1 ? "s" : ""}
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>
                    {sectionFields.map((field) => (
                        <FieldRow
                          key={field.name}
                          field={field}
                          isActive={
                            field.isDifferent &&
                            activeDiffIndex !== null &&
                            orderedDiffNames[activeDiffIndex] === field.name
                          }
                          rowRef={
                            field.isDifferent
                              ? (el) => {
                                  if (el) rowRefs.current.set(field.name, el);
                                  else rowRefs.current.delete(field.name);
                                }
                              : undefined
                          }
                        />
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
