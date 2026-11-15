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
