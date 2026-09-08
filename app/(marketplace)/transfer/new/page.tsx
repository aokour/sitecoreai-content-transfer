"use client";

import { TransferWizard } from "@/components/content-transfer/transfer-wizard";
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
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen text-muted-foreground text-sm">
          Loading...
        </div>
      }
    >
      <NewTransferContent />
    </Suspense>
  );
}
