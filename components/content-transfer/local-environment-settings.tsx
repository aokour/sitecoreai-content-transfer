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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useLocalDockerEnvironments } from "@/hooks/use-local-docker-environments";
import type { LocalDockerEnvironmentEntry } from "@/lib/content-transfer";
import { ALLOW_LOCAL_DOCKER_DESTINATION } from "@/lib/feature-flags";
import {
  createDockerAuthProvider,
  decodeJwtExpiry,
} from "@/lib/environment-client/docker-auth";
import { CheckCircle2, Pencil, Trash2, XCircle } from "lucide-react";
import { useState } from "react";

interface LocalEnvironmentSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type AuthMode = LocalDockerEnvironmentEntry["authMode"];

interface FormState {
  displayName: string;
  baseUrl: string;
  authMode: AuthMode;
  apiKey: string;
  token: string;
}

const EMPTY_FORM: FormState = {
  displayName: "",
  baseUrl: "",
  authMode: "manual-token",
  apiKey: "",
  token: "",
};

type TestResult = { ok: boolean; message: string } | null;

/** Add/edit/remove dialog for locally registered Docker SitecoreAI
 *  environments — persisted to localStorage via useLocalDockerEnvironments. */
export function LocalEnvironmentSettings({
  open,
  onOpenChange,
}: LocalEnvironmentSettingsProps) {
  const { environments, addEnvironment, updateEnvironment, removeEnvironment } =
    useLocalDockerEnvironments();
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
      authMode: env.authMode,
      apiKey: env.apiKey ?? "",
      token: env.token ?? "",
    });
    setTestResult(null);
  }

  function save() {
    const payload = {
      displayName: form.displayName.trim() || "Local Docker",
      baseUrl: form.baseUrl.trim().replace(/\/+$/, ""),
      authMode: form.authMode,
      apiKey: form.authMode === "api-key" ? form.apiKey.trim() : undefined,
      token: form.authMode === "manual-token" ? form.token.trim() : undefined,
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
    const baseUrl = form.baseUrl.trim().replace(/\/+$/, "");
    try {
      const auth = createDockerAuthProvider({
        kind: "local-docker",
        id: "test",
        displayName: form.displayName,
        baseUrl,
        authMode: form.authMode,
        apiKey: form.apiKey,
        token: form.token,
      });
      const token = await auth.getToken();
      const res = await fetch(
        `${baseUrl}/sitecore/shell/api/v3/ItemsTransfer/sources/blobs`,
        {
          headers: {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      );
      if (res.ok) {
        setTestResult({ ok: true, message: `Connected — HTTP ${res.status}.` });
      } else {
        setTestResult({
          ok: false,
          message: `HTTP ${res.status} ${res.statusText}`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const looksLikeCors = msg.toLowerCase().includes("failed to fetch");
      setTestResult({
        ok: false,
        message: looksLikeCors
          ? `${msg} — likely blocked by CORS on the container (check the browser DevTools console for the real error).`
          : msg,
      });
    } finally {
      setTesting(false);
    }
  }

  const tokenExpiry =
    form.authMode === "manual-token" && form.token
      ? decodeJwtExpiry(form.token)
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Local Docker Environments</DialogTitle>
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
                  <div className="min-w-0">
                    <p className="font-medium truncate">{env.displayName}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {env.baseUrl}
                    </p>
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
            <Label htmlFor="ld-auth">Auth mode</Label>
            <Select
              value={form.authMode}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, authMode: v as AuthMode }))
              }
            >
              <SelectTrigger id="ld-auth" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual-token">
                  Bearer token (Sitecore CLI)
                </SelectItem>
                <SelectItem value="api-key">API key</SelectItem>
                <SelectItem value="none">None</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.authMode === "api-key" && (
            <div className="space-y-1.5">
              <Label htmlFor="ld-apikey">API key</Label>
              <Input
                id="ld-apikey"
                type="password"
                value={form.apiKey}
                onChange={(e) =>
                  setForm((f) => ({ ...f, apiKey: e.target.value }))
                }
              />
            </div>
          )}

          {form.authMode === "manual-token" && (
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
                Obtain via the Sitecore CLI login flow — this app has no
                backend to fetch one automatically.
              </p>
            </div>
          )}

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
