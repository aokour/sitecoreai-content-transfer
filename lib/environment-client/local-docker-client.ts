import type {
  BlobStateResponse,
  ContentTransferStatus,
  DataTreeItem,
  LocalDockerEnvironmentEntry,
} from "@/lib/content-transfer";
import { createDockerAuthProvider } from "./docker-auth";
import type {
  ConsumeFileResult,
  ContentTransferTransport,
  EnvironmentClient,
  GraphQLEnvelope,
  SaveChunkResult,
} from "./types";

// EnvironmentClient backed by direct browser fetch() calls to a local Docker
// SitecoreAI instance's REST/GraphQL APIs — no Marketplace SDK involved, since
// a local container has no sitecoreContextId the SDK bridge could route to.
//
// Endpoint shapes are confirmed against a real running container (via
// Postman) for: Content Transfer API status/chunks, Item Transfer API
// sources/blobs list, and the authoring GraphQL endpoint. The Item Transfer
// API's "start transfer" (consumeFile equivalent) call below follows the
// documented shape but has not been individually smoke-tested end-to-end —
// verify against a real container and adjust if the response shape differs.

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

async function readJsonSafely(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const rec = body as Record<string, unknown>;
    if (typeof rec.Error === "string") return rec.Error;
    if (typeof rec.Message === "string") return rec.Message;
    if (typeof rec.error === "string") return rec.error;
  }
  if (typeof body === "string" && body) return body;
  return fallback;
}

export function createLocalDockerEnvironmentClient(
  env: LocalDockerEnvironmentEntry,
): EnvironmentClient {
  const baseUrl = trimTrailingSlash(env.baseUrl);
  const auth = createDockerAuthProvider(env);

  async function authHeaders(
    extra?: Record<string, string>,
  ): Promise<HeadersInit> {
    const token = await auth.getToken();
    return {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    };
  }

  const contentTransfer: ContentTransferTransport = {
    async createContentTransfer(transferId, dataTrees: DataTreeItem[]) {
      const res = await fetch(
        `${baseUrl}/sitecore/api/content/transfer/v1/transfers`,
        {
          method: "POST",
          headers: await authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            transferId,
            configuration: { dataTrees },
          }),
        },
      );
      if (!res.ok) {
        const body = await readJsonSafely(res);
        throw new Error(
          `createContentTransfer failed (HTTP ${res.status}): ${errorMessageFromBody(body, res.statusText)}`,
        );
      }
    },

    async getContentTransferStatus(transferId) {
      const res = await fetch(
        `${baseUrl}/sitecore/api/content/transfer/v1/transfers/${transferId}/status`,
        { headers: await authHeaders() },
      );
      if (res.status === 404) return null;
      if (!res.ok) {
        const body = await readJsonSafely(res);
        throw new Error(
          `getContentTransferStatus failed (HTTP ${res.status}): ${errorMessageFromBody(body, res.statusText)}`,
        );
      }
      return (await readJsonSafely(res)) as ContentTransferStatus;
    },

    async getChunk(transferId, chunksetId, chunkId) {
      const res = await fetch(
        `${baseUrl}/sitecore/api/content/transfer/v1/transfers/${transferId}/chunksets/${chunksetId}/chunks/${chunkId}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) return null;
      const blob = await res.blob();
      return blob.size > 0 ? blob : null;
    },

    async saveChunk(
      transferId,
      chunksetId,
      chunkId,
      body,
      isMedia,
    ): Promise<SaveChunkResult> {
      try {
        const res = await fetch(
          `${baseUrl}/sitecore/api/content/transfer/v1/transfers/${transferId}/chunksets/${chunksetId}/chunks/${chunkId}?isMedia=${isMedia}`,
          {
            method: "PUT",
            // Forward the Blob exactly as received from getChunk — no
            // re-encoding, re-slicing, decompression or decryption. fetch()
            // sends a Blob body natively without any JSON serialization.
            headers: await authHeaders({
              "Content-Type": "application/octet-stream",
            }),
            body,
          },
        );
        if (!res.ok) {
          const errBody = await readJsonSafely(res);
          return { ok: false, httpStatus: res.status, error: errBody };
        }
        return { ok: true };
      } catch (err) {
        // Network-level failure (offline, DNS, CORS) — no httpStatus, treated
        // as retryable by the caller's backoff loop.
        return { ok: false, error: err };
      }
    },

    async completeChunkSet(transferId, chunksetId) {
      const res = await fetch(
        `${baseUrl}/sitecore/api/content/transfer/v1/transfers/${transferId}/chunksets/${chunksetId}/complete`,
        { method: "POST", headers: await authHeaders() },
      );
      if (!res.ok) {
        const body = await readJsonSafely(res);
        throw new Error(
          `completeChunkSetTransfer failed (HTTP ${res.status}): ${errorMessageFromBody(body, res.statusText)}`,
        );
      }
      const body = await readJsonSafely(res);
      const fileName =
        typeof body === "string"
          ? body
          : (body as { ContentTransferFileName?: string } | null)
              ?.ContentTransferFileName;
      if (!fileName) {
        throw new Error(
          "completeChunkSetTransfer did not return a ContentTransferFileName",
        );
      }
      return fileName;
    },

    async consumeFile(fileName, databaseName): Promise<ConsumeFileResult> {
      // Item Transfer API — "Start consuming a file or blob source into a
      // database". Documented as blobName=<raw file name>, unprefixed (unlike
      // the Marketplace SDK's own consumeFile, which prefixes with "blob://"
      // internally for its own addressing). Verify this against a real
      // container — this endpoint's response shape is the one part of this
      // transport not yet individually smoke-tested end-to-end.
      const url = `${baseUrl}/sitecore/shell/api/v3/ItemsTransfer/transfers/databases/${encodeURIComponent(
        databaseName,
      )}/sources?blobName=${encodeURIComponent(fileName)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: await authHeaders(),
      });
      if (res.ok) return { ok: true };
      const body = await readJsonSafely(res);
      const message = errorMessageFromBody(body, res.statusText);
      const notReady =
        res.status === 404 || message.toLowerCase().includes("does not exist");
      return { ok: false, notReady, error: body ?? message };
    },

    async getBlobState(fileName) {
      const res = await fetch(
        `${baseUrl}/sitecore/shell/api/v3/ItemsTransfer/sources/blobs/${encodeURIComponent(fileName)}`,
        { headers: await authHeaders() },
      );
      if (res.status === 404) return null;
      if (!res.ok) {
        const body = await readJsonSafely(res);
        throw new Error(
          `getBlobState failed (HTTP ${res.status}): ${errorMessageFromBody(body, res.statusText)}`,
        );
      }
      return (await readJsonSafely(res)) as BlobStateResponse;
    },

    async deleteContentTransfer(transferId) {
      await fetch(
        `${baseUrl}/sitecore/api/content/transfer/v1/transfers/${transferId}`,
        { method: "DELETE", headers: await authHeaders() },
      );
    },
  };

  return {
    contentTransfer,
    async graphql<T>(query: string, variables?: Record<string, unknown>) {
      const res = await fetch(`${baseUrl}/sitecore/api/authoring/graphql/v1`, {
        method: "POST",
        headers: await authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) {
        const body = await readJsonSafely(res);
        throw new Error(
          `GraphQL request failed (HTTP ${res.status}): ${errorMessageFromBody(body, res.statusText)}`,
        );
      }
      return (await readJsonSafely(res)) as GraphQLEnvelope<T>;
    },
  };
}
