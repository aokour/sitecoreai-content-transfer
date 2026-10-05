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
import {
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  Pencil,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { useRef, useState } from "react";
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

/** Depth-first search for an "accessToken" string field anywhere in a parsed
 *  .sitecore/user.json, so this keeps working even if the CLI adds/reorders
 *  endpoints. The documented shape (`endpoints.xmCloud.accessToken`) is just
 *  the first place this happens to find one. */
function findAccessToken(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, val] of entries) {
    if (key === "accessToken" && typeof val === "string" && val.trim()) {
      return val;
    }
  }
  for (const [, val] of entries) {
    if (val && typeof val === "object") {
      const nested = findAccessToken(val);
      if (nested) return nested;
    }
  }
  return null;
}

/** A single copyable config line/snippet used in the CORS setup instructions. */
function CodeSnippet({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-1.5">
      <pre className="min-w-0 flex-1 overflow-x-auto rounded bg-muted px-2 py-1.5 font-mono text-[11px]">
        <code>{value}</code>
      </pre>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0"
        aria-label="Copy"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? (
          <Check className="size-3.5 text-success-fg" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </Button>
    </div>
  );
}

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
  const [importOpen, setImportOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [corsHelpOpen, setCorsHelpOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function startAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setTestResult(null);
    setImportOpen(false);
    setImportError(null);
    setCorsHelpOpen(false);
  }

  function startEdit(env: LocalDockerEnvironmentEntry) {
    setEditingId(env.id);
    setForm({
      displayName: env.displayName,
      baseUrl: env.baseUrl,
      token: env.token ?? "",
    });
    setTestResult(null);
    setImportOpen(false);
    setImportError(null);
    setCorsHelpOpen(false);
  }

  async function handleImportFile(file: File) {
    setImportError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setImportError(
        "That file isn't valid JSON — make sure you selected .sitecore/user.json.",
      );
      return;
    }
    const token = findAccessToken(parsed);
    if (!token) {
      setImportError(
        "Couldn't find an access token in that file. Double-check it's .sitecore/user.json, or paste your token below manually.",
      );
      return;
    }
    setForm((f) => ({ ...f, token }));
    setImportOpen(false);
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
    <>
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

        <div className="min-w-0 space-y-4">
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
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="ld-token">Bearer token</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setImportOpen((o) => !o);
                  setImportError(null);
                }}
              >
                <Upload className="size-3.5 mr-1.5" />
                Import from .sitecore/user.json
              </Button>
            </div>

            {importOpen && (
              <div className="space-y-2.5 rounded-md border bg-muted/20 p-3 text-xs">
                <p className="font-medium text-foreground">
                  Get a token from the Sitecore CLI
                </p>
                <ol className="list-inside list-decimal space-y-1 text-muted-foreground">
                  <li>Open a terminal at your repo root.</li>
                  <li>
                    Run{" "}
                    <code className="rounded bg-muted px-1 py-0.5">
                      dotnet sitecore cloud login
                    </code>
                    .
                  </li>
                  <li>
                    This creates/updates{" "}
                    <code className="rounded bg-muted px-1 py-0.5">
                      .sitecore/user.json
                    </code>{" "}
                    in your repo root.
                  </li>
                  <li>
                    Select that file below — it&apos;s only read in your
                    browser, never uploaded anywhere.
                  </li>
                </ol>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose file…
                </Button>
                {importError && (
                  <p className="text-danger-fg">{importError}</p>
                )}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleImportFile(file);
              }}
            />

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
              Or paste one directly — obtained via the Sitecore CLI login
              flow, since this app has no backend to fetch one automatically.
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

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Needs CORS enabled on your local container for this app&apos;s
              origin.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCorsHelpOpen(true)}
            >
              CORS setup instructions
            </Button>
          </div>

          <Alert>
            <AlertDescription className="text-xs">
              Credentials are stored only in this browser&apos;s localStorage
              — suitable for a local/dev target, not production credentials.
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

    <Dialog open={corsHelpOpen} onOpenChange={setCorsHelpOpen}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>CORS setup instructions</DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-3 text-xs">
          <div className="space-y-1.5">
            <p className="font-medium text-foreground">
              1. In your Sitecore host repo, edit{" "}
              <code className="break-all rounded bg-muted px-1 py-0.5">
                local-containers/.env
              </code>
            </p>
            <p className="text-muted-foreground">
              Update{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                SITECORE_GRAPHQL_CORS
              </code>{" "}
              to include this app&apos;s origin (keep your existing entries,
              just append this one):
            </p>
            <CodeSnippet value="SITECORE_GRAPHQL_CORS=*.sitecorecloud.io;*saicontent-transfer.vercel.app" />
            <p className="text-muted-foreground">Add a new variable:</p>
            <CodeSnippet value="SITECORE_CONTENTTRANSFER_CORS_ORIGINS=https://saicontent-transfer.vercel.app" />
          </div>

          <div className="space-y-1.5">
            <p className="font-medium text-foreground">
              2. In{" "}
              <code className="break-all rounded bg-muted px-1 py-0.5">
                local-containers/docker-compose.override.yml
              </code>
              , under the{" "}
              <code className="rounded bg-muted px-1 py-0.5">cm</code>{" "}
              service&apos;s environment section, add:
            </p>
            <CodeSnippet value="SITECORE_CONTENTTRANSFER_CORS_ORIGINS: ${SITECORE_CONTENTTRANSFER_CORS_ORIGINS}" />
          </div>

          <p className="text-muted-foreground">
            Restart your containers for the change to take effect.
          </p>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
