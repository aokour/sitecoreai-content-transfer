"use client";

import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useState } from "react";
import { LocalEnvironmentSettings } from "./local-environment-settings";

/** Reusable "Manage local Docker environments" entry point + its add/edit/
 *  remove settings dialog, shared by the Dashboard and the transfer, backup
 *  and restore wizards' environment pickers. */
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
        Manage local Docker environments
      </Button>
      <LocalEnvironmentSettings open={open} onOpenChange={setOpen} />
    </>
  );
}
