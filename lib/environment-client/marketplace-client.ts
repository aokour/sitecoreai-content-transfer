import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import type {
  BlobStateResponse,
  ContentTransferStatus,
  DataTreeItem,
} from "@/lib/content-transfer";
import type {
  ConsumeFileResult,
  ContentTransferTransport,
  EnvironmentClient,
  GraphQLEnvelope,
  SaveChunkResult,
} from "./types";

// EnvironmentClient backed by the Marketplace SDK's PostMessage bridge to the
// Sitecore host iframe, addressed by a sitecoreContextId GUID. Every method
// here is a behavior-preserving extraction of what used to live inline in
// lib/content-transfer-primitives.ts and the transfer/backup/restore hooks —
// same SDK method names, same response-unwrapping quirks, same error
// messages. contextId is bound once at construction time (one instance per
// side of a transfer), so callers never pass it per-call.

// Large binary chunks can take minutes to download/upload through the
// PostMessage bridge. The SDK default is 30s which is too short — use 6
// minutes per chunk operation. (The bridge does NOT honor this for its own
// ~30s internal ceiling — see the NOTE in content-transfer-primitives.ts —
// but it's still the right value to pass.)
const CHUNK_TRANSFER_TIMEOUT_MS = 6 * 60 * 1000;

export function createMarketplaceEnvironmentClient(
  client: ClientSDK,
  contextId: string,
): EnvironmentClient {
  const contentTransfer: ContentTransferTransport = {
    async createContentTransfer(transferId, dataTrees: DataTreeItem[]) {
      const res = await client.mutate(
        "xmc.contentTransfer.createContentTransfer",
        {
          params: {
            body: { transferId, configuration: { dataTrees } },
            query: { sitecoreContextId: contextId },
          },
        },
      );
      const resAny = res as unknown as { error?: unknown };
      if (resAny.error) {
        throw new Error(
          `createContentTransfer failed: ${JSON.stringify(resAny.error)}`,
        );
      }
    },

    async getContentTransferStatus(transferId) {
      const res = await client.query(
        "xmc.contentTransfer.getContentTransferStatus",
        {
          params: {
            path: { transferId },
            query: { sitecoreContextId: contextId },
          },
        },
      );
      // client.query() returns QueryResult<K> where .data is the @hey-api
      // response wrapper { data: T, request, response }. The actual payload
      // is at .data.data.
      const rawRes = res?.data as unknown;
      return (rawRes as { data?: ContentTransferStatus })?.data ?? null;
    },

    async getChunk(transferId, chunksetId, chunkId) {
      const res = await client.query("xmc.contentTransfer.getChunk", {
        params: {
          path: { transferId, chunksetId, chunkId },
          query: { sitecoreContextId: contextId },
        },
        timeoutMs: CHUNK_TRANSFER_TIMEOUT_MS,
      });
      const rawRes = res?.data as unknown;
      const chunkBlob = (rawRes as { data?: Blob | File | null })?.data ?? null;
      if (chunkBlob instanceof Blob && chunkBlob.size > 0) return chunkBlob;
      return null;
    },

    async saveChunk(
      transferId,
      chunksetId,
      chunkId,
      body,
      isMedia,
    ): Promise<SaveChunkResult> {
      try {
        // Send the raw Blob directly — DO NOT convert to ArrayBuffer. The SDK
        // defines saveChunk with bodySerializer:null and
        // Content-Type:application/octet-stream, meaning it passes the body
        // through to fetch without any serialization. ArrayBuffer serialises
        // to {} through JSON.stringify (loses all data), which is what caused
        // a server-side "Maximum call stack size exceeded" — Sitecore was
        // receiving an empty body and its error-handling path recursed.
        // isMedia must be explicitly passed — omitting the parameter (even
        // though the API spec marks it optional with default false) causes a
        // 405 error.
        const res = await client.mutate("xmc.contentTransfer.saveChunk", {
          params: {
            path: { transferId, chunksetId, chunkId },
            body,
            query: { sitecoreContextId: contextId, isMedia },
          },
          timeoutMs: CHUNK_TRANSFER_TIMEOUT_MS,
        });
        const resAny = res as unknown as {
          error?: unknown;
          response?: { status?: number };
        };
        if (resAny.error) {
          return {
            ok: false,
            httpStatus: resAny.response?.status,
            error: resAny.error,
          };
        }
        return { ok: true };
      } catch (err) {
        // Bridge timeout (or other thrown transport error). The per-call
        // timeoutMs is not honored by the PostMessage bridge (~30s default),
        // so large/slow uploads can land here. No httpStatus — the caller's
        // retry loop treats this as a transient/network-level failure.
        return { ok: false, error: err };
      }
    },

    async completeChunkSet(transferId, chunksetId) {
      const res = await client.mutate(
        "xmc.contentTransfer.completeChunkSetTransfer",
        {
          params: {
            path: { transferId, chunksetId },
            query: { sitecoreContextId: contextId },
          },
        },
      );
      const resAny = res as unknown as {
        data?: { ContentTransferFileName?: string };
        error?: unknown;
      };
      if (resAny.error) {
        throw new Error(
          `completeChunkSetTransfer failed: ${JSON.stringify(resAny.error)}`,
        );
      }
      // client.mutate() may surface the JSON body at .data or .data.data
      // depending on SDK version — check both paths defensively.
      const fileName =
        resAny.data?.ContentTransferFileName ??
        (resAny.data as unknown as { data?: { ContentTransferFileName?: string } })
          ?.data?.ContentTransferFileName;
      if (!fileName) {
        throw new Error(
          "completeChunkSetTransfer did not return a ContentTransferFileName",
        );
      }
      return fileName;
    },

    async consumeFile(fileName, databaseName): Promise<ConsumeFileResult> {
      // Both media and content use blob:// — file:// is only for on-disk file
      // system transfers.
      const consumeFileName = `blob://${fileName}`;
      const res = await client.query("xmc.contentTransfer.consumeFile", {
        params: {
          query: {
            databaseName,
            fileName: consumeFileName,
            sitecoreContextId: contextId,
          },
        },
      });
      const resAny = res?.data as unknown as
        | { error?: { Message?: string } }
        | undefined;
      if (resAny?.error) {
        const msg = resAny.error.Message ?? JSON.stringify(resAny.error);
        return {
          ok: false,
          notReady: msg.toLowerCase().includes("does not exist"),
          error: resAny.error,
        };
      }
      return { ok: true };
    },

    async getBlobState(fileName) {
      // NOTE: `fileName` must be the RAW blob name, WITHOUT a "blob://"
      // prefix — the Item Transfer API addresses blob sources by their plain
      // name everywhere (GET /sources/blobs/{blobName}); the scheme prefix is
      // only understood by consumeFile.
      const res = await client.query("xmc.contentTransfer.getBlobState", {
        params: {
          query: { fileName, sitecoreContextId: contextId },
        },
      });
      const rawRes = res?.data as unknown;
      return (rawRes as { data?: BlobStateResponse })?.data ?? null;
    },

    async deleteContentTransfer(transferId) {
      await client.mutate("xmc.contentTransfer.deleteContentTransfer", {
        params: {
          path: { transferId },
          query: { sitecoreContextId: contextId },
        },
      });
    },
  };

  return {
    contentTransfer,
    async graphql<T>(query: string, variables?: Record<string, unknown>) {
      const res = await client.mutate("xmc.authoring.graphql", {
        params: {
          body: { query, variables },
          query: { sitecoreContextId: contextId },
        },
      });
      const resAny = res as unknown as { data?: unknown; error?: unknown };
      if (resAny.error || !resAny.data) {
        throw new Error(
          typeof resAny.error === "string"
            ? resAny.error
            : JSON.stringify(resAny.error ?? "GraphQL request failed"),
        );
      }
      return resAny.data as GraphQLEnvelope<T>;
    },
  };
}
