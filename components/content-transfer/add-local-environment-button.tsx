"use client";

import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useState } from "react";
import { LocalEnvironmentSettings } from "./local-environment-settings";

/** Reusable "Add local Docker environment" entry point + its settings dialog,
 *  shared by the transfer, backup and restore wizards' environment pickers. */
export function AddLocalEnvironmentButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-fit"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4 mr-1.5" />
        Add local Docker environment
      </Button>
      <LocalEnvironmentSettings open={open} onOpenChange={setOpen} />
    </>
  );
}
