"use client";

import { useAppContext } from "@/components/providers/marketplace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { EnvironmentSelector } from "@/components/content-transfer/environment-selector";
import { TransferList } from "@/components/content-transfer/transfer-list";
import { useContentTransfer } from "@/hooks/use-content-transfer";
import { useTransferHistory } from "@/hooks/use-transfer-history";
import type { ResourceAccessEntry } from "@/lib/content-transfer";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  FileX2,
  Layers,
  Plus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export default function Dashboard() {
  const router = useRouter();
  const appContext = useAppContext();
  const { transfers, removeTransfer, stats } = useTransferHistory();
  const { deleteTransfer } = useContentTransfer();

  // Environment selection persisted in component state
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState<string | null>(null);

  const environments = useMemo((): ResourceAccessEntry[] => {
    // The SDK returns data in `resourceAccess` (preferred) or `resources` (legacy).
    // In real responses tenantName may be null — use tenantDisplayName instead.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any[] = appContext?.resourceAccess?.length
      ? appContext.resourceAccess
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : (appContext as any)?.resources ?? [];
    return raw as ResourceAccessEntry[];
  }, [appContext]);

  const canCreateTransfer = !!sourceId && !!destinationId && sourceId !== destinationId;

  async function handleDelete(transferId: string, sourceContextId: string) {
    // Best-effort API deletion + remove from history
    await deleteTransfer(transferId, sourceContextId);
    removeTransfer(transferId);
  }

  function handleNewTransfer() {
    const params = new URLSearchParams();
    if (sourceId) params.set("source", sourceId);
    if (destinationId) params.set("destination", destinationId);
    router.push(`/transfer/new?${params.toString()}`);
  }

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
                Sitecore XM Cloud Marketplace
              </p>
            </div>
          </div>
          <Badge colorScheme="primary" size="sm">
            Standalone
          </Badge>
        </div>
      </div>

      <div className="container mx-auto px-6 py-8 max-w-7xl space-y-8">
        {/* Environment selector */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Environments</h2>
              <p className="text-sm text-muted-foreground">
                Select the source and destination environments for your transfer.
              </p>
            </div>
            <Button
              onClick={handleNewTransfer}
              disabled={!canCreateTransfer}
              size="sm"
            >
              <Plus className="size-4 mr-2" />
              New Transfer
            </Button>
          </div>
          <EnvironmentSelector
            environments={environments}
            sourceId={sourceId}
            destinationId={destinationId}
            onSourceChange={setSourceId}
            onDestinationChange={setDestinationId}
          />
          {!canCreateTransfer && (environments.length > 0) && (
            <p className="text-xs text-muted-foreground">
              Select different source and destination environments to enable transfers.
            </p>
          )}
        </div>

        <Separator />

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            icon={<Layers className="size-5 text-muted-foreground" />}
            label="Total Transfers"
            value={stats.total}
            colorScheme="neutral"
          />
          <StatCard
            icon={<Clock className="size-5 text-primary" />}
            label="Active"
            value={stats.active}
            colorScheme="primary"
          />
          <StatCard
            icon={<CheckCircle2 className="size-5 text-success-fg" />}
            label="Completed"
            value={stats.completed}
            colorScheme="success"
          />
          <StatCard
            icon={<FileX2 className="size-5 text-danger-fg" />}
            label="Failed"
            value={stats.failed}
            colorScheme="danger"
          />
        </div>

        {/* Transfer history */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Transfer History</h2>
              <p className="text-sm text-muted-foreground">
                All content transfers initiated from this browser.
              </p>
            </div>
            {transfers.length > 0 && (
              <Badge colorScheme="neutral" size="sm">
                {transfers.length} transfer{transfers.length !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>

          <Card>
            <CardContent className="pt-0">
              <TransferList
                transfers={transfers}
                onDelete={handleDelete}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Stat card sub-component ────────────────────────────────────────────────

type StatColorScheme = "neutral" | "primary" | "success" | "danger";

function StatCard({
  icon,
  label,
  value,
  colorScheme,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  colorScheme: StatColorScheme;
}) {
  const bgMap: Record<StatColorScheme, string> = {
    neutral: "bg-muted",
    primary: "bg-primary/5",
    success: "bg-success-bg",
    danger: "bg-danger-bg",
  };
  const textMap: Record<StatColorScheme, string> = {
    neutral: "text-foreground",
    primary: "text-primary",
    success: "text-success-fg",
    danger: "text-danger-fg",
  };

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardDescription className="flex items-center gap-1.5">
          {icon}
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <span
          className={`text-3xl font-bold ${textMap[colorScheme]}`}
        >
          {value}
        </span>
      </CardContent>
    </Card>
  );
}
