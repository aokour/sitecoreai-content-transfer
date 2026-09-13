import type { LocalDockerEnvironmentEntry } from "@/lib/content-transfer";
import { createDockerAuthProvider } from "./docker-auth";

export interface DockerHealthCheckResult {
  ok: boolean;
  message: string;
}

/**
 * A cheap reachability + auth check — the same request the "Test connection"
 * button in the settings dialog uses, extracted here so the Dashboard's
 * background connection check (hooks/use-docker-connection-status.ts) shares
 * the exact same logic instead of duplicating it.
 */
export async function checkDockerConnection(
  env: LocalDockerEnvironmentEntry,
): Promise<DockerHealthCheckResult> {
  const baseUrl = env.baseUrl.trim().replace(/\/+$/, "");
  try {
    const auth = createDockerAuthProvider(env);
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
      return { ok: true, message: `Connected — HTTP ${res.status}.` };
    }
    return { ok: false, message: `HTTP ${res.status} ${res.statusText}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const looksLikeCors = msg.toLowerCase().includes("failed to fetch");
    return {
      ok: false,
      message: looksLikeCors
        ? `${msg} — likely blocked by CORS on the container.`
        : msg,
    };
  }
}
