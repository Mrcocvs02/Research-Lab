import type { DocumentId, RelativePath } from '../common.js';
import type { DocumentRecord } from '../model/document.js';
import type { LibraryConfig } from '../settings.js';
import type { LibraryStore } from './library-store.js';

/* ---------------------------- Scanner ---------------------------- */

export interface ScannedFile {
  path: RelativePath;
  size: number;
  mtimeMs: number;
  /** SHA-256 hex; present when the scanner had to (re)hash the file. */
  hash?: string;
  /** Id of the record the file belongs to (set once the scanner has written it). */
  docId?: DocumentId;
}

export interface ScanError {
  /** Relative path of the file or folder (clipped), never an absolute path. */
  path: string;
  reason: string;
}

export interface ScanResult {
  /** New documents (a record was created for each). */
  added: ScannedFile[];
  /** Known path, different hash (the id is stable, the old hash goes to `previousHashes`). */
  changed: Array<{ docId: DocumentId; file: ScannedFile }>;
  /** Known hash at a new path (renamed or moved; the old path goes to `pathHistory`). */
  moved: Array<{ docId: DocumentId; from: RelativePath; file: ScannedFile }>;
  /** Known documents whose file is gone (`missing: true`; records are never deleted). */
  missing: DocumentId[];
  /** Known hash at a new path while the old one still exists: the path went to `aliasPaths` (D-032). */
  duplicates: Array<{ docId: DocumentId; path: RelativePath }>;
  /** Files seen again after having been marked missing. */
  restored: DocumentId[];
  unchanged: number;
  /** Files or folders that could not be read; the scan goes on without them. */
  errors: ScanError[];
  /** True when the scan was aborted: the counts cover only what was done. */
  cancelled: boolean;
}

export interface ScanProgress {
  phase: 'walking' | 'hashing' | 'writing' | 'done';
  seen: number;
  total?: number;
}

export interface ScanOptions {
  config: Pick<LibraryConfig, 'excludedFolders' | 'scan'>;
  /** The library's store: the only place the scanner writes to (via `documents.update`, which is serialised). */
  store: Pick<LibraryStore, 'dataDir' | 'documents'>;
  /** Known records; read from the store when omitted. Used to skip re-hashing unchanged files (same size + mtime). */
  known?: DocumentRecord[];
  /** Scan only these paths (files or folders, relative to the root), e.g. a batch from the watcher. Default: the whole root. */
  paths?: RelativePath[];
  /** Descend into folders whose name starts with a dot (default false). The data dir is always skipped. */
  includeHiddenFolders?: boolean;
  /** Flag new and changed documents for the inbox (`inbox` field; default true). Pass false for a first scan of a big folder. */
  markInbox?: boolean;
  onProgress?: (p: ScanProgress) => void;
  signal?: AbortSignal;
}

/** Walks the library root read-only. Never modifies originals. */
export interface Scanner {
  scan(rootPath: string, options: ScanOptions): Promise<ScanResult>;
}

/* ------------------------- Text extraction ------------------------- */

export interface ExtractedPage {
  page: number;
  text: string;
}

export interface ExtractedMeta {
  title?: string;
  authors?: string[];
  doi?: string;
  arxivId?: string;
  /** Version of the arXiv id when present (e.g. `2` for `v2`); `arxivId` itself is without version. */
  arxivVersion?: number;
  year?: number;
  abstract?: string;
  pageCount: number;
  /** Every DOI / arXiv id found in the text (first pages first, deduplicated, capped), for matching and checks. */
  doiCandidates?: string[];
  arxivCandidates?: string[];
}

export interface ExtractedText {
  pages: ExtractedPage[];
  /** Metadata found in the file itself (PDF info, first-page heuristics). Heuristic guesses, never verified. */
  meta: ExtractedMeta;
  /** True when no text layer was found (scanned PDF); OCR is out of scope. */
  noTextLayer: boolean;
  /** Whether any text was extracted (`false` for a scanned PDF). */
  hasText: boolean;
  /** Signal for the UI: the file looks scanned and would need OCR (never done by the app). */
  needsOcr: boolean;
  format: 'pdf' | 'text' | 'markdown' | 'latex' | 'rst' | 'code' | 'csv' | 'notebook' | 'docx' | 'pptx';
  /** True when a limit (pages, characters) cut the text. */
  truncated: boolean;
  /** Content hash (SHA-256) of the file the text comes from; the cache key. */
  hash?: string;
  /** True when the text came from the cache. */
  fromCache?: boolean;
}

export interface ExtractOptions {
  maxPages?: number;
  signal?: AbortSignal;
  /** Content hash when the caller already knows it: allows a cache hit without reading the file. */
  hash?: string;
}

/** The extracted text is DATA: nothing in it is ever interpreted as an instruction. */
export interface TextExtractor {
  /** `path` is relative to the root; the implementation resolves it with confinement. */
  extract(rootPath: string, path: RelativePath, options?: ExtractOptions): Promise<ExtractedText>;
}

/* ---------------------------- Search ----------------------------- */

export interface SearchFilters {
  tags?: string[];
  authors?: string[];
  types?: string[];
  venues?: string[];
  studyStates?: Array<'to-read' | 'reading' | 'read'>;
  folders?: RelativePath[];
  yearFrom?: number;
  yearTo?: number;
}

export interface SearchQuery {
  text: string;
  filters?: SearchFilters;
  limit?: number;
  offset?: number;
}

export interface SearchHit {
  docId: DocumentId;
  score: number;
  /** Where it matched. */
  field: 'title' | 'summary' | 'note' | 'annotation' | 'text';
  /** Short snippet with match markers `[[...]]`; may be empty. */
  snippet: string;
  page?: number;
}

export interface IndexableDocument {
  record: DocumentRecord;
  /** Extracted full text per page (optional: may be indexed later). */
  pages?: Array<{ page: number; text: string }>;
  notes?: string;
  annotations?: string;
}

/** Local, rebuildable SQLite FTS5 index (node:sqlite, see D-007). */
export interface SearchIndex {
  open(dbPath: string): Promise<void>;
  upsert(doc: IndexableDocument): Promise<void>;
  remove(docId: DocumentId): Promise<void>;
  search(query: SearchQuery): Promise<SearchHit[]>;
  /** Drops and recreates everything. */
  reset(): Promise<void>;
  count(): Promise<number>;
  close(): Promise<void>;
}
