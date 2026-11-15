import { AppError, type LibraryStore, type ScanProgress, type Scanner, type SearchIndex, type TextExtractor } from '@rl/core';
import type { ExtractArgs, ExtractResult, IndexJob, LibraryWorker, ScanArgs, WorkerHooks } from './worker-protocol.js';

export interface WorkerDeps {
  createScanner(): Scanner;
  createTextExtractor(options: { cacheDir: string }): TextExtractor;
  createIndex(): SearchIndex;
  /** The worker's own store connection, for the scanner (which writes the records it finds). */
  createStore(options: { rootPath: string; dataDir: string; deviceId: string }): LibraryStore;
}

/** Short, document-free description of an error (these messages travel to logs and status). */
function describe(e: unknown): string {
  if (e instanceof AppError) {
    const reason = typeof e.details?.['reason'] === 'string' ? ` (${e.details['reason']})` : '';
    return `${e.code}: ${e.message}${reason}`.slice(0, 300);
  }
  return e instanceof Error ? e.message.slice(0, 200) : 'unknown error';
}

/**
 * The worker side of the library runtime. It runs in a worker thread in the app (`scan-worker.ts`) and
 * in-process in tests. It never modifies the library files: the scanner writes records into the data folder,
 * the extractor writes the text cache and this service writes the search index (both machine-local).
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
      const store = deps.createStore({ rootPath: args.rootPath, dataDir: args.dataDir, deviceId: args.deviceId });
      return scanner.scan(args.rootPath, {
        config: args.config,
        store,
        paths: args.paths,
        markInbox: args.markInbox,
        onProgress: (p) => hooks.onEvent?.(p),
        signal: hooks.signal,
      });
    },

    async extract(args: ExtractArgs, hooks: WorkerHooks<ExtractResult> = {}) {
      const extractor = extractorFor(args.cacheDir);
      for (const item of args.items) {
        if (hooks.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        let result: ExtractResult;
        try {
          const text = await extractor.extract(args.rootPath, item.path, { hash: item.hash, signal: hooks.signal });
          result = { path: item.path, hash: item.hash, ok: true, cached: Boolean(text.fromCache), meta: text.meta, hasText: text.hasText };
        } catch (e) {
          if (hooks.signal?.aborted) throw e;
          // One bad file must not stop the run: report it and go on.
          result = { path: item.path, hash: item.hash, ok: false, cached: false, error: describe(e) };
        }
        hooks.onEvent?.(result);
      }
    },

    async index({ rootPath, cacheDir, jobs }: { rootPath: string; cacheDir: string; jobs: IndexJob[] }) {
      const idx = ensureIndex();
      const docs = [];
      for (const job of jobs) {
        const base = { ...job.doc };
        const rec = job.doc.record;
        if (job.text === 'empty') {
          docs.push({ ...base, pages: [], textHash: rec.hash });
        } else if (job.text === 'cache' && !rec.missing) {
          try {
            const text = await extractorFor(cacheDir).extract(rootPath, rec.path, { hash: rec.hash });
            docs.push({ ...base, pages: text.pages, textHash: rec.hash, abstract: base.abstract ?? text.meta.abstract });
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
