import type { DocumentId, RelativePath } from '../common.js';
import type { DocumentRecord } from '../model/document.js';
import type { LibraryConfig } from '../settings.js';

/* ---------------------------- Scanner ---------------------------- */

export interface ScannedFile {
  path: RelativePath;
  size: number;
  mtimeMs: number;
  /** SHA-256 hex; present when the scanner had to (re)hash the file. */
  hash?: string;
}

export interface ScanResult {
  added: ScannedFile[];
  /** Known path, different hash. */
  changed: Array<{ docId: DocumentId; file: ScannedFile }>;
  /** Known hash at a new path. */
  moved: Array<{ docId: DocumentId; from: RelativePath; file: ScannedFile }>;
  /** Known documents whose file is gone. */
  missing: DocumentId[];
  unchanged: number;
}

export interface ScanProgress {
  phase: 'walking' | 'hashing' | 'done';
  seen: number;
  total?: number;
}

export interface ScanOptions {
  config: Pick<LibraryConfig, 'excludedFolders' | 'scan'>;
  /** Known records, to skip re-hashing unchanged files (same size + mtime). */
  known: DocumentRecord[];
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

export interface ExtractedText {
  pages: ExtractedPage[];
  /** Metadata found in the file itself (PDF info, first-page heuristics). */
  meta: { title?: string; authors?: string[]; doi?: string; arxivId?: string; year?: number; pageCount: number };
  /** True when no text layer was found (scanned PDF); OCR is out of scope. */
  noTextLayer: boolean;
}

export interface TextExtractor {
  /** `path` is relative to the root; the implementation resolves it with confinement. */
  extract(rootPath: string, path: RelativePath, options?: { maxPages?: number; signal?: AbortSignal }): Promise<ExtractedText>;
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
