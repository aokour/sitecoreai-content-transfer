"use client";

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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTransferHistory } from "@/hooks/use-transfer-history";
import { useTransferStatus } from "@/hooks/use-transfer-status";
import { useContentTransfer } from "@/hooks/use-content-transfer";
import {
  formatTransferId,
  getPhaseColorScheme,
  isTransferActive,
  TRANSFER_PHASE_LABELS,
} from "@/lib/content-transfer";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Copy,
  RefreshCw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function TransferDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { getTransfer, removeTransfer, updateTransferPhase } = useTransferHistory();
  const { deleteTransfer } = useContentTransfer();
  const [copied, setCopied] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const record = getTransfer(params.id);

  // Poll status only when the transfer is still active
  const shouldPoll = record ? isTransferActive(record.phase) : false;
  const { state, chunkSetsMetadata, isLoading, refresh } = useTransferStatus(
    shouldPoll ? params.id : null,
    shouldPoll ? record?.sourceContextId ?? null : null
  );

  // Sync polled state back to localStorage
  useEffect(() => {
    if (!record || !state) return;
    if (state === "Completed") updateTransferPhase(params.id, "completed");
    if (state === "Failed") updateTransferPhase(params.id, "failed");
  }, [state, params.id, record, updateTransferPhase]);

  function copyId() {
    navigator.clipboard.writeText(params.id).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDelete() {
    if (!record) return;
    setIsDeleting(true);
    await deleteTransfer(params.id, record.sourceContextId);
    removeTransfer(params.id);
    router.push("/");
  }

  // Not found
  if (!record) {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b bg-card">
          <div className="container mx-auto px-6 py-4 max-w-7xl">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/">
                <ArrowLeft className="size-4 mr-2" />
                Dashboard
              </Link>
            </Button>
          </div>
        </div>
        <div className="container mx-auto px-6 py-20 max-w-7xl text-center">
          <p className="text-muted-foreground">Transfer not found.</p>
          <Button asChild className="mt-4">
            <Link href="/">Back to Dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  const activePhase = isTransferActive(record.phase);
  const displayChunkSets =
    chunkSetsMetadata.length > 0 ? chunkSetsMetadata : [];

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between max-w-7xl">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/">
                <ArrowLeft className="size-4 mr-2" />
                Dashboard
              </Link>
            </Button>
            <div className="h-4 w-px bg-border" />
            <div>
              <h1 className="text-base font-semibold leading-none">
                Transfer Details
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {record.label || "Untitled Transfer"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge colorScheme={getPhaseColorScheme(record.phase)}>
              {TRANSFER_PHASE_LABELS[record.phase]}
            </Badge>
            {activePhase && (
              <Button
                variant="ghost"
                size="icon"
                onClick={refresh}
                disabled={isLoading}
                className="text-muted-foreground"
              >
                <RefreshCw
                  className={`size-4 ${isLoading ? "animate-spin" : ""}`}
                />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDelete}
              disabled={isDeleting || activePhase}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-8 max-w-7xl space-y-6">
        {/* Info card */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Transfer ID */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Transfer ID</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <code className="text-sm font-mono flex-1 truncate cursor-default">
                    {formatTransferId(params.id)}
                  </code>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-mono text-xs">{params.id}</p>
                </TooltipContent>
              </Tooltip>
              <Button
                variant="ghost"
                size="icon"
                onClick={copyId}
                className="shrink-0 text-muted-foreground"
              >
                <Copy className="size-3.5" />
              </Button>
              {copied && (
                <span className="text-xs text-success-fg">Copied!</span>
              )}
            </CardContent>
          </Card>

          {/* Created at */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Created</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-2">
              <Clock className="size-4 text-muted-foreground" />
              <span className="text-sm">
                {new Date(record.createdAt).toLocaleString()}
              </span>
            </CardContent>
          </Card>
        </div>

        {/* Environments */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Environment Route</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="flex-1 rounded-md border p-3 text-center">
                <p className="font-medium text-sm">{record.sourceTenantName}</p>
                <p className="text-xs text-muted-foreground mt-1">Source</p>
                <p className="text-xs font-mono text-muted-foreground mt-1 truncate">
                  {record.sourceContextId}
                </p>
              </div>
              <ArrowRight className="size-5 text-muted-foreground shrink-0" />
              <div className="flex-1 rounded-md border p-3 text-center">
                <p className="font-medium text-sm">
                  {record.destinationTenantName}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Destination
                </p>
                <p className="text-xs font-mono text-muted-foreground mt-1 truncate">
                  {record.destinationContextId}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Progress — only shown when active or if we have status data */}
        {(activePhase || state) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                Transfer Status
                {isLoading && (
                  <RefreshCw className="size-3.5 text-muted-foreground animate-spin" />
                )}
              </CardTitle>
              <CardDescription>
                Live status from the source environment
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {state && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">State:</span>
                  <Badge
                    colorScheme={
                      state === "Completed"
                        ? "success"
                        : state === "Failed"
                          ? "danger"
                          : "primary"
                    }
                    size="sm"
                  >
                    {state}
                  </Badge>
                </div>
              )}
              {activePhase && (
                <div className="space-y-1.5">
                  <Progress value={undefined} className="h-1.5 animate-pulse" />
                  <p className="text-xs text-muted-foreground">
                    Transfer is in progress...
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Item paths */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Content Items
              <Badge colorScheme="neutral" size="sm">
                {record.itemPaths.length}
              </Badge>
            </CardTitle>
            <CardDescription>
              Item paths included in this transfer
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {record.itemPaths.map((path, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted"
                >
                  <code className="text-xs font-mono flex-1 break-all">
                    {path}
                  </code>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Chunk sets — shown when available */}
        {displayChunkSets.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Chunk Sets</CardTitle>
              <CardDescription>
                Binary content segments from the source environment
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Chunk Set ID</TableHead>
                    <TableHead className="text-right">Chunks</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayChunkSets.map((cs) => (
                    <TableRow key={cs.ChunkSetId}>
                      <TableCell className="font-mono text-xs">
                        {cs.ChunkSetId.length > 24
                          ? `${cs.ChunkSetId.slice(0, 12)}...${cs.ChunkSetId.slice(-4)}`
                          : cs.ChunkSetId}
                      </TableCell>
                      <TableCell className="text-right">
                        {cs.ChunkCount}
                      </TableCell>
                      <TableCell className="text-right">
                        {cs.TotalItemCount}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Delete action */}
        <Separator />
        <div className="rounded-lg border border-destructive/30 p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Delete Transfer</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Remove this transfer from history and clean up resources on the
              source environment. This cannot be undone.
            </p>
          </div>
          <Button
            variant="outline"
            className="text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={handleDelete}
            disabled={isDeleting || activePhase}
          >
            <Trash2 className="size-4 mr-2" />
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </div>
    </div>
  );
}
