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
import { createOrganizer, type Organizer, type OrganizerStore } from '@rl/data';
import { enrichFromExtraction } from './enrich.js';
import { buildIndexable, makeTaxonomyLookup, type TaxonomyLookup } from './indexable.js';
import type { ExtractResult, IndexJob, LibraryWorker, RecordHost } from './worker-protocol.js';

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
  /** How long `close()` waits for a running scan to stop before the worker is killed (default 10 s). */
  closeTimeoutMs?: number;
}

const emptySummary = (): ScanSummary => ({ added: 0, changed: 0, moved: 0, missing: 0, unchanged: 0, extracted: 0, failed: 0 });
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';

interface ScanRequest {
  full: boolean;
  /** Targeted scan of these paths; null: the whole root. */
  paths: string[] | null;
}

/** Scan requests that arrived while a scan ran or the runtime was held: merged into one pass. */
interface Pending {
  full: boolean;
  paths: Set<string> | null;
}

export interface RuntimeHold {
  /** Resolves when the scan that was running (if any) has stopped. */
  ready: Promise<void>;
  /** Lets scans run again; the requests that came meanwhile (and one for what the holder wrote) run now. */
  release(): void;
}

/** Waits for `p` at most `ms`; true when it finished in time. */
async function within(p: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([p.then(() => true, () => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
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
  private queued: Pending | null = null;
  /** While > 0 no scan starts (an import or a rebuild is writing); requests wait in `queued`. */
  private holds = 0;
  private scanConfig: ScanConfig = defaultLibraryConfig();
  private watcher: FileWatcher | null = null;
  private backedUp = false;
  private org: Organizer | null = null;
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

  /**
   * Starts a scan. While one is running (or the runtime is held) a request for more than a plain incremental
   * pass (`full`, `paths`) is queued and runs afterwards, never dropped; a plain request then returns the running
   * status.
   */
  startScan(options: { full?: boolean; paths?: string[] } = {}): ScanStatus {
    if (this.closed) throw new AppError('LIBRARY_NOT_ACTIVE', 'The library was closed');
    const request: ScanRequest = { full: Boolean(options.full), paths: options.paths ?? null };
    if (this.job && !request.full && request.paths === null) return this.current;
    this.request(request);
    return this.current;
  }

  /** Launches the request now, or queues it when a scan runs or the runtime is held. */
  private request(request: ScanRequest): void {
    if (this.closed) return;
    if (this.job || this.holds > 0) {
      this.enqueue(request);
      return;
    }
    const controller = new AbortController();
    const done = this.run(request, controller.signal)
      .finally(() => {
        this.job = null;
      })
      .then(() => {
        // Requests that came while scanning: one more pass (unless something holds the runtime).
        const q = this.queued;
        if (q && !this.closed && this.holds === 0) {
          this.queued = null;
          this.request({ full: q.full, paths: q.paths ? [...q.paths] : null });
        }
      });
    this.job = { controller, done };
  }

  private enqueue(request: ScanRequest): void {
    if (!this.queued) {
      this.queued = { full: request.full, paths: request.paths ? new Set(request.paths) : null };
      return;
    }
    this.queued.full ||= request.full;
    if (request.paths === null) this.queued.paths = null;
    else if (this.queued.paths) for (const p of request.paths) this.queued.paths.add(p);
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

  /**
   * Stops the scan that is running, waits for it, and keeps scans from starting until `release()`: for whoever is
   * about to write the records or the index itself (the legacy import, a rebuild).
   */
  hold(): RuntimeHold {
    if (this.closed) throw new AppError('LIBRARY_NOT_ACTIVE', 'The library was closed');
    this.holds++;
    this.job?.controller.abort();
    const ready = (async () => {
      while (this.job) await this.job.done.catch(() => {});
    })();
    let released = false;
    return {
      ready,
      release: () => {
        if (released) return;
        released = true;
        this.holds--;
        if (this.holds > 0 || this.closed) return;
        // What the holder wrote has to reach the index: a scan runs now, together with what was asked meanwhile.
        const q = this.queued;
        this.queued = null;
        this.request(q ? { full: q.full, paths: q.paths ? [...q.paths] : null } : { full: false, paths: null });
      },
    };
  }

  /** Drops the index and refills it from the library data and the text cache (a full pass: missing text is extracted). */
  async rebuild(): Promise<ScanStatus> {
    const hold = this.hold();
    try {
      await hold.ready;
      await this.d.worker.resetIndex();
      this.update({ indexed: await this.d.index.count() });
      this.queued = null;
      this.enqueue({ full: true, paths: null });
    } finally {
      hold.release();
    }
    return this.current;
  }

  private onWatch(batch: { paths: string[]; overflow: boolean }): void {
    this.request(batch.overflow ? { full: false, paths: null } : { full: false, paths: batch.paths });
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

  /**
   * The main thread is the only writer of `.lab/documents`: the worker's scanner proposes each record and this
   * commits it if the stored revision is still the one the scanner read (D-072). A concurrent edit by the user
   * makes the commit fail with a conflict; the worker re-reads and tries again.
   */
  private readonly recordHost: RecordHost = {
    commit: async ({ id, expectedRevision, record }) => {
      const conflict = new Error('conflict');
      try {
        const written = await this.d.store.documents.update(id, (cur) => {
          if (expectedRevision !== 'any' && (cur ? cur.revision : null) !== expectedRevision) throw conflict;
          return record;
        });
        return { ok: true, record: written };
      } catch (e) {
        if (e === conflict) return { ok: false, reason: 'conflict' };
        throw e;
      }
    },
  };

  /** Extracts one file under the worker's watchdog; the result says what became of it (never throws, except on cancel). */
  private async extractOne(rec: DocumentRecord, signal: AbortSignal): Promise<ExtractResult> {
    const item = { path: rec.path, hash: rec.hash };
    try {
      return await this.d.worker.extract({ rootPath: this.d.rootPath, cacheDir: this.d.textCacheDir, item }, { signal });
    } catch (e) {
      if (signal.aborted || isAbort(e)) throw abortError();
      const reason = e instanceof AppError && typeof e.details?.['reason'] === 'string' ? e.details['reason'] : undefined;
      // The file blocked or crashed the worker: it would do it again, so it is not retried until it changes.
      const permanent = reason === 'timeout' || reason === 'crash';
      return { ...item, ok: false, cached: false, permanent, reason: reason ?? 'worker', error: `${e instanceof AppError ? e.code : 'IO_ERROR'}${reason ? ` (${reason})` : ''}` };
    }
  }

  private async run(request: ScanRequest, signal: AbortSignal): Promise<void> {
    const { store, worker, index, log } = this.d;
    const summary = emptySummary();
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
    /** Documents that failed (extraction, record write, index row): each is counted once, whatever failed. */
    const failedDocs = new Set<string>();
    const fail = (docId: string) => {
      failedDocs.add(docId);
      summary.failed = failedDocs.size;
    };
    /** One document's failure (a record that cannot be written, an index row that is refused) is counted, never fatal. */
    const guard = async (what: string, docId: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        if (signal.aborted || isAbort(e)) throw e;
        fail(docId);
        log.warn(`${what} failed for one document`, { error: AppError.from(e).toJSON() });
      }
    };
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
          host: this.recordHost,
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

      // Text extraction, one file at a time under the watchdog (the extractor caches by file hash), indexing each
      // document as soon as its text is ready. `textHash` is written only for a success or a permanent failure:
      // a transient failure leaves the document to be retried by the next scan.
      const needText = records.filter((r) => !r.missing && (request.full || indexed.get(r.id)?.textHash !== r.hash));
      this.update({ phase: 'extracting', total: needText.length, processed: 0 });
      let processed = 0;
      for (const rec of needText) {
        if (signal.aborted) throw abortError();
        const res = await this.extractOne(rec, signal);
        await guard('indexing the extracted text', rec.id, async () => {
          const meta = res.ok ? res.meta : undefined;
          const before = (await store.documents.get(rec.id)) ?? rec;
          const current: DocumentRecord = enrichFromExtraction(before, meta)
            ? await store.documents.update(rec.id, (c) => enrichFromExtraction(c ?? before, meta) ?? c ?? before)
            : before;
          const doc = await buildIndexable(store, taxonomy, current, res.ok ? { abstract: meta?.abstract } : undefined);
          const job: IndexJob = res.ok ? { doc, text: 'cache', hash: res.readHash ?? rec.hash } : res.permanent ? { doc, text: 'empty', hash: rec.hash } : { doc, text: 'keep' };
          await worker.index({ rootPath: this.d.rootPath, cacheDir: this.d.textCacheDir, jobs: [job] });
          done.add(rec.id);
        });
        if (!res.ok) {
          fail(rec.id);
          log.warn('text extraction failed', { error: res.error, permanent: Boolean(res.permanent) });
        } else if (!res.cached) summary.extracted++;
        processed++;
        this.update({ processed }, false);
      }

      // Documents whose record changed (tags, moves, flags) or that are not in the index yet.
      const stale = (await store.documents.list()).filter((r) => {
        if (done.has(r.id)) return false;
        const st = indexed.get(r.id);
        return !st || st.stamp !== `${r.revision}:${r.updatedAt}`;
      });
      this.update({ phase: 'indexing', total: stale.length, processed: 0 });
      const send = (jobs: IndexJob[]) => worker.index({ rootPath: this.d.rootPath, cacheDir: this.d.textCacheDir, jobs });
      for (let i = 0; i < stale.length; i += 25) {
        if (signal.aborted) throw abortError();
        const jobs: IndexJob[] = [];
        for (const r of stale.slice(i, i + 25)) {
          await guard('reading a document for the index', r.id, async () => {
            jobs.push({ doc: await buildIndexable(store, taxonomy, r), text: 'keep' });
          });
        }
        try {
          if (jobs.length > 0) await send(jobs);
        } catch (e) {
          if (signal.aborted || isAbort(e)) throw e;
          // One refused row must not take its 24 neighbours with it: again, one by one.
          for (const j of jobs) await guard('indexing', j.doc.record.id, () => send([j]));
        }
        this.update({ processed: Math.min(stale.length, i + 25) }, false);
      }

      // Documents that are gone from the data folder leave the index.
      const live = new Set<string>(await store.documents.listIds());
      const vanished = [...indexed.keys()].filter((id) => !live.has(id));
      if (vanished.length > 0) await worker.remove(vanished);

      this.update({ state: 'done', phase: undefined, summary, indexed: await index.count(), finishedAt: this.nowIso(), total: undefined, processed: 0 });
    } catch (e) {
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

  /**
   * Organising operations of the active library (taxonomy, tags, document fields, projects, history). Every one
   * writes through the store's queues; callers then `reindexDocuments` what the result lists.
   */
  get organizer(): Organizer {
    if (!this.org) {
      const store = this.d.store as Partial<OrganizerStore>;
      if (typeof store.withChange !== 'function') throw new AppError('INTERNAL', 'The store cannot record changes');
      this.org = createOrganizer({ store: this.d.store as OrganizerStore, deviceId: this.d.deviceId, now: this.d.now });
    }
    return this.org;
  }

  /** Same as `reindexDocument` for many documents: the taxonomy is read once and the worker gets batches of 25. */
  async reindexDocuments(docIds: readonly DocumentId[]): Promise<void> {
    if (docIds.length === 0) return;
    this.taxonomyCache = null;
    const taxonomy = await this.taxonomy();
    const gone: DocumentId[] = [];
    for (let i = 0; i < docIds.length; i += 25) {
      const jobs: IndexJob[] = [];
      for (const id of docIds.slice(i, i + 25)) {
        const rec = await this.d.store.documents.get(id).catch(() => null);
        if (!rec) gone.push(id);
        else jobs.push({ doc: await buildIndexable(this.d.store, taxonomy, rec), text: 'keep' });
      }
      if (jobs.length > 0) await this.d.worker.index({ rootPath: this.d.rootPath, cacheDir: this.d.textCacheDir, jobs });
    }
    if (gone.length > 0) await this.d.worker.remove(gone);
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
    const limit = this.d.closeTimeoutMs ?? 10_000;
    const job = this.job;
    if (job) {
      job.controller.abort();
      // A worker blocked in a synchronous loop cannot see the abort: after the limit it is killed.
      if (!(await within(job.done, limit))) {
        this.d.log.warn('the scan did not stop in time; stopping the worker');
        await this.d.worker.terminate?.().catch(() => {});
        await within(job.done, limit);
      }
    }
    await Promise.resolve(this.watcher?.close()).catch(() => {});
    if (!(await within(this.d.worker.dispose(), limit))) await this.d.worker.terminate?.().catch(() => {});
    await this.d.index.close().catch(() => {});
  }

  /** Kills the worker thread at once (last resort at quit). */
  async terminate(): Promise<void> {
    await this.d.worker.terminate?.().catch(() => {});
  }
}
