import type { QuoteOutcome, QuoteQuery } from '@rl/data';
import type { DocumentRecord, ExtractedMeta, IndexableDocument, ScanOptions, ScanProgress, ScanResult } from '@rl/core';

/**
 * The heavy work of a library (walking and hashing the files, extracting PDF text, writing the search
 * index) runs in a worker thread so that the main process stays responsive. This is the API of that worker;
 * `worker-service.ts` implements it, `worker-transport.ts` proxies it across the thread boundary,
 * `supervised-worker.ts` watches it (watchdog, respawn) and tests call the implementation directly.
 */

export interface ScanArgs {
  rootPath: string;
  /** The worker reads the records from its own store connection; it never writes them (see `RecordHost`). */
  dataDir: string;
  deviceId: string;
  config: ScanOptions['config'];
  /** Scan only these paths (watcher batches); default the whole root. */
  paths?: string[];
  /** False for the first scan of a library, so that nothing lands in the inbox. */
  markInbox: boolean;
}

/**
 * Callbacks the worker makes into the main process during a call. The main thread is the only writer of the
 * records in `.lab/documents` (D-072): the scanner decides what a record becomes, the main thread writes it.
 */
export interface RecordHost {
  /**
   * Compare-and-put of one record: written only when the stored revision is still `expectedRevision`
   * (`null`: the record must not exist yet, `'any'`: no check). A `conflict` makes the caller re-read and retry.
   */
  commit(args: { id: string; expectedRevision: number | null | 'any'; record: DocumentRecord }): Promise<{ ok: true; record: DocumentRecord } | { ok: false; reason: 'conflict' }>;
}

/**
 * Recomputes the rectangles of the annotations of ONE PDF from their quoted text, without drawing (D-373). One file per
 * call, like `extract`: the PDF is only read; the caller writes the annotation store.
 */
export interface RepairArgs {
  rootPath: string;
  /** Relative to the library root. */
  path: string;
  queries: QuoteQuery[];
}

export interface ExtractItem {
  /** Relative to the library root. */
  path: string;
  /** SHA-256 of the content (the cache key): `contentHashOf` the record. */
  hash: string;
  /** Set when the file carries annotations we appended: the text belongs to this content, not to the file's bytes. */
  contentHash?: string;
}

/** One file per call: the main process watches each call (watchdog) and moves on to the next file. */
export interface ExtractArgs {
  rootPath: string;
  /** Text cache (`<localData>/cache/text`), managed by the extractor. */
  cacheDir: string;
  item: ExtractItem;
}

/** Progress signal of an extraction (one per page when the extractor reports pages): resets the watchdog. */
export interface ExtractProgress {
  page: number;
}

export interface ExtractResult {
  path: string;
  hash: string;
  ok: boolean;
  /** The cache already had it. */
  cached: boolean;
  /** SHA-256 of the content the text was read from (the extractor reports it; `hash` when it does not). */
  readHash?: string;
  meta?: ExtractedMeta;
  hasText?: boolean;
  /** Failures only: true when retrying cannot help (malformed, encrypted, too large, timeout, crash). */
  permanent?: boolean;
  /** Failures only: machine-readable reason (`details.reason` of the extractor's error, `timeout`, `crash`). */
  reason?: string;
  /** Short message (code and reason), never document text. */
  error?: string;
}

/** What to do with the text of a document when indexing it. */
export type TextMode =
  /** Get the pages from the extractor (served by its cache, by the hash); when that fails keep what is indexed. */
  | 'cache'
  /** The text cannot be had (permanent failure, no text layer): index the metadata and remember it. */
  | 'empty'
  /** Leave the indexed pages as they are (and do not mark the text as done: a transient failure is retried). */
  | 'keep';

export interface IndexJob {
  doc: Omit<IndexableDocument, 'pages'>;
  text: TextMode;
  /** Hash of the content the text comes from (`record.hash` when omitted); stored as the document's `textHash`. */
  hash?: string;
}

export interface WorkerHooks<P> {
  onEvent?(event: P): void;
  signal?: AbortSignal;
  /** Main-process callbacks for the call (only `scan` uses them). */
  host?: RecordHost;
}

export interface LibraryWorker {
  /** Opens the writing connection to the search index (the main process has its own, read-only use). */
  openIndex(dbPath: string): Promise<void>;
  resetIndex(): Promise<void>;
  scan(args: ScanArgs, hooks?: WorkerHooks<ScanProgress>): Promise<ScanResult>;
  /** Extracts the text of one file into the cache. Never throws for a bad file: the failure is in the result. */
  extract(args: ExtractArgs, hooks?: WorkerHooks<ExtractProgress>): Promise<ExtractResult>;
  /** One outcome per query, in order. Throws `AppError` for an unreadable file; one `ExtractProgress` event per page read. */
  repairAnnotations(args: RepairArgs, hooks?: WorkerHooks<ExtractProgress>): Promise<QuoteOutcome[]>;
  index(args: { rootPath: string; cacheDir: string; jobs: IndexJob[] }): Promise<void>;
  remove(docIds: string[]): Promise<void>;
  dispose(): Promise<void>;
  /** Kills the worker thread at once (supervised workers); pending calls fail. Absent in the in-process service. */
  terminate?(): Promise<void>;
  /** Whether the worker thread is alive right now (supervised workers close after an idle time). Absent in the in-process service. */
  alive?(): boolean;
}

type Op = 'openIndex' | 'resetIndex' | 'scan' | 'extract' | 'repairAnnotations' | 'index' | 'remove' | 'dispose';

/** Messages over the thread boundary. */
export type ToWorker =
  | { id: number; op: Op; args: unknown }
  | { id: number; op: 'abort' }
  | { id: number; op: 'hostReply'; callId: number; ok: boolean; value?: unknown };

export type FromWorker =
  | { id: number; type: 'event'; event: unknown }
  | { id: number; type: 'result'; value: unknown }
  | { id: number; type: 'error'; code: string; message: string; aborted: boolean }
  | { id: number; type: 'host'; callId: number; method: 'commit'; args: unknown };
