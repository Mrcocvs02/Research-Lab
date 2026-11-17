import { AppError, type LibraryStore } from '@rl/core';
import { atomicWriteFile } from '@rl/core/node';
import { analyze, buildModel, similarTo, type Reason } from '@rl/graph';
import { loadGraphDocs } from './inputs.js';

/** The heavy work of the graph. Runs in a worker thread in the app (`graph-worker.ts`), in-process in tests. */
export interface GraphStoreArgs {
  rootPath: string;
  dataDir: string;
  deviceId: string;
}

export interface BuildArgs extends GraphStoreArgs {
  /** Text cache folder: the first pages are read from it, never extracted. */
  cacheDir: string;
  modelFile: string;
  seed: number;
}

export interface BuildProgress {
  phase: 'vectors' | 'similarity' | 'clusters' | 'layout';
  done: number;
  total: number;
}

export interface BuildSummary {
  documents: number;
  builtAt: string;
  seed: number;
}

export interface SimilarItem {
  docId: string;
  score: number;
  reasons: Reason[];
  shared: { tags: string[]; citations: number; terms: string[] };
}

export interface CallHooks<P> {
  onProgress?: ((p: P) => void) | undefined;
  signal?: AbortSignal | undefined;
}

export interface GraphEngine {
  /** Builds the model and writes it atomically to `modelFile`. Rejects with an AbortError when cancelled. */
  build(args: BuildArgs, hooks?: CallHooks<BuildProgress>): Promise<BuildSummary>;
  /** Closest documents to one, computed from titles, abstracts, keywords, citations and tags (no model needed). */
  similar(args: GraphStoreArgs & { docId: string; limit: number }, hooks?: { signal?: AbortSignal | undefined }): Promise<SimilarItem[]>;
  dispose(): Promise<void>;
}

export interface EngineDeps {
  createStore(options: GraphStoreArgs): Pick<LibraryStore, 'documents' | 'citations' | 'readTaxonomy'>;
  now?: () => Date;
}

export function createGraphEngine(deps: EngineDeps): GraphEngine {
  return {
    async build(args, hooks = {}) {
      const store = deps.createStore(args);
      let total = 1;
      const docs = await loadGraphDocs(store, {
        cacheDir: args.cacheDir,
        signal: hooks.signal,
        // Reading the documents is the first half of the "vectors" phase.
        onProgress: (done, n) => {
          total = Math.max(1, n);
          hooks.onProgress?.({ phase: 'vectors', done, total: total * 2 });
        },
      });
      const model = await buildModel(docs, {
        seed: args.seed,
        ...(deps.now ? { now: deps.now } : {}),
        signal: hooks.signal,
        onProgress: (phase, done, n) => hooks.onProgress?.(phase === 'vectors' ? { phase, done: total + done, total: total * 2 } : { phase, done, total: n }),
      });
      if (hooks.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      await atomicWriteFile(args.modelFile, JSON.stringify(model));
      return { documents: docs.length, builtAt: model.builtAt, seed: model.seed };
    },

    async similar(args, hooks = {}) {
      const store = deps.createStore(args);
      const docs = await loadGraphDocs(store, { signal: hooks.signal });
      const at = docs.findIndex((d) => d.id === args.docId);
      if (at < 0) throw new AppError('NOT_FOUND', 'Unknown document');
      const mine = new Set(docs[at]?.tags);
      const a = await analyze(docs, { signal: hooks.signal });
      return similarTo(a, at, args.limit).map((n) => ({
        docId: (docs[n.j] as { id: string }).id,
        score: Math.min(1, Math.max(0, n.score)),
        reasons: n.reasons,
        shared: { tags: (docs[n.j] as { tags: string[] }).tags.filter((t) => mine.has(t)).slice(0, 20), citations: n.citShared + (n.direct ? 1 : 0), terms: n.terms },
      }));
    },

    async dispose() {},
  };
}
