import type {
  BlobStateResponse,
  ContentTransferStatus,
  DataTreeItem,
} from "@/lib/content-transfer";

// Shared low-level abstraction over "however we talk to one SitecoreAI
// environment" — implemented once for the Marketplace SDK's PostMessage
// bridge (`marketplace-client.ts`) and once for a direct-fetch local Docker
// instance (`local-docker-client.ts`). A given EnvironmentClient instance is
// bound to exactly one environment (source XOR destination) at construction
// time, which is what lets a single transfer/backup/restore mix transport
// kinds on each side (e.g. cloud source → local Docker destination).

export interface GraphQLError {
  message?: string;
  path?: Array<string | number>;
}

/** The GraphQL HTTP envelope — `data` is the query's top-level selection,
 *  `errors` may be present even when `data` is partially populated (Sitecore
 *  null-propagates individual broken nodes rather than failing the request). */
export interface GraphQLEnvelope<T> {
  data: T | null;
  errors?: GraphQLError[];
}

export type SaveChunkResult =
  | { ok: true }
  | { ok: false; httpStatus?: number; error: unknown };

export type ConsumeFileResult =
  | { ok: true }
  | { ok: false; notReady: boolean; error: unknown };

export interface ContentTransferTransport {
  createContentTransfer(
    transferId: string,
    dataTrees: DataTreeItem[],
  ): Promise<void>;
  getContentTransferStatus(
    transferId: string,
  ): Promise<ContentTransferStatus | null>;
  getChunk(
    transferId: string,
    chunksetId: string,
    chunkId: number,
  ): Promise<Blob | null>;
  saveChunk(
    transferId: string,
    chunksetId: string,
    chunkId: number,
    body: Blob,
    isMedia: boolean,
  ): Promise<SaveChunkResult>;
  /** Returns the assembled .raif file name. */
  completeChunkSet(transferId: string, chunksetId: string): Promise<string>;
  /** `fileName` is the RAW blob name, without any scheme prefix — each
   *  implementation adds its own addressing prefix internally. */
  consumeFile(
    fileName: string,
    databaseName: string,
  ): Promise<ConsumeFileResult>;
  getBlobState(fileName: string): Promise<BlobStateResponse | null>;
  deleteContentTransfer(transferId: string): Promise<void>;
}

export interface EnvironmentClient {
  graphql<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<GraphQLEnvelope<T>>;
  contentTransfer: ContentTransferTransport;
}
