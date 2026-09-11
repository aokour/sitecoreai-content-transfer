"use client";

import { BackupWizard } from "@/components/content-transfer/backup-wizard";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function NewBackupContent() {
  const searchParams = useSearchParams();
  const sourceId = searchParams.get("source");

  return <BackupWizard initialSourceId={sourceId} />;
}

export default function NewBackupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen text-muted-foreground text-sm">
          Loading...
        </div>
      }
    >
      <NewBackupContent />
    </Suspense>
  );
}
