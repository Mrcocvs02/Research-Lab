import type { DocumentId, RelativePath } from '../common.js';
import type { CitationFile, CitationLink } from '../model/citation.js';
import type { DocumentRecord } from '../model/document.js';
import type { ExportPreset } from '../settings.js';

/* --------------------------- Citations --------------------------- */

export interface WorkRef {
  doi?: string;
  arxivId?: string;
  title?: string;
  authors?: string[];
  year?: number;
}

export interface WorkMetadata extends WorkRef {
  venue?: string;
  venueRef?: string;
  publicationStatus?: 'preprint' | 'published';
  source: CitationLink['source'];
}

/** External source of citations/metadata (OpenAlex, arXiv, Semantic Scholar). Network is optional. */
export interface CitationSource {
  readonly id: CitationLink['source'];
  lookup(ref: WorkRef, signal?: AbortSignal): Promise<WorkMetadata | null>;
  fetchReferences(ref: WorkRef, signal?: AbortSignal): Promise<CitationLink[]>;
  fetchCitedBy(ref: WorkRef, signal?: AbortSignal): Promise<CitationLink[]>;
}

export interface CitationService {
  /** Refreshes the citation file of a document across sources, matching links to owned documents. */
  refresh(doc: DocumentRecord, owned: DocumentRecord[], signal?: AbortSignal): Promise<CitationFile>;
}

/* ------------------------------ Graph ---------------------------- */

export interface SimilarDocument {
  docId: DocumentId;
  score: number;
  /** Why they are close: shared tags / shared citations / text similarity. */
  reasons: Array<'text' | 'citations' | 'tags'>;
}

export interface ClusterNode {
  id: string;
  /** Human label (possibly AI-generated, stored separately). */
  label?: string;
  members: DocumentId[];
  children: ClusterNode[];
}

export interface LayoutPoint {
  docId: DocumentId;
  x: number;
  y: number;
}

/** Local similarity, clustering and layout (TF-IDF, shared citations, tags). No network, no AI. */
export interface GraphService {
  similar(docId: DocumentId, limit?: number): Promise<SimilarDocument[]>;
  cluster(options?: { seed?: number; levels?: number }): Promise<ClusterNode>;
  layout(options?: { seed?: number }): Promise<LayoutPoint[]>;
  /** Neighbours of a node for the expandable network view. */
  neighbors(nodeId: string): Promise<Array<{ id: string; kind: 'document' | 'tag' | 'author' | 'venue'; weight: number }>>;
}

/* ----------------------------- Export ---------------------------- */

export interface ExportSelection {
  projectId?: string;
  folders?: RelativePath[];
  tagIds?: string[];
  docIds?: DocumentId[];
  preset: ExportPreset;
}

export interface ExportEstimate {
  files: number;
  approxTokens: number;
  indexTokens: number;
}

export interface Exporter {
  estimate(selection: ExportSelection): Promise<ExportEstimate>;
  /** `destinationDir` is an absolute folder chosen by the user through the main-process dialog. */
  export(selection: ExportSelection, destinationDir: string): Promise<{ written: string[] }>;
}

/* ------------------------------- MCP ----------------------------- */

export interface McpServerOptions {
  /** Always loopback. */
  host: '127.0.0.1';
  /** 0 = pick a free port. */
  port: number;
  /** Random bearer token required on every request. */
  token: string;
  writeEnabled: boolean;
}

export interface McpServerHandle {
  readonly url: string;
  readonly port: number;
  stop(): Promise<void>;
}

export interface McpServerService {
  start(options: McpServerOptions): Promise<McpServerHandle>;
}

/* ----------------------------- Secrets --------------------------- */

export type SecretScope = { kind: 'app' } | { kind: 'library'; libraryId: string };

/**
 * OS-backed secret store (Electron safeStorage). `get` exists only for main-process code;
 * no IPC channel ever returns a secret value.
 */
export interface SecretStore {
  set(scope: SecretScope, name: string, value: string): Promise<void>;
  get(scope: SecretScope, name: string): Promise<string | null>;
  has(scope: SecretScope, name: string): Promise<boolean>;
  delete(scope: SecretScope, name: string): Promise<void>;
}
