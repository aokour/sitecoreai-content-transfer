"use client";

import { ContentTransferMark } from "@/components/app-brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Stepper } from "@/components/ui/stepper";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export interface WizardStep {
  label: string;
  description: string;
  status?: "completed" | "active" | "pending";
}

interface WizardShellProps {
  title: string;
  subtitle: string;
  steps: WizardStep[];
  currentStep: number;
  /** Rendered between the title and the navigation buttons, e.g. a route summary. */
  aside?: ReactNode;
  /** Navigation and any step-specific actions. */
  actions: ReactNode;
  children: ReactNode;
}

/**
 * The sticky-sidebar-and-card layout shared by the backup and restore wizards.
 * Mirrors the transfer wizard's arrangement so the flows feel like one app,
 * without touching that component.
 */
export function WizardShell({
  title,
  subtitle,
  steps,
  currentStep,
  aside,
  actions,
  children,
}: WizardShellProps) {
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="w-64 shrink-0 border-r bg-card flex flex-col px-6 py-6 gap-5 sticky top-0 h-screen overflow-y-auto">
        <Button variant="ghost" size="sm" className="w-fit -ml-2" asChild>
          <Link href="/" prefetch={false}>
            <ArrowLeft className="size-4 mr-2" />
            Dashboard
          </Link>
        </Button>

        <div className="flex items-center gap-2">
          <ContentTransferMark className="size-6 shrink-0 rounded-[1.3px] ring-1 ring-black/10 dark:ring-white/15" />
          <div>
            <h1 className="text-sm font-semibold leading-tight">{title}</h1>
            <p className="text-xs text-muted-foreground mt-1 leading-snug">
              {subtitle}
            </p>
          </div>
        </div>

        <Separator />

        {aside}

        <div className="flex flex-col gap-2">{actions}</div>

        <Separator />

        <Stepper
          steps={steps}
          currentStep={currentStep}
          orientation="vertical"
        />
      </aside>

      <main className="flex-1 overflow-auto p-8">
        <Card>{children}</Card>
      </main>
    </div>
  );
}

/** A single labelled environment in the sidebar, matching the transfer
 *  wizard's route panel but for flows with only one environment. */
export function WizardEnvironmentPanel({
  heading,
  name,
  tone = "primary",
}: {
  heading: string;
  name: string;
  tone?: "primary" | "success";
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {heading}
      </p>
      <div className="rounded-md border bg-muted/30 p-3">
        <div className="flex items-start gap-2">
          <span
            className={`mt-1.5 size-2 rounded-full shrink-0 ${
              tone === "success" ? "bg-success-fg" : "bg-primary"
            }`}
          />
          <p className="text-xs font-medium break-words">{name}</p>
        </div>
      </div>
    </div>
  );
}
