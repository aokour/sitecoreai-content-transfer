"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { TransferRecord } from "@/lib/content-transfer";
import {
  formatTransferId,
  getPhaseColorScheme,
  TRANSFER_PHASE_LABELS,
} from "@/lib/content-transfer";
import { ArrowRight, Eye, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

interface TransferListProps {
  transfers: TransferRecord[];
  onDelete: (transferId: string, sourceContextId: string) => void;
  isLoading?: boolean;
}

export function TransferList({
  transfers,
  onDelete,
  isLoading = false,
}: TransferListProps) {
  const router = useRouter();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (transfers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-4">
          <ArrowRight className="size-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">No transfers yet</p>
        <p className="text-sm text-muted-foreground mt-1">
          Create a new transfer to move content between environments.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Label</TableHead>
          <TableHead>Transfer ID</TableHead>
          <TableHead>Route</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Items</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {transfers.map((record) => (
          <TableRow key={record.transferId}>
            {/* Label */}
            <TableCell className="font-medium max-w-[160px] truncate">
              {record.label || "Untitled"}
            </TableCell>

            {/* Transfer ID */}
            <TableCell>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="font-mono text-xs cursor-default">
                    {formatTransferId(record.transferId)}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-mono text-xs">{record.transferId}</p>
                </TooltipContent>
              </Tooltip>
            </TableCell>

            {/* Route: source → dest */}
            <TableCell>
              <div className="flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground max-w-[80px] truncate">
                  {record.sourceTenantName}
                </span>
                <ArrowRight className="size-3 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground max-w-[80px] truncate">
                  {record.destinationTenantName}
                </span>
              </div>
            </TableCell>

            {/* Status */}
            <TableCell>
              <Badge
                colorScheme={getPhaseColorScheme(record.phase)}
                size="sm"
                className="capitalize"
              >
                {TRANSFER_PHASE_LABELS[record.phase]}
              </Badge>
            </TableCell>

            {/* Created */}
            <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
              {new Date(record.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </TableCell>

            {/* Item count */}
            <TableCell className="text-sm text-muted-foreground">
              {record.itemPaths.length}
            </TableCell>

            {/* Actions */}
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        router.push(`/transfer/${record.transferId}`)
                      }
                    >
                      <Eye className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>View details</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        onDelete(record.transferId, record.sourceContextId)
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Delete transfer</TooltipContent>
                </Tooltip>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
