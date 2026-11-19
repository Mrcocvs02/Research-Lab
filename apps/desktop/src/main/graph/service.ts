import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { AppError, contentHashOf, type DocumentId, type DocumentRecord } from '@rl/core';
import { readCachedText, createLibraryStore } from '@rl/data';
import { STORE_K, type AreaSummary, countTerms, createPlacer, decodeModel, modelVector, neighborsOf, reasonsOf, sharedTerms, surprisingPairs, type GraphModel, type Reason } from '@rl/graph';
import type { MainServices } from '../ipc/handlers/services.js';
import type { LibraryRuntime } from '../library/library-runtime.js';
import { createGraphEngine, type BuildProgress, type GraphEngine, type GraphStoreArgs, type SimilarItem } from './engine.js';
import { GRAPH_PAGES, GRAPH_TEXT_CHARS, docSig, folderOfPath, toGraphDoc } from './inputs.js';
import { readMeta } from './model-meta.js';
import { graphPaths } from './paths.js';
import { TOP_TAGS, topTags } from './tag-top.js';
import { keywordTagIds, loadView, titleOf, type LibraryView } from './view.js';

/** Seed of the first build (a rebuild keeps the seed of the model it replaces unless one is given). */
export const DEFAULT_SEED = 1;
/** New or changed documents placed with their cached text per `graph:map` call; the rest are placed from their metadata alone (title, keywords, abstract), which needs no file read. */
const MAX_PLACED_PER_CALL = 300;
/** The loaded model is dropped from memory after this long without use. */
const MODEL_IDLE_MS = 120_000;
/** Largest model file read (a real model is about 1 KB per document, so 60,000 documents fit well below this; a corrupt or hostile file must not freeze or fill the main process). */
const MAX_MODEL_BYTES = 96 * 1024 * 1024;

type Placer = ReturnType<typeof createPlacer>;

export interface LoadedModel {
  key: string;
  model: GraphModel;
  index: Map<string, number>;
  placer?: Placer;
  timer?: ReturnType<typeof setTimeout>;
}

interface Job {
  id: string;
  controller: AbortController;
  done: Promise<void>;
}

/** What the status needs of a model: its documents and signatures (from the small meta file, or from the loaded model). */
interface ModelSummary {
  ids: string[];
  sigs: string[];
  index: Map<string, number>;
  builtAt: string;
  seed: number;
}

interface State {
  job: Job | null;
  loaded: LoadedModel | null;
  meta: { key: string; summary: ModelSummary } | null;
  /** Placements of documents newer than the model, by id (valid while the signature and the model are the same). */
  placed: Map<string, { sig: string; modelKey: string; value: ReturnType<Placer['place']> }>;
}

const states = new WeakMap<object, State>();
const stateOf = (rt: LibraryRuntime): State => {
  let st = states.get(rt);
  if (!st) states.set(rt, (st = { job: null, loaded: null, meta: null, placed: new Map() }));
  return st;
};

const engines = new WeakMap<object, GraphEngine>();
/** The graph engine of the app: a worker thread behind `s.graphEngine`, or in-process when there is none (tests). */
export function engineOf(s: MainServices): GraphEngine {
  let e = engines.get(s);
  if (!e) engines.set(s, (e = s.graphEngine?.() ?? createGraphEngine({ createStore: (o) => createLibraryStore({ ...o, logDocumentChanges: false }) })));
  return e;
}

/** Whether a graph build is running for this library (the maintenance clean waits). */
export const graphBuilding = (rt: LibraryRuntime): boolean => stateOf(rt).job !== null;

/** Drops the in-memory model and placements of this library (its files were cleaned). */
export function forgetGraphModel(rt: LibraryRuntime): void {
  const st = stateOf(rt);
  clearTimeout(st.loaded?.timer);
  st.loaded = null;
  st.meta = null;
  st.placed.clear();
}

/** Stops builds and the worker thread (app quit). */
export async function closeGraph(s: MainServices): Promise<void> {
  const e = engines.get(s);
  if (e) await e.dispose().catch(() => {});
}

export const noModel = (): AppError => new AppError('NOT_FOUND', 'The graph has not been built yet', { reason: 'no-model' });

/* ---------------------------------------- the model on disk ---------------------------------------- */

/** The model of the active library from the local app data (null: never built, or the file is damaged or from another version). */
export async function loadModel(s: MainServices, rt: LibraryRuntime): Promise<LoadedModel | null> {
  const st = stateOf(rt);
  const file = graphPaths(s.localDataDir, rt.libraryId).modelFile;
  const info = await stat(file).catch(() => null);
  if (!info?.isFile() || info.size > MAX_MODEL_BYTES) {
    st.loaded = null;
    return null;
  }
  const key = `${Math.round(info.mtimeMs)}:${info.size}`;
  let lm = st.loaded;
  if (!lm || lm.key !== key) {
    clearTimeout(lm?.timer);
    st.loaded = lm = null;
    try {
      const model = decodeModel(JSON.parse(await readFile(file, 'utf8')) as unknown);
      if (!model) {
        s.log.warn('the graph model is damaged or has another version: it will be rebuilt on request');
        return null;
      }
      lm = { key, model, index: new Map(model.ids.map((id, i) => [id, i])) };
      st.loaded = lm;
    } catch (e) {
      s.log.warn('the graph model could not be read', { error: e });
      return null;
    }
    st.placed.clear();
  }
  clearTimeout(lm.timer);
  // Memory: the loaded model (about 1 MB per 1000 documents) is let go when nobody asks for it.
  lm.timer = setTimeout(() => {
    if (st.loaded === lm) st.loaded = null;
  }, MODEL_IDLE_MS);
  lm.timer.unref?.();
  return lm;
}

export const modelId = (m: GraphModel): string => `${m.builtAt}:${m.seed}`;

/** Documents that are new or changed since the model, and the model documents that are gone. */
export function drift(view: LibraryView, m: Pick<GraphModel, 'ids' | 'sigs'>, index: Map<string, number>): { pending: DocumentRecord[]; changed: number; removed: number } {
  const pending: DocumentRecord[] = [];
  let changed = 0;
  for (const r of view.records) {
    const i = index.get(r.id);
    if (i === undefined || m.sigs[i] !== docSig(r)) pending.push(r);
    if (i !== undefined && m.sigs[i] !== docSig(r)) changed++;
  }
  let removed = 0;
  for (const id of m.ids) if (!view.byId.has(id)) removed++;
  return { pending, changed, removed };
}

/* ------------------------------------------------ status, build, cancel ------------------------------------------------ */

/** The documents and signatures of the model on disk without parsing it when the meta file describes it (else the model is loaded). */
async function summaryOf(s: MainServices, rt: LibraryRuntime): Promise<ModelSummary | null> {
  const st = stateOf(rt);
  const paths = graphPaths(s.localDataDir, rt.libraryId);
  const info = await stat(paths.modelFile).catch(() => null);
  if (!info?.isFile() || info.size > MAX_MODEL_BYTES) return null;
  const key = `${Math.round(info.mtimeMs)}:${info.size}`;
  if (st.loaded?.key === key) {
    const m = st.loaded.model;
    return { ids: m.ids, sigs: m.sigs, index: st.loaded.index, builtAt: m.builtAt, seed: m.seed };
  }
  if (st.meta?.key === key) return st.meta.summary;
  const meta = await readMeta(paths.metaFile, info.size);
  if (meta) {
    const summary = { ids: meta.ids, sigs: meta.sigs, index: new Map(meta.ids.map((id, i) => [id, i])), builtAt: meta.builtAt, seed: meta.seed };
    st.meta = { key, summary };
    return summary;
  }
  const lm = await loadModel(s, rt);
  return lm ? { ids: lm.model.ids, sigs: lm.model.sigs, index: lm.index, builtAt: lm.model.builtAt, seed: lm.model.seed } : null;
}

export async function status(s: MainServices) {
  const rt = await s.runtime.require();
  const st = stateOf(rt);
  const view = await loadView(rt);
  const sum = await summaryOf(s, rt);
  if (!sum) return { state: st.job ? ('building' as const) : ('none' as const), documents: view.records.length, builtAt: null, seed: null, pending: 0, removed: 0 };
  const d = drift(view, sum, sum.index);
  return {
    state: st.job ? ('building' as const) : d.pending.length + d.removed > 0 ? ('stale' as const) : ('ready' as const),
    documents: sum.ids.length,
    builtAt: sum.builtAt,
    seed: sum.seed,
    pending: d.pending.length,
    changed: d.changed,
    removed: d.removed,
  };
}

const PHASES_MIN_GAP_MS = 120;

export async function startBuild(s: MainServices, seedArg: number | undefined): Promise<{ jobId: string }> {
  const rt = await s.runtime.require();
  const st = stateOf(rt);
  if (st.job) return { jobId: st.job.id };
  // The job is registered before the first await below: two calls in the same tick must not start two builds.
  const jobId = randomUUID();
  const controller = new AbortController();
  let release!: () => void;
  st.job = { id: jobId, controller, done: new Promise<void>((resolve) => (release = resolve)) };
  const finish = () => {
    if (st.job?.id === jobId) st.job = null;
    release();
  };
  try {
    const paths = graphPaths(s.localDataDir, rt.libraryId);
    const seed = seedArg ?? (await loadModel(s, rt))?.model.seed ?? DEFAULT_SEED;
    const { deviceId } = await s.settings.get();
    const args = { rootPath: rt.store.rootPath, dataDir: rt.store.dataDir, deviceId, cacheDir: rt.textCacheDir, modelFile: paths.modelFile, seed };
    const emit = (phase: 'vectors' | 'similarity' | 'clusters' | 'layout' | 'done' | 'failed' | 'cancelled', done: number, total: number, reason?: 'too-large' | 'timeout' | 'memory', trimmed?: number) =>
      s.emit('graph:progress', { jobId, phase, done, total, ...(reason ? { reason } : {}), ...(trimmed ? { trimmedCitations: trimmed } : {}) });
    let lastPhase = '';
    let lastAt = 0;
    const onProgress = (p: BuildProgress) => {
      const now = Date.now();
      if (p.phase === lastPhase && p.done < p.total && now - lastAt < PHASES_MIN_GAP_MS) return;
      lastPhase = p.phase;
      lastAt = now;
      emit(p.phase, p.done, p.total);
    };
    emit('vectors', 0, 0);
    engineOf(s)
      .build(args, { signal: controller.signal, onProgress })
      .then((summary) => {
        clearTimeout(st.loaded?.timer);
        st.loaded = null;
        st.meta = null;
        st.placed.clear();
        emit('done', summary.documents, summary.documents, undefined, summary.trimmedCitations);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted || (e instanceof Error && e.name === 'AbortError')) emit('cancelled', 0, 0);
        else {
          s.log.error('the graph build failed', { error: e });
          const r = e instanceof AppError ? e.details?.['reason'] : undefined;
          const reason = r === 'too-large' || r === 'timeout' || r === 'memory' ? r : undefined;
          emit('failed', 0, 0, reason);
        }
      })
      .finally(finish);
  } catch (e) {
    finish();
    throw e;
  }
  return { jobId };
}

export async function cancelBuild(s: MainServices, jobId: string): Promise<{ cancelled: boolean }> {
  const rt = await s.runtime.require();
  const job = stateOf(rt).job;
  if (!job || job.id !== jobId) return { cancelled: false };
  job.controller.abort();
  return { cancelled: true };
}

/** Resolves when the build that is running (if any) has finished (tests). */
export async function whenBuilt(s: MainServices): Promise<void> {
  const rt = await s.runtime.require();
  await stateOf(rt).job?.done;
}

/* --------------------------------------------------- map --------------------------------------------------- */


async function counts(rt: LibraryRuntime, view: LibraryView, rec: DocumentRecord, light: boolean) {
  const cached = light ? null : await readCachedText(rt.textCacheDir, contentHashOf(rec), GRAPH_PAGES);
  return countTerms(toGraphDoc(rec, view.lookup, { abstract: cached?.meta.abstract, text: cached ? cached.pages.map((p) => p.text).join('\n').slice(0, GRAPH_TEXT_CHARS) : undefined }));
}

/** Where a new or changed document goes: from its nearest neighbours in the model, without touching the model. */
export async function placePending(s: MainServices, rt: LibraryRuntime, view: LibraryView, lm: LoadedModel, pending: readonly DocumentRecord[]) {
  const st = stateOf(rt);
  const out = new Map<string, ReturnType<Placer['place']>>();
  const key = modelId(lm.model);
  let budget = MAX_PLACED_PER_CALL;
  for (const rec of pending) {
    const sig = docSig(rec);
    const hit = st.placed.get(rec.id);
    if (hit && hit.sig === sig && hit.modelKey === key) {
      out.set(rec.id, hit.value);
      continue;
    }
    // Over the budget a document is still on the map (placed from its metadata, not remembered: a later call with budget refines it).
    const light = budget-- <= 0;
    lm.placer ??= createPlacer(lm.model);
    const value = lm.placer.place(rec.id, await counts(rt, view, rec, light), lm.index.get(rec.id) ?? -1);
    if (!light) st.placed.set(rec.id, { sig, modelKey: key, value });
    out.set(rec.id, value);
  }
  return out;
}

/** `graph:map`: the work is in the lazy `map-run` chunk (it also adds the macro-areas, D-483). */
export const map = (s: MainServices, scope: { folder?: string | undefined; projectId?: string | undefined; tagId?: string | undefined } | undefined) => import('./map-run.js').then((m) => m.map(s, scope));

/* ------------------------------------------- similar, surprising, neighbours ------------------------------------------- */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function similarFromModel(view: LibraryView, lm: LoadedModel, rec: DocumentRecord, i: number, limit: number): SimilarItem[] {
  const m = lm.model;
  const kw = keywordTagIds(view.tax);
  const mine = new Set(view.tagsOf(rec).filter((t) => !kw.has(t)));
  const vec = (k: number) => modelVector(m, k);
  const vi = vec(i);
  const items: SimilarItem[] = [];
  for (const n of neighborsOf(m, i)) {
    const other = view.byId.get(m.ids[n.j] as string);
    if (!other) continue;
    items.push({
      docId: other.id,
      score: clamp01(n.score),
      reasons: reasonsOf(n) as Reason[],
      shared: { tags: view.tagsOf(other).filter((t) => mine.has(t)).slice(0, 20), citations: n.citShared + (n.direct ? 1 : 0), terms: sharedTerms(vi, vec(n.j), m.vocab, 8) },
    });
    if (items.length === limit) break;
  }
  return items;
}

/** Closest documents with reasons: from the model when it is current for this document, else computed on the fly in the worker. */
export async function similar(s: MainServices, docId: string, limit: number): Promise<SimilarItem[]> {
  const rt = await s.runtime.require();
  const view = await loadView(rt);
  const rec = view.byId.get(docId);
  if (!rec) throw new AppError('NOT_FOUND', 'Unknown document');
  const lm = await loadModel(s, rt);
  const at = lm?.index.get(docId);
  if (lm && at !== undefined && lm.model.sigs[at] === docSig(rec) && limit <= STORE_K) return similarFromModel(view, lm, rec, at, limit);
  const { deviceId } = await s.settings.get();
  const args: GraphStoreArgs & { docId: string; limit: number } = { rootPath: rt.store.rootPath, dataDir: rt.store.dataDir, deviceId, docId, limit };
  const items = await engineOf(s).similar(args);
  const kw = keywordTagIds(view.tax);
  return items.filter((it) => view.byId.has(it.docId)).map((it) => (kw.size === 0 ? it : { ...it, shared: { ...it.shared, tags: it.shared.tags.filter((t) => !kw.has(t)) } }));
}

export async function surprising(s: MainServices, docId: string | undefined, limit: number) {
  const rt = await s.runtime.require();
  const view = await loadView(rt);
  const lm = await loadModel(s, rt);
  if (!lm) throw noModel();
  const m = lm.model;
  let doc: number | undefined;
  if (docId !== undefined) {
    if (!view.byId.has(docId)) throw new AppError('NOT_FOUND', 'Unknown document');
    doc = lm.index.get(docId);
    if (doc === undefined) return { pairs: [] };
  }
  const vec = (k: number) => modelVector(m, k);
  const [{ knownPairs, novelPairs }, { readLinks }] = await Promise.all([import('./surprise.js'), import('../features/doclinks/store.js')]);
  const [files, links] = await Promise.all([rt.store.citations.list().catch(() => []), readLinks(rt.store.dataDir)]);
  const known = knownPairs(
    files.map((f) => ({ docId: f.docId as string, others: [...f.references, ...f.citedBy].map((r) => r.matchedDocId).filter((x): x is DocumentId => !!x) })),
    [...links.links, ...links.dismissed],
  );
  const raw = surprisingPairs(m, { doc, limit: limit * 8 }).filter((p) => view.byId.has(m.ids[p.a] as string) && view.byId.has(m.ids[p.b] as string));
  const pairs = novelPairs(raw, {
    known,
    authorsOf: (id) => view.byId.get(id)?.authors ?? [],
    clusterOf: (i) => m.cl[i]?.[0],
    idOf: (i) => m.ids[i] as string,
    termsOf: (a, b) => sharedTerms(vec(a), vec(b), m.vocab, 8),
  })
    .slice(0, limit)
    .map((p) => {
      const [a, b] = doc !== undefined && p.b === doc ? [p.b, p.a] : [p.a, p.b];
      return { a: m.ids[a] as string, b: m.ids[b] as string, score: clamp01(p.text), terms: p.terms };
    });
  return { pairs };
}

type NodeKind = 'doc' | 'folder' | 'tag';
interface OutNode {
  kind: NodeKind;
  id: string;
  label: string;
  count?: number;
  ar?: number[][] | undefined;
  az?: number | undefined;
}
interface OutEdge {
  from: string;
  to: string;
  kind: 'similar' | 'cites' | 'tagged' | 'contains' | 'linked';
  weight: number;
  id?: string;
  reasons?: Record<string, unknown>;
}

/** Node key used by edges: a folder and a tag may share the same id string. */
const key = (kind: NodeKind, id: string) => `${kind}:${id}`;

const folderLabel = (f: string) => (f === '' ? '/' : f.slice(f.lastIndexOf('/') + 1));

export async function neighbors(
  s: MainServices,
  req: { node: { kind: NodeKind; id: string }; kinds: string[]; limit: number },
): Promise<{ nodes: OutNode[]; edges: OutEdge[]; areas?: AreaSummary[]; hiddenTags?: number }> {
  const rt = await s.runtime.require();
  const view = await loadView(rt);
  const nodes = new Map<string, OutNode>();
  const edges: OutEdge[] = [];
  const addNode = (n: OutNode) => nodes.set(key(n.kind, n.id), n);
  const docNode = (r: DocumentRecord): OutNode => ({ kind: 'doc', id: r.id, label: titleOf(r) });
  const has = (k: string) => req.kinds.includes(k);
  const { id } = req.node;
  let hiddenTags = 0;
  const tagNode = (t: string): OutNode => ({ kind: 'tag', id: t, label: view.lookup.tagLabel(t) ?? t, count: view.tagCount(t) });

  if (req.node.kind === 'doc') {
    const rec = view.byId.get(id);
    if (!rec) throw new AppError('NOT_FOUND', 'Unknown document');
    if (has('similar')) {
      for (const it of (await similar(s, id, Math.min(req.limit, STORE_K))).slice(0, req.limit)) {
        const other = view.byId.get(it.docId);
        if (!other) continue;
        addNode(docNode(other));
        edges.push({ from: key('doc', id), to: key('doc', other.id), kind: 'similar', weight: it.score });
      }
    }
    if (has('citations')) {
      const file = await rt.store.citations.get(id as DocumentId).catch(() => null);
      let n = 0;
      for (const [list, outgoing] of [[file?.references ?? [], true], [file?.citedBy ?? [], false]] as const) {
        for (const l of list) {
          const other = l.matchedDocId ? view.byId.get(l.matchedDocId) : undefined;
          if (!other || other.id === id || n >= req.limit) continue;
          n++;
          addNode(docNode(other));
          edges.push({ from: key('doc', outgoing ? id : other.id), to: key('doc', outgoing ? other.id : id), kind: 'cites', weight: 1 });
        }
      }
    }
    if (has('links')) {
      for (const l of (await (await import('../features/doclinks/index.js')).linksOfDoc(s, id, view)).slice(0, req.limit)) {
        const other = view.byId.get(l.docId);
        if (!other) continue;
        addNode(docNode(other));
        edges.push({ from: key('doc', id), to: key('doc', other.id), kind: 'linked', weight: l.weight, id: l.id, reasons: l.reasons });
      }
    }
    if (has('tags')) {
      const top = topTags((await import('./areas-run.js')).weightsOf(rec), (t) => view.tagCount(t), Math.min(req.limit, TOP_TAGS));
      hiddenTags = top.hidden;
      for (const t of top.shown) {
        addNode(tagNode(t));
        edges.push({ from: key('doc', id), to: key('tag', t), kind: 'tagged', weight: 1 });
      }
    }
    if (has('folder')) {
      const f = folderOfPath(rec.path);
      addNode({ kind: 'folder', id: f, label: folderLabel(f), count: view.folders().get(f)?.total ?? 0 });
      edges.push({ from: key('folder', f), to: key('doc', id), kind: 'contains', weight: 1 });
    }
  } else if (req.node.kind === 'folder') {
    const folders = view.folders();
    if (id !== '' && !folders.has(id)) throw new AppError('NOT_FOUND', 'Unknown folder');
    if (has('children')) {
      const kids = [...folders.keys()].filter((f) => f !== '' && folderOfPath(f) === id).sort();
      for (const f of kids.slice(0, req.limit)) {
        addNode({ kind: 'folder', id: f, label: folderLabel(f), count: (folders.get(f) as { total: number }).total });
        edges.push({ from: key('folder', id), to: key('folder', f), kind: 'contains', weight: 1 });
      }
    }
    if (has('documents')) {
      for (const r of view.records.filter((x) => folderOfPath(x.path) === id).sort((a, b) => (a.path < b.path ? -1 : 1)).slice(0, req.limit)) {
        addNode(docNode(r));
        edges.push({ from: key('folder', id), to: key('doc', r.id), kind: 'contains', weight: 1 });
      }
    }
    if (has('folder') && id !== '') {
      const parent = folderOfPath(id);
      addNode({ kind: 'folder', id: parent, label: folderLabel(parent), count: folders.get(parent)?.total ?? 0 });
      edges.push({ from: key('folder', parent), to: key('folder', id), kind: 'contains', weight: 1 });
    }
  } else {
    const family = view.tagFamily(id);
    if (!family) throw new AppError('NOT_FOUND', 'Unknown tag');
    if (has('documents')) {
      for (const r of view.records.filter((x) => view.tagsOf(x).some((t) => family.has(t))).sort((a, b) => (a.path < b.path ? -1 : 1)).slice(0, req.limit)) {
        addNode(docNode(r));
        edges.push({ from: key('doc', r.id), to: key('tag', id), kind: 'tagged', weight: 1 });
      }
    }
    if (has('children')) {
      for (const n of (view.tax?.nodes ?? []).filter((x) => x.parents.includes(id) && x.status !== 'deprecated').sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, req.limit)) {
        addNode(tagNode(n.id));
        edges.push({ from: key('tag', id), to: key('tag', n.id), kind: 'contains', weight: 1 });
      }
    }
    if (has('tags')) {
      // Related tags: those that appear on the same documents (Jaccard of the document sets).
      const mine = new Set(view.records.filter((x) => view.tagsOf(x).includes(id)).map((x) => x.id));
      const together = new Map<string, number>();
      for (const r of view.records) if (mine.has(r.id)) for (const t of view.tagsOf(r)) if (t !== id) together.set(t, (together.get(t) ?? 0) + 1);
      const related = [...together.entries()]
        .map(([t, n]) => ({ t, w: n / (mine.size + view.tagCount(t) - n) }))
        .sort((a, b) => b.w - a.w || (a.t < b.t ? -1 : 1))
        .slice(0, req.limit);
      for (const r of related) {
        addNode(tagNode(r.t));
        edges.push({ from: key('tag', id), to: key('tag', r.t), kind: 'similar', weight: clamp01(r.w) });
      }
    }
  }
  return (await import('./areas-run.js')).withNeighborAreas(s, view, { nodes: [...nodes.values()], edges, ...(hiddenTags > 0 ? { hiddenTags } : {}) });
}
