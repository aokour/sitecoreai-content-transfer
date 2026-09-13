"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useDockerConnectionStatus,
  type DockerConnectionStatus,
} from "@/hooks/use-docker-connection-status";
import { useLocalDockerEnvironments } from "@/hooks/use-local-docker-environments";
import type { LocalDockerEnvironmentEntry } from "@/lib/content-transfer";
import { decodeJwtExpiry } from "@/lib/environment-client/docker-auth";
import { checkDockerConnection } from "@/lib/environment-client/docker-health-check";
import { ALLOW_LOCAL_DOCKER_DESTINATION } from "@/lib/feature-flags";
import { CheckCircle2, Loader2, Pencil, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { DockerIcon } from "./docker-icon";

interface LocalEnvironmentSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FormState {
  displayName: string;
  baseUrl: string;
  token: string;
}

const EMPTY_FORM: FormState = {
  displayName: "",
  baseUrl: "https://xmcloudcm.localhost",
  token: "",
};

type TestResult = { ok: boolean; message: string } | null;

function ConnectionStatusIcon({
  status,
}: {
  status: DockerConnectionStatus | undefined;
}) {
  if (!status || status.state === "checking") {
    return (
      <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
    );
  }
  if (status.state === "ok") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <CheckCircle2 className="size-3.5 shrink-0 text-success-fg" />
        </TooltipTrigger>
        <TooltipContent>Connected</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <XCircle className="size-3.5 shrink-0 text-danger-fg" />
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{status.message}</TooltipContent>
    </Tooltip>
  );
}

/** Add/edit/remove dialog for locally registered Docker SitecoreAI
 *  environments — persisted to localStorage via useLocalDockerEnvironments. */
export function LocalEnvironmentSettings({
  open,
  onOpenChange,
}: LocalEnvironmentSettingsProps) {
  const { environments, addEnvironment, updateEnvironment, removeEnvironment } =
    useLocalDockerEnvironments();
  const connectionStatuses = useDockerConnectionStatus(environments);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [testing, setTesting] = useState(false);

  function startAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setTestResult(null);
  }

  function startEdit(env: LocalDockerEnvironmentEntry) {
    setEditingId(env.id);
    setForm({
      displayName: env.displayName,
      baseUrl: env.baseUrl,
      token: env.token ?? "",
    });
    setTestResult(null);
  }

  function save() {
    const payload = {
      displayName: form.displayName.trim() || "Local Docker",
      baseUrl: form.baseUrl.trim().replace(/\/+$/, ""),
      token: form.token.trim(),
    };
    if (editingId) {
      updateEnvironment(editingId, payload);
    } else {
      addEnvironment(payload);
    }
    startAdd();
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    const result = await checkDockerConnection({
      kind: "local-docker",
      id: "test",
      displayName: form.displayName,
      baseUrl: form.baseUrl.trim().replace(/\/+$/, ""),
      token: form.token,
    });
    setTestResult(result);
    setTesting(false);
  }

  const tokenExpiry = form.token ? decodeJwtExpiry(form.token) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DockerIcon className="size-5 shrink-0" />
            Local Docker Environments
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground -mt-2">
          {ALLOW_LOCAL_DOCKER_DESTINATION
            ? "Usable as a transfer/backup source or destination in this build."
            : "Currently usable as a transfer/backup source only. Using a local Docker environment as a destination needs additional Azure Blob Storage configuration on the container."}
        </p>

        <div className="space-y-4">
          {environments.length > 0 && (
            <div className="space-y-2">
              {environments.map((env) => (
                <div
                  key={env.id}
                  className="flex items-center justify-between rounded-md border p-2.5 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ConnectionStatusIcon status={connectionStatuses[env.id]} />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{env.displayName}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {env.baseUrl}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${env.displayName}`}
                      onClick={() => startEdit(env)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${env.displayName}`}
                      onClick={() => removeEnvironment(env.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              <Separator />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ld-name">Display name</Label>
            <Input
              id="ld-name"
              value={form.displayName}
              onChange={(e) =>
                setForm((f) => ({ ...f, displayName: e.target.value }))
              }
              placeholder="My local Docker"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ld-baseurl">Base URL</Label>
            <Input
              id="ld-baseurl"
              value={form.baseUrl}
              onChange={(e) =>
                setForm((f) => ({ ...f, baseUrl: e.target.value }))
              }
              placeholder="https://xmcloudcm.localhost"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ld-token">Bearer token</Label>
            <Textarea
              id="ld-token"
              rows={3}
              value={form.token}
              onChange={(e) =>
                setForm((f) => ({ ...f, token: e.target.value }))
              }
              placeholder="eyJhbGciOi..."
            />
            {tokenExpiry && (
              <p className="text-xs text-muted-foreground">
                Expires at {tokenExpiry.toLocaleString()}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Obtain via the Sitecore CLI login flow — this app has no backend
              to fetch one automatically.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={testConnection}
              disabled={testing || !form.baseUrl.trim()}
            >
              {testing ? "Testing…" : "Test connection"}
            </Button>
            {testResult && (
              <span
                className={`flex items-center gap-1.5 text-xs ${
                  testResult.ok ? "text-success-fg" : "text-danger-fg"
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="size-3.5 shrink-0" />
                ) : (
                  <XCircle className="size-3.5 shrink-0" />
                )}
                {testResult.message}
              </span>
            )}
          </div>

          <Alert>
            <AlertDescription className="text-xs">
              Requires CORS to be enabled on the container for this app&apos;s
              origin. Credentials are stored only in this browser&apos;s
              localStorage — suitable for a local/dev target, not production
              credentials.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          {editingId && (
            <Button type="button" variant="ghost" onClick={startAdd}>
              Cancel edit
            </Button>
          )}
          <Button type="button" onClick={save} disabled={!form.baseUrl.trim()}>
            {editingId ? "Save changes" : "Add environment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
