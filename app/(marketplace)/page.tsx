"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EnvironmentQuickLaunch } from "@/components/content-transfer/environment-quick-launch";
import { AppBrand } from "@/components/app-brand";
import {
  ArrowRight,
  Download,
  Layers,
  PackageOpen,
  Plus,
  Upload,
} from "lucide-react";
import Link from "next/link";

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between max-w-7xl">
          <AppBrand />
          <div className="flex items-center gap-3">
            <Button size="sm" asChild>
              <Link href="/transfer/new">
                <Plus className="size-4 mr-2" />
                New Transfer
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-8 max-w-7xl space-y-8">
        {/* Hero */}
        <div>
          <h2 className="text-xl font-semibold">Manage SitecoreAI content</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Transfer content directly between environments, or use a local
            backup package that you can restore later.
          </p>
        </div>

        {/* Primary workflow: a live environment-to-environment transfer */}
        <Card className="border-primary/30 bg-primary/[0.02]">
          <CardHeader className="border-b">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Layers className="size-4" />
                </div>
                <div className="space-y-1">
                  <CardTitle>Transfer between environments</CardTitle>
                  <CardDescription>
                    Choose a source and destination to move content directly
                    between two SitecoreAI environments.
                  </CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <EnvironmentQuickLaunch />
          </CardContent>
        </Card>

        {/* Alternative workflow: portable local packages */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <PackageOpen className="size-4" />
              </div>
              <div className="space-y-1">
                <CardTitle>Backup and restore</CardTitle>
                <CardDescription>
                  Save content to a local package you keep, then restore that
                  package to an environment when needed.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
            <div className="flex flex-col justify-between gap-5 rounded-lg border bg-muted/20 p-5">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Download className="size-4 text-primary" />
                  <h3 className="text-sm font-semibold">Create Backup</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  Package content from one environment into a downloadable
                  archive.
                </p>
              </div>
              <Button size="sm" variant="outline" className="w-fit" asChild>
                <Link href="/backup/new">
                  Start backup
                  <ArrowRight className="size-4 ml-2" />
                </Link>
              </Button>
            </div>

            <div className="flex flex-col justify-between gap-5 rounded-lg border bg-muted/20 p-5">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Upload className="size-4 text-primary" />
                  <h3 className="text-sm font-semibold">Restore Backup</h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  Apply a previously downloaded package to an environment.
                </p>
              </div>
              <Button size="sm" variant="outline" className="w-fit" asChild>
                <Link href="/restore/new">
                  Start restore
                  <ArrowRight className="size-4 ml-2" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
