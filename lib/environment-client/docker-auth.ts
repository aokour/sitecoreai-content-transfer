import type { LocalDockerEnvironmentEntry } from "@/lib/content-transfer";

export interface DockerAuthProvider {
  /** Resolves to the bearer token to send, or null to send no Authorization header. */
  getToken(): Promise<string | null>;
}

/** Decodes a JWT's `exp` claim without verifying the signature — used only
 *  for a UI display nudge ("expires at HH:MM"), never for security. */
export function decodeJwtExpiry(token: string): Date | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (typeof json.exp !== "number") return null;
    return new Date(json.exp * 1000);
  } catch {
    return null;
  }
}

/**
 * Builds the auth provider for a local Docker environment entry. "manual-token"
 * is the primary, fully-working mode: there is no backend in this app to run
 * an OAuth/client-credentials exchange from, so the user obtains a bearer
 * token out-of-band via the Sitecore CLI and pastes it in — this provider just
 * returns it, failing loudly if it has visibly expired rather than sending a
 * stale token and surfacing a confusing 401 downstream.
 */
export function createDockerAuthProvider(
  env: LocalDockerEnvironmentEntry,
): DockerAuthProvider {
  switch (env.authMode) {
    case "none":
      return {
        async getToken() {
          return null;
        },
      };
    case "api-key":
      return {
        async getToken() {
          return env.apiKey?.trim() || null;
        },
      };
    case "manual-token":
      return {
        async getToken() {
          const token = env.token?.trim();
          if (!token) {
            throw new Error(
              `No bearer token saved for "${env.displayName}". Paste one obtained via the Sitecore CLI in the environment's settings.`,
            );
          }
          const expiry = decodeJwtExpiry(token);
          if (expiry && expiry.getTime() < Date.now()) {
            throw new Error(
              `The bearer token for "${env.displayName}" expired at ${expiry.toLocaleTimeString()}. Paste a fresh token obtained via the Sitecore CLI in the environment's settings.`,
            );
          }
          return token;
        },
      };
  }
}
