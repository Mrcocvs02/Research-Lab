import type { ExtractedMeta, IndexableDocument, ScanOptions, ScanProgress, ScanResult } from '@rl/core';

/**
 * The heavy work of a library (walking and hashing the files, extracting PDF text, writing the search
 * index) runs in a worker thread so that the main process stays responsive. This is the API of that worker;
 * `worker-service.ts` implements it, `worker-client.ts` proxies it across the thread boundary, and tests
 * call the implementation directly.
 */

export interface ScanArgs {
  rootPath: string;
  /** The worker opens its own store: the scanner writes the records (`documents.update`), only inside the data dir. */
  dataDir: string;
  deviceId: string;
  config: ScanOptions['config'];
  /** Scan only these paths (watcher batches); default the whole root. */
  paths?: string[];
  /** False for the first scan of a library, so that nothing lands in the inbox. */
  markInbox: boolean;
}

export interface ExtractItem {
  /** Relative to the library root. */
  path: string;
  /** SHA-256 of the file (the cache key). */
  hash: string;
}

export interface ExtractArgs {
  rootPath: string;
  /** Text cache (`<localData>/cache/text`), managed by the extractor. */
  cacheDir: string;
  items: ExtractItem[];
}

export interface ExtractResult {
  path: string;
  hash: string;
  ok: boolean;
  /** The cache already had it. */
  cached: boolean;
  meta?: ExtractedMeta;
  hasText?: boolean;
  /** Short message, never document text. */
  error?: string;
}

/** What to do with the text of a document when indexing it. */
export type TextMode =
  /** Get the pages from the extractor (served by its cache, by `record.hash`); when that fails keep what is indexed. */
  | 'cache'
  /** The text could not be had (failed extraction, no text layer): index the metadata and remember it. */
  | 'empty'
  /** Leave the indexed pages as they are. */
  | 'keep';

export interface IndexJob {
  doc: Omit<IndexableDocument, 'pages'>;
  text: TextMode;
}

export interface WorkerHooks<P> {
  onEvent?(event: P): void;
  signal?: AbortSignal;
}

export interface LibraryWorker {
  /** Opens the writing connection to the search index (the main process has its own, read-only use). */
  openIndex(dbPath: string): Promise<void>;
  resetIndex(): Promise<void>;
  scan(args: ScanArgs, hooks?: WorkerHooks<ScanProgress>): Promise<ScanResult>;
  /** Extracts the text of each item into the cache, reporting each one as it finishes. */
  extract(args: ExtractArgs, hooks?: WorkerHooks<ExtractResult>): Promise<void>;
  index(args: { rootPath: string; cacheDir: string; jobs: IndexJob[] }): Promise<void>;
  remove(docIds: string[]): Promise<void>;
  dispose(): Promise<void>;
}

/** Messages over the thread boundary. */
export type ToWorker =
  | { id: number; op: Exclude<keyof LibraryWorker, 'dispose'> | 'dispose'; args: unknown }
  | { id: number; op: 'abort' };

export type FromWorker =
  | { id: number; type: 'event'; event: unknown }
  | { id: number; type: 'result'; value: unknown }
  | { id: number; type: 'error'; code: string; message: string; aborted: boolean };
