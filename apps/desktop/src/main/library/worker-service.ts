import { AppError, type ScanProgress, type Scanner, type SearchIndex, type TextExtractor } from '@rl/core';
import { readTextCache, writeTextCache } from './text-cache.js';
import type { ExtractArgs, ExtractResult, IndexJob, LibraryWorker, ScanArgs, WorkerHooks } from './worker-protocol.js';

export interface WorkerDeps {
  createScanner(): Scanner;
  createTextExtractor(): TextExtractor;
  createIndex(): SearchIndex;
}

/** Short, document-free description of an error (these messages travel to logs and status). */
function describe(e: unknown): string {
  if (e instanceof AppError) return `${e.code}: ${e.message}`;
  return e instanceof Error ? e.message.slice(0, 200) : 'unknown error';
}

/**
 * The worker side of the library runtime. It runs in a worker thread in the app (`scan-worker.ts`) and
 * in-process in tests. Everything here is read-only on the library files; it writes only the text cache
 * and the search index (both machine-local).
 */
export function createWorkerService(deps: WorkerDeps): LibraryWorker {
  let index: SearchIndex | null = null;
  let scanner: Scanner | null = null;
  let extractor: TextExtractor | null = null;

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
      return scanner.scan(args.rootPath, {
        config: args.config,
        known: args.known,
        onProgress: (p) => hooks.onEvent?.(p),
        signal: hooks.signal,
      });
    },

    async extract(args: ExtractArgs, hooks: WorkerHooks<ExtractResult> = {}) {
      extractor ??= deps.createTextExtractor();
      for (const item of args.items) {
        if (hooks.signal?.aborted) throw new AppError('INVALID_REQUEST', 'aborted', { aborted: true });
        let result: ExtractResult;
        try {
          const cached = args.force ? null : await readTextCache(args.cacheDir, item.hash);
          if (cached) {
            result = { path: item.path, hash: item.hash, ok: true, cached: true, meta: cached.meta, noTextLayer: cached.noTextLayer };
          } else {
            const text = await extractor.extract(args.rootPath, item.path, { signal: hooks.signal });
            await writeTextCache(args.cacheDir, item.hash, text);
            result = { path: item.path, hash: item.hash, ok: true, cached: false, meta: text.meta, noTextLayer: text.noTextLayer };
          }
        } catch (e) {
          if (hooks.signal?.aborted) throw e;
          // One bad file must not stop the run: report it and go on.
          result = { path: item.path, hash: item.hash, ok: false, cached: false, error: describe(e) };
        }
        hooks.onEvent?.(result);
      }
    },

    async index({ cacheDir, jobs }: { cacheDir: string; jobs: IndexJob[] }) {
      const idx = ensureIndex();
      const docs = [];
      for (const job of jobs) {
        const base = { ...job.doc };
        if (job.text === 'empty') {
          docs.push({ ...base, pages: [], textHash: job.doc.record.hash });
        } else if (job.text === 'cache') {
          const cached = await readTextCache(cacheDir, job.doc.record.hash);
          docs.push(cached ? { ...base, pages: cached.pages, textHash: job.doc.record.hash } : base);
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
