"use client";

import { TransferWizard } from "@/components/content-transfer/transfer-wizard";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function NewTransferContent() {
  const searchParams = useSearchParams();
  const sourceId = searchParams.get("source");
  const destinationId = searchParams.get("destination");

  return (
    <TransferWizard
      initialSourceId={sourceId}
      initialDestinationId={destinationId}
    />
  );
}

export default function NewTransferPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center gap-4 max-w-7xl">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/">
              <ArrowLeft className="size-4 mr-2" />
              Dashboard
            </Link>
          </Button>
          <div className="h-4 w-px bg-border" />
          <div>
            <h1 className="text-base font-semibold leading-none">
              New Content Transfer
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure and start a content transfer between environments
            </p>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
              Loading...
            </div>
          }
        >
          <NewTransferContent />
        </Suspense>
      </div>
    </div>
  );
}
