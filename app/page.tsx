"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EnvironmentQuickLaunch } from "@/components/content-transfer/environment-quick-launch";
import { ArrowRight, Plus } from "lucide-react";
import Link from "next/link";

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between max-w-7xl">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-md bg-primary flex items-center justify-center">
              <ArrowRight className="size-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-none">
                Content Transfer
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                SitecoreAI Marketplace
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" asChild>
              <Link href="/transfer/new">
                <Plus className="size-4 mr-2" />
                New Transfer
              </Link>
            </Button>
            <Badge colorScheme="primary" size="sm">
              Standalone
            </Badge>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-8 max-w-7xl space-y-6">
        {/* Hero */}
        <div>
          <h2 className="text-xl font-semibold">
            Move content between SitecoreAI environments
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Pick a source and destination below to get started, or start from
            scratch with the New Transfer button.
          </p>
        </div>

        <EnvironmentQuickLaunch />
      </div>
    </div>
  );
}
