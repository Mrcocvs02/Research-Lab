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
  /** Content hash (SHA-256) of the bytes the text was actually extracted from (not the caller's hash); the cache key. */
  hash?: string;
  /** True when the caller passed `options.hash` and the file read has a different one: the file changed since; store `hash`. */
  hashMismatch?: boolean;
  /** True when the text came from the cache. */
  fromCache?: boolean;
}

export interface ExtractOptions {
  maxPages?: number;
  signal?: AbortSignal;
  /** Content hash when the caller already knows it: allows a cache hit without reading the file. */
  hash?: string;
  /**
   * Progress signal for a watchdog (PDF only): `(0, total)` when the document is open, then `(page, total)` after each
   * page. A supervisor that gets no signal for N seconds can kill the thread running the extraction.
   */
  onPage?: (page: number, total: number) => void;
}

/** The extracted text is DATA: nothing in it is ever interpreted as an instruction. */
export interface TextExtractor {
  /** `path` is relative to the root; the implementation resolves it with confinement. */
  extract(rootPath: string, path: RelativePath, options?: ExtractOptions): Promise<ExtractedText>;
}

/* ---------------------------- Search ----------------------------- */

export interface SearchFilters {
  /** Taxonomy node ids; a document must carry ALL of them. */
  tags?: string[];
  /** Author display names (case/accent-insensitive, exact); a document must have ALL of them. */
  authors?: string[];
  /** Document type ids or labels; ANY of them. */
  types?: string[];
  /** Venue names (exact, case/accent-insensitive); ANY of them. */
  venues?: string[];
  studyStates?: Array<'to-read' | 'reading' | 'read'>;
  /** Folders relative to the library root; a document inside any of them (sub-folders included). */
  folders?: RelativePath[];
  yearFrom?: number;
  yearTo?: number;
}

export type SearchSort = 'relevance' | 'title' | 'year-desc' | 'year-asc' | 'added-desc' | 'author';

export interface SearchQuery {
  /**
   * Free text. Words (all must match), "quoted phrases", `prefix*`, `a OR b`, and the filters
   * `author:`, `tag:`, `type:`, `year:` (2020, 2018-2022, >=2020), `venue:`. Never a syntax error.
   */
  text: string;
  filters?: SearchFilters;
  /** Default `relevance` (`title` when the text is empty). */
  sort?: SearchSort;
  limit?: number;
  offset?: number;
}

/** A page of the document where the query matched. */
export interface SearchPageHit {
  page: number;
  /** Snippet with match markers `[[...]]`. */
  snippet: string;
}

export interface SearchHit {
  docId: DocumentId;
  score: number;
  /** Where it matched. */
  field: 'title' | 'summary' | 'note' | 'annotation' | 'text';
  /** Short snippet with match markers `[[...]]`; may be empty. */
  snippet: string;
  /** Best matching page of the full text. */
  page?: number;
  /** Matching pages of the full text (best first, at most 8), for `lab://doc/<id>?page=N` links. */
  pages?: SearchPageHit[];
}

/** A hit with the data needed to show it. */
export interface SearchResultHit extends SearchHit {
  title: string | null;
  authors: string[];
  year: number | null;
  type: string | null;
  path: RelativePath;
  studyState: 'to-read' | 'reading' | 'read';
}

export interface SearchResultPage {
  /** Number of matching documents (all pages of results). */
  total: number;
  hits: SearchResultHit[];
}

export interface FacetBucket {
  /** Filter value: tag id, author name, type, venue, study state, year (as text) or top-level folder. */
  value: string;
  count: number;
}

export interface SearchFacets {
  total: number;
  tags: FacetBucket[];
  authors: FacetBucket[];
  types: FacetBucket[];
  venues: FacetBucket[];
  studyStates: FacetBucket[];
  years: FacetBucket[];
  folders: FacetBucket[];
}

/** A row of the document list. */
export interface DocumentSummary {
  docId: DocumentId;
  title: string | null;
  authors: string[];
  year: number | null;
  type: string | null;
  venue: string | null;
  path: RelativePath;
  studyState: 'to-read' | 'reading' | 'read';
  tags: string[];
  addedAt: string;
  missing: boolean;
}

export interface DocumentListQuery {
  filters?: SearchFilters;
  sort?: Exclude<SearchSort, 'relevance'>;
  limit?: number;
  offset?: number;
}

export interface IndexableDocument {
  record: DocumentRecord;
  /**
   * Extracted full text per page. `undefined` keeps the pages already indexed; `[]` removes them.
   */
  pages?: Array<{ page: number; text: string }>;
  /** Abstract or summary text (the record has none of its own: callers pass `ai.summary`, an extracted abstract, ...). */
  abstract?: string;
  /** Keywords and synonyms. */
  keywords?: string[];
  /** `undefined` keeps what is indexed. */
  notes?: string;
  annotations?: string;
  /** Searchable words of each tag id (label and aliases), so "tag with alias" finds the document. */
  tagTerms?: Record<string, string[]>;
  /** Human label of `record.type`, searchable and usable in `type:`. */
  typeLabel?: string;
  /** Venue name when `record.ref.venue` is empty (resolved from the taxonomy). */
  venueName?: string;
  /** Hash of the file the pages come from (default `record.hash`); see `indexedState`. */
  textHash?: string;
}

/** Local, rebuildable SQLite FTS5 index (node:sqlite, see D-007). */
export interface SearchIndex {
  open(dbPath: string): Promise<void>;
  /** True when `open` created the file or found another schema version: the caller must refill it. */
  readonly needsRebuild: boolean;
  upsert(doc: IndexableDocument): Promise<void>;
  /** One transaction for the whole batch. */
  upsertMany(docs: IndexableDocument[]): Promise<void>;
  remove(docId: DocumentId): Promise<void>;
  search(query: SearchQuery): Promise<SearchResultHit[]>;
  searchPage(query: SearchQuery): Promise<SearchResultPage>;
  facets(query: SearchQuery): Promise<SearchFacets>;
  list(query: DocumentListQuery): Promise<{ total: number; items: DocumentSummary[] }>;
  /**
   * What is indexed for each document: the hash of the file its text comes from (null: metadata only) and a
   * stamp of the record version (`<revision>:<updatedAt>`), to find documents whose index entry is stale.
   */
  indexedState(): Promise<Map<DocumentId, { textHash: string | null; stamp: string }>>;
  /** Drops and recreates everything. */
  reset(): Promise<void>;
  count(): Promise<number>;
  close(): Promise<void>;
}
