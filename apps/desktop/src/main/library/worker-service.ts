import { AppError, type DocumentRecord, type ExtractOptions, type LibraryStore, type ScanProgress, type Scanner, type SearchIndex, type TextExtractor } from '@rl/core';
import type { ExtractArgs, ExtractProgress, ExtractResult, IndexJob, LibraryWorker, RecordHost, ScanArgs, WorkerHooks } from './worker-protocol.js';

export interface WorkerDeps {
  createScanner(): Scanner;
  createTextExtractor(options: { cacheDir: string }): TextExtractor;
  createIndex(): SearchIndex;
  /** The worker's own store connection: the scanner reads the records through it (writes go to the main process). */
  createStore(options: { rootPath: string; dataDir: string; deviceId: string }): LibraryStore;
}

/**
 * Short, document-free description of an error: its code and, for typed errors, the machine-readable reason.
 * Never a message (those can carry paths or text of the document).
 */
function describe(e: unknown): string {
  if (e instanceof AppError) {
    const reason = typeof e.details?.['reason'] === 'string' ? ` (${e.details['reason']})` : '';
    return `${e.code}${reason}`.slice(0, 120);
  }
  const code = typeof (e as { code?: unknown } | null)?.code === 'string' ? ` ${(e as { code: string }).code}` : '';
  return `unexpected error${code}`.slice(0, 120);
}

const reasonOf = (e: unknown): string | undefined => (e instanceof AppError && typeof e.details?.['reason'] === 'string' ? e.details['reason'] : undefined);

/** Reasons of the extractor's typed errors for which a retry cannot help while the file stays the same. */
const PERMANENT_REASONS = new Set(['malformed', 'encrypted', 'too-large', 'timeout', 'unsupported', 'crash']);

/**
 * Permanent (a retry cannot help until the file changes) or transient (locked file, cloud file not yet
 * downloaded, I/O hiccup)? The extractor may say so itself with `details.permanent`; otherwise its typed reasons
 * decide. Anything unclassified counts as transient: it costs a retry, never a document left without text.
 */
export function isPermanentFailure(e: unknown): boolean {
  if (!(e instanceof AppError)) return false;
  const flag = e.details?.['permanent'];
  if (typeof flag === 'boolean') return flag;
  const reason = reasonOf(e);
  if (reason !== undefined) return PERMANENT_REASONS.has(reason);
  return e.code === 'INVALID_REQUEST';
}

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
const MAX_COMMIT_ATTEMPTS = 8;

/**
 * The scanner's view of the store inside the worker: reads come from the worker's own connection, every write
 * is a compare-and-put in the main process (`RecordHost`), so that one thread, one queue, writes the records.
 */
export function storeThroughHost(real: LibraryStore, host: RecordHost): Pick<LibraryStore, 'dataDir' | 'documents'> {
  const documents: LibraryStore['documents'] = {
    ...real.documents,
    async put(item, options) {
      const r = await host.commit({ id: item.id, expectedRevision: options?.expectedRevision ?? 'any', record: item });
      if (!r.ok) throw new AppError('ALREADY_EXISTS', 'The record changed meanwhile', { conflict: 'revision' });
      return r.record;
    },
    async update(id, fn) {
      for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
        const cur = await real.documents.get(id);
        const next = await fn(cur);
        const r = await host.commit({ id, expectedRevision: cur ? cur.revision : null, record: next });
        if (r.ok) return r.record;
      }
      throw new AppError('ALREADY_EXISTS', 'The record kept changing during the update', { conflict: 'revision' });
    },
  };
  return { dataDir: real.dataDir, documents };
}

/**
 * The worker side of the library runtime. It runs in a worker thread in the app (`scan-worker.ts`) and
 * in-process in tests. It never modifies the library files: the scanner decides the records and the main
 * process writes them, the extractor writes the text cache and this service writes the search index (both
 * machine-local).
 */
export function createWorkerService(deps: WorkerDeps): LibraryWorker {
  let index: SearchIndex | null = null;
  let scanner: Scanner | null = null;
  const extractors = new Map<string, TextExtractor>();
  const extractorFor = (cacheDir: string) => {
    let e = extractors.get(cacheDir);
    if (!e) extractors.set(cacheDir, (e = deps.createTextExtractor({ cacheDir })));
    return e;
  };
  const ensureIndex = (): SearchIndex => {
    if (!index) throw new AppError('INVALID_REQUEST', 'The index is not open');
    return index;
  };

  return {
    async openIndex(dbPath) {
      await index?.close();
      index = deps.createIndex();
      await index.open(dbPath);
    },

    async resetIndex() {
      await ensureIndex().reset();
    },

    async scan(args: ScanArgs, hooks: WorkerHooks<ScanProgress> = {}) {
      scanner ??= deps.createScanner();
      const real = deps.createStore({ rootPath: args.rootPath, dataDir: args.dataDir, deviceId: args.deviceId });
      const store = hooks.host ? storeThroughHost(real, hooks.host) : real;
      return scanner.scan(args.rootPath, {
        config: args.config,
        store,
        paths: args.paths,
        markInbox: args.markInbox,
        onProgress: (p) => hooks.onEvent?.(p),
        signal: hooks.signal,
      });
    },

    async extract({ rootPath, cacheDir, item }: ExtractArgs, hooks: WorkerHooks<ExtractProgress> = {}): Promise<ExtractResult> {
      if (hooks.signal?.aborted) throw abortError();
      const extractor = extractorFor(cacheDir);
      try {
        // `onPage` is optional on the extractor: when it reports pages, each one is a sign of life for the watchdog.
        const options: ExtractOptions & { onPage?: (info: { page?: number }) => void } = {
          hash: item.hash,
          signal: hooks.signal,
          onPage: (info) => hooks.onEvent?.({ page: info?.page ?? 0 }),
        };
        const text = await extractor.extract(rootPath, item.path, options);
        return { path: item.path, hash: item.hash, ok: true, cached: Boolean(text.fromCache), readHash: text.hash ?? item.hash, meta: text.meta, hasText: text.hasText };
      } catch (e) {
        if (hooks.signal?.aborted) throw e;
        // One bad file must not stop the run: report it and go on.
        const reason = reasonOf(e);
        return { path: item.path, hash: item.hash, ok: false, cached: false, permanent: isPermanentFailure(e), ...(reason ? { reason } : {}), error: describe(e) };
      }
    },

    async index({ rootPath, cacheDir, jobs }: { rootPath: string; cacheDir: string; jobs: IndexJob[] }) {
      const idx = ensureIndex();
      const docs = [];
      for (const job of jobs) {
        const base = { ...job.doc };
        const rec: DocumentRecord = job.doc.record;
        const hash = job.hash ?? rec.hash;
        if (job.text === 'empty') {
          docs.push({ ...base, pages: [], textHash: hash });
        } else if (job.text === 'cache' && !rec.missing) {
          try {
            const text = await extractorFor(cacheDir).extract(rootPath, rec.path, { hash });
            docs.push({ ...base, pages: text.pages, textHash: text.hash ?? hash, abstract: base.abstract || text.meta.abstract || '' });
          } catch {
            docs.push(base);
          }
        } else {
          docs.push(base);
        }
      }
      await idx.upsertMany(docs);
    },

    async remove(docIds) {
      const idx = ensureIndex();
      for (const id of docIds) await idx.remove(id);
    },

    async dispose() {
      await index?.close();
      index = null;
    },
  };
}
