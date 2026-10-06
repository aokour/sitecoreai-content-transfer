"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  LOCAL_DOCKER_CONTACT_URL,
  LOCAL_DOCKER_ENABLED,
} from "@/lib/feature-flags";
import { ArrowUpRight, Check, Lock, Plus } from "lucide-react";
import { useState } from "react";
import { DockerIcon } from "./docker-icon";
import { LocalEnvironmentSettings } from "./local-environment-settings";

const LOCAL_DOCKER_BENEFITS = [
  "Pull SitecoreAI content into your local Docker containers for development",
  "Push content from local Docker back up to SitecoreAI environments",
  "Back up and restore packages to and from local containers",
];

/** Explains the on-request local Docker feature and points to Americaneagle
 *  .com — shown in place of the settings dialog while the feature is off. */
function LocalDockerContactDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DockerIcon className="size-5 shrink-0" />
            Local Docker transfers
          </DialogTitle>
          <DialogDescription>
            Local Docker support is available on request. Contact
            Americaneagle.com to enable it for your team.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 text-sm">
          {LOCAL_DOCKER_BENEFITS.map((benefit) => (
            <li key={benefit} className="flex items-start gap-2">
              <Check className="size-4 shrink-0 mt-0.5 text-success-fg" />
              {benefit}
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Not now
          </Button>
          <Button asChild>
            <a
              href={LOCAL_DOCKER_CONTACT_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Contact Americaneagle.com
              <ArrowUpRight className="size-4 ml-1.5" />
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Reusable "Manage local Docker environments" entry point + its add/edit/
 *  remove settings dialog, shared by the Dashboard and the transfer, backup
 *  and restore wizards' environment pickers. While LOCAL_DOCKER_ENABLED is
 *  off it becomes an "Enable local Docker transfers" button that opens a
 *  contact-us dialog instead. */
export function AddLocalEnvironmentButton() {
  const [open, setOpen] = useState(false);

  if (!LOCAL_DOCKER_ENABLED) {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() => setOpen(true)}
        >
          <Lock className="size-4 mr-1.5" />
          Enable local Docker transfers
        </Button>
        <LocalDockerContactDialog open={open} onOpenChange={setOpen} />
      </>
    );
  }

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
