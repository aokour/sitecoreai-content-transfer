"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";

// Standalone on purpose (Phase 0 spike, see plan): this route sits outside the
// (marketplace) route group, so it renders without the SDK handshake and can
// be opened directly inside the Marketplace iframe to test whether a direct
// browser fetch() to a local Docker SitecoreAI instance clears CORS from
// *this* embedding context — a bare page on the Vercel origin already proved
// the container sends no Access-Control-Allow-Origin header at all; this page
// exists to check whether the iframe-embedded context changes that.
//
// Throwaway/exploratory: not part of the reusable EnvironmentClient
// abstraction described in the plan. Delete once the CORS question is settled.

const DEFAULT_PATH = "/sitecore/shell/api/v3/ItemsTransfer/sources/blobs";

type TestResult = {
  ok: boolean;
  summary: string;
  detail?: string;
};

function ResultRow({ result }: { result: TestResult }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {result.ok ? (
        <CheckCircle2 className="size-4 text-success-fg mt-0.5 shrink-0" />
      ) : (
        <XCircle className="size-4 text-danger-fg mt-0.5 shrink-0" />
      )}
      <div className="min-w-0">
        <span className="font-medium">{result.summary}</span>
        {result.detail && (
          <p className="text-xs text-muted-foreground break-words whitespace-pre-wrap mt-1">
            {result.detail}
          </p>
        )}
      </div>
    </div>
  );
}

function detectContext(): { origin: string; inIframe: boolean; topOrigin: string } {
  const origin = window.location.origin;
  let inIframe = false;
  let topOrigin = "(unknown — cross-origin parent)";
  try {
    inIframe = window.self !== window.top;
  } catch {
    inIframe = true;
  }
  try {
    if (window.top && window.top.location.origin) {
      topOrigin = window.top.location.origin;
    }
  } catch {
    // Cross-origin parent — expected when embedded in the Marketplace host.
  }
  return { origin, inIframe, topOrigin };
}

export default function LocalDockerDiagnosticsPage() {
  const [baseUrl, setBaseUrl] = useState("");
  const [path, setPath] = useState(DEFAULT_PATH);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const context = typeof window !== "undefined" ? detectContext() : null;

  async function runTest() {
    setBusy(true);
    setResult(null);

    const trimmedBase = baseUrl.trim().replace(/\/+$/, "");
    const trimmedPath = path.trim().startsWith("/") ? path.trim() : `/${path.trim()}`;
    const url = `${trimmedBase}${trimmedPath}`;

    if (!trimmedBase) {
      setResult({ ok: false, summary: "Enter a base URL first." });
      setBusy(false);
      return;
    }

    const headers: HeadersInit = {};
    if (token.trim()) {
      headers.Authorization = `Bearer ${token.trim()}`;
    }

    try {
      const res = await fetch(url, { headers });
      const bodyText = await res.text().catch(() => "");
      const truncated =
        bodyText.length > 500 ? `${bodyText.slice(0, 500)}…` : bodyText;
      setResult({
        ok: true,
        summary: `Request completed — HTTP ${res.status} ${res.statusText}`,
        detail:
          `CORS preflight passed (the browser let the response through).\n\n` +
          `URL: ${url}\n` +
          (truncated ? `Body: ${truncated}` : "(empty body)"),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({
        ok: false,
        summary: "fetch() threw — almost always a CORS block",
        detail:
          `${msg}\n\n` +
          `URL: ${url}\n` +
          `Browsers deliberately hide the real reason behind a generic ` +
          `"Failed to fetch" for cross-origin requests blocked by CORS — check ` +
          `the DevTools Console (not this panel) for the actual ` +
          `"No 'Access-Control-Allow-Origin' header" message, and the Network ` +
          `tab for the OPTIONS preflight response.`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-6 py-8 max-w-3xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Local Docker CORS diagnostic</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Open this page inside the Marketplace iframe (not just as a bare
            tab) to check whether a direct browser <code>fetch()</code> to your
            local Docker SitecoreAI instance clears CORS from this embedding
            context.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Browsing context</CardTitle>
            <CardDescription>Detected automatically.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {context ? (
              <>
                <div>
                  <span className="font-medium">This page&apos;s origin: </span>
                  <code>{context.origin}</code>
                </div>
                <div>
                  <span className="font-medium">Embedded in an iframe: </span>
                  {context.inIframe ? "yes" : "no"}
                </div>
                {context.inIframe && (
                  <div>
                    <span className="font-medium">Parent/top origin: </span>
                    <code>{context.topOrigin}</code>
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">Detecting…</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Test connection</CardTitle>
            <CardDescription>
              A real <code>fetch()</code> call, no SDK involved.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="base-url">Base URL</Label>
              <Input
                id="base-url"
                placeholder="https://xmcloudcm.localhost"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="path">Path</Label>
              <Input
                id="path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="token">Bearer token (from Sitecore CLI login)</Label>
              <Textarea
                id="token"
                rows={3}
                placeholder="eyJhbGciOi..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </div>

            <Separator />

            <Button onClick={runTest} disabled={busy} size="sm">
              {busy ? "Testing…" : "Test connection"}
            </Button>

            {result && (
              <Alert variant={result.ok ? undefined : "danger"}>
                <AlertDescription>
                  <ResultRow result={result} />
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
