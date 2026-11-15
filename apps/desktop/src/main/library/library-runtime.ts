import path from 'node:path';
import {
  AppError,
  defaultLibraryConfig,
  type DocumentId,
  type DocumentListQuery,
  type DocumentRecord,
  type DocumentSummary,
  type LibraryConfig,
  type LibraryStore,
  type Logger,
  type ScanStatus,
  type ScanSummary,
  type SearchFacets,
  type SearchIndex,
  type SearchQuery,
  type SearchResultPage,
  type TaxonomyFile,
} from '@rl/core';
import { enrichFromExtraction } from './enrich.js';
import { buildIndexable, makeTaxonomyLookup, type TaxonomyLookup } from './indexable.js';
import type { ExtractResult, IndexJob, LibraryWorker } from './worker-protocol.js';

/** Where the machine-local, rebuildable files of a library live (never in the library folder). */
export function localPaths(localDataDir: string, libraryId: string) {
  return {
    indexFile: path.join(localDataDir, 'index', `${libraryId}.sqlite`),
    textCacheDir: path.join(localDataDir, 'cache', 'text'),
  };
}

export interface FileWatcher {
  close(): void | Promise<void>;
}

type ScanConfig = Pick<LibraryConfig, 'excludedFolders' | 'scan'>;

export interface RuntimeDeps {
  libraryId: string;
  rootPath: string;
  dataDir: string;
  deviceId: string;
  store: LibraryStore;
  /** Reading connection of the main process; the worker owns the writing one. */
  index: SearchIndex;
  worker: LibraryWorker;
  indexFile: string;
  textCacheDir: string;
  log: Logger;
  /** Called with every status change (progress is throttled). */
  onStatus(status: ScanStatus): void;
  /** Copies the data folder aside before the scanner writes into an existing library (rule 1). */
  backup(): Promise<void>;
  /**
   * Starts watching the library root (bound to `createWatcher` from `@rl/data` in main/index.ts); each batch of
   * changed paths becomes a targeted scan, an overflow a full one.
   */
  watch?(options: {
    rootPath: string;
    dataDir: string;
    config: () => ScanConfig;
    onBatch(batch: { paths: string[]; overflow: boolean }): void;
    onError(error: Error): void;
  }): FileWatcher | Promise<FileWatcher>;
  now?(): Date;
  /** Minimum ms between two progress events (default 150). */
  progressIntervalMs?: number;
}

const emptySummary = (): ScanSummary => ({ added: 0, changed: 0, moved: 0, missing: 0, unchanged: 0, extracted: 0, failed: 0 });
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';

/** Serial queue: tasks run one after the other; errors are collected, not thrown into the caller of `add`. */
class SerialQueue {
  private tail: Promise<void> = Promise.resolve();
  errors: unknown[] = [];
  add(task: () => Promise<void>): void {
    this.tail = this.tail.then(task).catch((e: unknown) => {
      this.errors.push(e);
    });
  }
  idle(): Promise<void> {
    return this.tail;
  }
}

interface ScanRequest {
  full: boolean;
  /** Targeted scan of these paths; null: the whole root. */
  paths: string[] | null;
}

/**
 * Everything the main process runs for the ACTIVE library: its store, the search index (read here, written
 * by the worker thread), the background scan and the watcher. The heavy work happens in the worker; this class
 * only coordinates it and writes the small JSON records.
 */
export class LibraryRuntime {
  private current: ScanStatus;
  private job: { controller: AbortController; done: Promise<void> } | null = null;
  private closed = false;
  private lastEmit = 0;
  /** Watcher batches that arrived while a scan was running. */
  private queued: { full: boolean; paths: Set<string> } | null = null;
  private scanConfig: ScanConfig = defaultLibraryConfig();
  private watcher: FileWatcher | null = null;
  private backedUp = false;
  private taxonomyCache: { at: number; lookup: TaxonomyLookup } | null = null;

  private constructor(private readonly d: RuntimeDeps) {
    this.current = { libraryId: d.libraryId, state: 'idle', seen: 0, processed: 0, indexed: 0 };
  }

  /** Opens store and index; does not scan (see `startScan`). */
  static async open(deps: RuntimeDeps): Promise<LibraryRuntime> {
    await deps.store.init();
    await deps.index.open(deps.indexFile);
    await deps.worker.openIndex(deps.indexFile);
    if (deps.index.needsRebuild) deps.log.info('search index is new or has another schema version: it will be refilled', { libraryId: deps.libraryId });
    const rt = new LibraryRuntime(deps);
    rt.current = { ...rt.current, indexed: await deps.index.count() };
    rt.scanConfig = await deps.store.readConfig().catch(() => rt.scanConfig);
    if (deps.watch) {
      try {
        rt.watcher = await deps.watch({
          rootPath: deps.rootPath,
          dataDir: deps.dataDir,
          config: () => rt.scanConfig,
          onBatch: (b) => rt.onWatch(b),
          onError: (e) => deps.log.warn('file watcher error', { error: e }),
        });
      } catch (e) {
        deps.log.warn('file watcher could not start', { error: e });
      }
    }
    return rt;
  }

  get libraryId(): string {
    return this.d.libraryId;
  }

  status(): ScanStatus {
    return this.current;
  }

  private update(patch: Partial<ScanStatus>, force = true): void {
    this.current = { ...this.current, ...patch };
    const now = Date.now();
    if (!force && now - this.lastEmit < (this.d.progressIntervalMs ?? 150)) return;
    this.lastEmit = now;
    this.d.onStatus(this.current);
  }

  private nowIso(): string {
    return (this.d.now?.() ?? new Date()).toISOString();
  }

  /** Starts an incremental scan unless one is running (then returns the running status). */
  startScan(options: { full?: boolean; paths?: string[] } = {}): ScanStatus {
    if (this.closed) throw new AppError('LIBRARY_NOT_ACTIVE', 'The library was closed');
    if (this.job) return this.current;
    const request: ScanRequest = { full: Boolean(options.full), paths: options.paths ?? null };
    const controller = new AbortController();
    const done = this.run(request, controller.signal)
      .finally(() => {
        this.job = null;
      })
      .then(() => {
        // Changes seen while scanning: one more pass.
        const q = this.queued;
        this.queued = null;
        if (q && !this.closed) this.startScan(q.full ? {} : { paths: [...q.paths] });
      });
    this.job = { controller, done };
    return this.current;
  }

  /** Resolves when the running scan (if any, and the one queued behind it) has finished. */
  async whenIdle(): Promise<ScanStatus> {
    while (this.job) await this.job.done;
    return this.current;
  }

  cancel(): ScanStatus {
    this.queued = null;
    this.job?.controller.abort();
    return this.current;
  }

  /** Drops the index and refills it from the library data and the text cache. */
  async rebuild(): Promise<ScanStatus> {
    this.queued = null;
    if (this.job) {
      this.job.controller.abort();
      await this.job.done;
    }
    await this.d.worker.resetIndex();
    this.update({ indexed: await this.d.index.count() });
    return this.startScan();
  }

  private onWatch(batch: { paths: string[]; overflow: boolean }): void {
    if (this.closed) return;
    if (!this.job) {
      this.startScan(batch.overflow ? {} : { paths: batch.paths });
      return;
    }
    this.queued ??= { full: false, paths: new Set() };
    if (batch.overflow) this.queued.full = true;
    for (const p of batch.paths) this.queued.paths.add(p);
  }

  private async taxonomy(): Promise<TaxonomyLookup> {
    const c = this.taxonomyCache;
    if (c && Date.now() - c.at < 5000) return c.lookup;
    let tax: TaxonomyFile | null = null;
    try {
      tax = await this.d.store.readTaxonomy();
    } catch (e) {
      this.d.log.warn('taxonomy could not be read for the index', { error: e });
    }
    const lookup = makeTaxonomyLookup(tax);
    this.taxonomyCache = { at: Date.now(), lookup };
    return lookup;
  }

  private async run(request: ScanRequest, signal: AbortSignal): Promise<void> {
    const { store, worker, index, log } = this.d;
    const summary = emptySummary();
    const queue = new SerialQueue();
    this.update({
      state: 'running',
      phase: 'walking',
      seen: 0,
      processed: 0,
      total: undefined,
      summary: undefined,
      error: undefined,
      startedAt: this.nowIso(),
      finishedAt: undefined,
    });
    try {
      this.scanConfig = await store.readConfig();
      const known = await store.documents.listIds();
      // Rule 1: a copy of the data folder before the scanner writes into a library that already has records.
      if (known.length > 0 && !this.backedUp) {
        await this.d.backup();
        this.backedUp = true;
      }
      const result = await worker.scan(
        {
          rootPath: this.d.rootPath,
          dataDir: this.d.dataDir,
          deviceId: this.d.deviceId,
          config: { excludedFolders: this.scanConfig.excludedFolders, scan: this.scanConfig.scan },
          paths: request.paths ?? undefined,
          markInbox: known.length > 0,
        },
        {
          signal,
          onEvent: (p) => this.update({ phase: p.phase === 'walking' ? 'walking' : 'hashing', seen: p.seen, total: p.total, processed: 0 }, false),
        },
      );
      summary.added = result.added.length;
      summary.changed = result.changed.length;
      summary.moved = result.moved.length;
      summary.missing = result.missing.length;
      summary.unchanged = result.unchanged;
      if (result.errors.length > 0) log.warn('some files or folders could not be scanned', { count: result.errors.length });
      if (signal.aborted || result.cancelled) throw abortError();

      const records = await store.documents.list();
      const indexed = await index.indexedState();
      const taxonomy = await this.taxonomy();
      const done = new Set<string>();

      // Text extraction (the extractor caches by file hash), indexing each document as soon as its text is ready.
      const needText = records.filter((r) => !r.missing && (request.full || indexed.get(r.id)?.textHash !== r.hash));
      this.update({ phase: 'extracting', total: needText.length, processed: 0 });
      const byKey = new Map(needText.map((r) => [`${r.path}\n${r.hash}`, r]));
      let processed = 0;
      const handle = async (res: ExtractResult) => {
        const rec = byKey.get(`${res.path}\n${res.hash}`);
        if (!rec) return;
        if (!res.ok) log.warn('text extraction failed', { error: res.error });
        const meta = res.ok ? res.meta : undefined;
        const before = (await store.documents.get(rec.id)) ?? rec;
        const current: DocumentRecord = enrichFromExtraction(before, meta)
          ? await store.documents.update(rec.id, (c) => enrichFromExtraction(c ?? before, meta) ?? c ?? before)
          : before;
        const doc = await buildIndexable(store, taxonomy, current, meta?.abstract);
        await worker.index({
          rootPath: this.d.rootPath,
          cacheDir: this.d.textCacheDir,
          jobs: [{ doc, text: res.ok ? 'cache' : 'empty' }],
        });
        done.add(rec.id);
        if (res.ok && !res.cached) summary.extracted++;
        if (!res.ok) summary.failed++;
      };
      if (needText.length > 0) {
        await worker.extract(
          { rootPath: this.d.rootPath, cacheDir: this.d.textCacheDir, items: needText.map((r) => ({ path: r.path, hash: r.hash })) },
          {
            signal,
            onEvent: (res) => {
              queue.add(() => handle(res));
              processed++;
              this.update({ processed }, false);
            },
          },
        );
        await queue.idle();
        if (queue.errors.length > 0) throw queue.errors[0];
      }

      // Documents whose record changed (tags, moves, flags) or that are not in the index yet.
      const stale = (await store.documents.list()).filter((r) => {
        if (done.has(r.id)) return false;
        const st = indexed.get(r.id);
        return !st || st.stamp !== `${r.revision}:${r.updatedAt}`;
      });
      this.update({ phase: 'indexing', total: stale.length, processed: 0 });
      for (let i = 0; i < stale.length; i += 25) {
        if (signal.aborted) throw abortError();
        const jobs: IndexJob[] = [];
        for (const r of stale.slice(i, i + 25)) jobs.push({ doc: await buildIndexable(store, taxonomy, r), text: 'keep' });
        await worker.index({ rootPath: this.d.rootPath, cacheDir: this.d.textCacheDir, jobs });
        this.update({ processed: Math.min(stale.length, i + 25) }, false);
      }

      // Documents that are gone from the data folder leave the index.
      const live = new Set<string>(await store.documents.listIds());
      const vanished = [...indexed.keys()].filter((id) => !live.has(id));
      if (vanished.length > 0) await worker.remove(vanished);

      this.update({ state: 'done', phase: undefined, summary, indexed: await index.count(), finishedAt: this.nowIso(), total: undefined, processed: 0 });
    } catch (e) {
      await queue.idle();
      if (isAbort(e) || signal.aborted) {
        this.update({ state: 'cancelled', phase: undefined, summary, indexed: await index.count().catch(() => this.current.indexed), finishedAt: this.nowIso() });
      } else {
        log.error('scan failed', { error: e });
        this.update({
          state: 'failed',
          phase: undefined,
          summary,
          indexed: await index.count().catch(() => this.current.indexed),
          error: AppError.from(e).toJSON(),
          finishedAt: this.nowIso(),
        });
      }
    }
  }

  /** Re-reads one document (record, notes, annotations) into the index; for edits made while the app runs. */
  async reindexDocument(docId: DocumentId): Promise<void> {
    const rec = await this.d.store.documents.get(docId);
    if (!rec) {
      await this.d.worker.remove([docId]);
      return;
    }
    this.taxonomyCache = null;
    const doc = await buildIndexable(this.d.store, await this.taxonomy(), rec);
    await this.d.worker.index({ rootPath: this.d.rootPath, cacheDir: this.d.textCacheDir, jobs: [{ doc, text: 'keep' }] });
  }

  async search(query: SearchQuery): Promise<SearchResultPage> {
    return this.d.index.searchPage(query);
  }

  async facets(query: SearchQuery): Promise<SearchFacets & { labels: { tags: Record<string, string>; types: Record<string, string> } }> {
    const f = await this.d.index.facets(query);
    const tax = await this.taxonomy();
    const labels = { tags: {} as Record<string, string>, types: {} as Record<string, string> };
    for (const b of f.tags) labels.tags[b.value] = tax.tagLabel(b.value) ?? b.value;
    for (const b of f.types) labels.types[b.value] = tax.typeLabel(b.value) ?? b.value;
    return { ...f, labels };
  }

  list(query: DocumentListQuery): Promise<{ total: number; items: DocumentSummary[] }> {
    return this.d.index.list(query);
  }

  async getDocument(docId: DocumentId): Promise<DocumentRecord> {
    const rec = await this.d.store.documents.get(docId);
    if (!rec) throw new AppError('NOT_FOUND', 'Unknown document');
    return rec;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.queued = null;
    this.job?.controller.abort();
    await this.job?.done.catch(() => {});
    await Promise.resolve(this.watcher?.close()).catch(() => {});
    await this.d.worker.dispose().catch(() => {});
    await this.d.index.close().catch(() => {});
  }
}
