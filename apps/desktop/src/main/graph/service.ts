import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { AppError, type DocumentId, type DocumentRecord } from '@rl/core';
import { readCachedText, createLibraryStore } from '@rl/data';
import { STORE_K, countTerms, createPlacer, decodeModel, neighborsOf, reasonsOf, sharedTerms, surprisingPairs, type GraphModel, type Reason } from '@rl/graph';
import type { MainServices } from '../ipc/handlers/services.js';
import type { LibraryRuntime } from '../library/library-runtime.js';
import { createGraphEngine, type BuildProgress, type GraphEngine, type GraphStoreArgs, type SimilarItem } from './engine.js';
import { GRAPH_PAGES, GRAPH_TEXT_CHARS, docSig, folderOfPath, toGraphDoc } from './inputs.js';
import { readLabels } from './labels-store.js';
import { graphPaths } from './paths.js';
import { loadView, scopeIds, titleOf, type LibraryView } from './view.js';

/** Seed of the first build (a rebuild keeps the seed of the model it replaces unless one is given). */
export const DEFAULT_SEED = 1;
/** New or changed documents placed per `graph:map` call (the rest wait for the next call or a rebuild). */
const MAX_PLACED_PER_CALL = 300;
/** The loaded model is dropped from memory after this long without use. */
const MODEL_IDLE_MS = 120_000;
/** Largest model file read (a corrupt or hostile file must not fill the memory). */
const MAX_MODEL_BYTES = 256 * 1024 * 1024;

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

interface State {
  job: Job | null;
  loaded: LoadedModel | null;
  /** Placements of documents newer than the model, by id (valid while the signature and the model are the same). */
  placed: Map<string, { sig: string; modelKey: string; value: ReturnType<Placer['place']> }>;
}

const states = new WeakMap<object, State>();
const stateOf = (rt: LibraryRuntime): State => {
  let st = states.get(rt);
  if (!st) states.set(rt, (st = { job: null, loaded: null, placed: new Map() }));
  return st;
};

const engines = new WeakMap<object, GraphEngine>();
/** The graph engine of the app: a worker thread behind `s.graphEngine`, or in-process when there is none (tests). */
export function engineOf(s: MainServices): GraphEngine {
  let e = engines.get(s);
  if (!e) engines.set(s, (e = s.graphEngine?.() ?? createGraphEngine({ createStore: (o) => createLibraryStore({ ...o, logDocumentChanges: false }) })));
  return e;
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
export function drift(view: LibraryView, m: GraphModel, index: Map<string, number>): { pending: DocumentRecord[]; removed: number } {
  const pending: DocumentRecord[] = [];
  for (const r of view.records) {
    const i = index.get(r.id);
    if (i === undefined || m.sigs[i] !== docSig(r)) pending.push(r);
  }
  let removed = 0;
  for (const id of m.ids) if (!view.byId.has(id)) removed++;
  return { pending, removed };
}

/* ------------------------------------------------ status, build, cancel ------------------------------------------------ */

export async function status(s: MainServices) {
  const rt = await s.runtime.require();
  const st = stateOf(rt);
  const view = await loadView(rt);
  const lm = await loadModel(s, rt);
  if (!lm) return { state: st.job ? ('building' as const) : ('none' as const), documents: view.records.length, builtAt: null, seed: null, pending: 0 };
  const d = drift(view, lm.model, lm.index);
  return {
    state: st.job ? ('building' as const) : d.pending.length + d.removed > 0 ? ('stale' as const) : ('ready' as const),
    documents: lm.model.ids.length,
    builtAt: lm.model.builtAt,
    seed: lm.model.seed,
    pending: d.pending.length,
  };
}

const PHASES_MIN_GAP_MS = 120;

export async function startBuild(s: MainServices, seedArg: number | undefined): Promise<{ jobId: string }> {
  const rt = await s.runtime.require();
  const st = stateOf(rt);
  if (st.job) return { jobId: st.job.id };
  const paths = graphPaths(s.localDataDir, rt.libraryId);
  const seed = seedArg ?? (await loadModel(s, rt))?.model.seed ?? DEFAULT_SEED;
  const { deviceId } = await s.settings.get();
  const jobId = randomUUID();
  const controller = new AbortController();
  const args = { rootPath: rt.store.rootPath, dataDir: rt.store.dataDir, deviceId, cacheDir: rt.textCacheDir, modelFile: paths.modelFile, seed };
  const emit = (phase: 'vectors' | 'similarity' | 'clusters' | 'layout' | 'done' | 'failed' | 'cancelled', done: number, total: number) => s.emit('graph:progress', { jobId, phase, done, total });
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
  const done = engineOf(s)
    .build(args, { signal: controller.signal, onProgress })
    .then((summary) => {
      clearTimeout(st.loaded?.timer);
      st.loaded = null;
      st.placed.clear();
      emit('done', summary.documents, summary.documents);
    })
    .catch((e: unknown) => {
      if (controller.signal.aborted || (e instanceof Error && e.name === 'AbortError')) emit('cancelled', 0, 0);
      else {
        s.log.error('the graph build failed', { error: e });
        emit('failed', 0, 0);
      }
    })
    .finally(() => {
      if (st.job?.id === jobId) st.job = null;
    });
  st.job = { id: jobId, controller, done };
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

const clusterId = (m: GraphModel, c: number): string => (m.clusters[c] as { id: string }).id;

async function counts(s: MainServices, rt: LibraryRuntime, view: LibraryView, rec: DocumentRecord) {
  const cached = await readCachedText(rt.textCacheDir, rec.hash, GRAPH_PAGES);
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
    if (budget-- <= 0) continue;
    lm.placer ??= createPlacer(lm.model);
    const value = lm.placer.place(rec.id, await counts(s, rt, view, rec), lm.index.get(rec.id) ?? -1);
    st.placed.set(rec.id, { sig, modelKey: key, value });
    out.set(rec.id, value);
  }
  return out;
}

export async function map(s: MainServices, scope: { folder?: string | undefined; projectId?: string | undefined; tagId?: string | undefined } | undefined) {
  const rt = await s.runtime.require();
  const view = await loadView(rt);
  const lm = await loadModel(s, rt);
  if (!lm) throw noModel();
  const m = lm.model;
  const wanted = await scopeIds(rt, view, scope);
  const points: Array<{ docId: string; x: number; y: number; clusters: string[] }> = [];
  const stale = new Set<string>();
  const { pending } = drift(view, m, lm.index);
  for (const r of pending) stale.add(r.id);
  for (let i = 0; i < m.ids.length; i++) {
    const id = m.ids[i] as string;
    if (stale.has(id) || !view.byId.has(id) || (wanted && !wanted.has(id))) continue;
    points.push({ docId: id, x: m.x[i] as number, y: m.y[i] as number, clusters: (m.cl[i] as number[]).map((c) => clusterId(m, c)) });
  }
  const placed = await placePending(s, rt, view, lm, wanted ? pending.filter((r) => wanted.has(r.id)) : pending);
  for (const [id, p] of placed) points.push({ docId: id, x: p.x, y: p.y, clusters: p.clusters.map((c) => clusterId(m, c)) });

  // Clusters: sizes and centroids from the points that are on the map (a scope or a placement changes them).
  const acc = new Map<string, { n: number; sx: number; sy: number }>();
  for (const p of points) {
    for (const c of p.clusters) {
      const a = acc.get(c) ?? { n: 0, sx: 0, sy: 0 };
      a.n++;
      a.sx += p.x;
      a.sy += p.y;
      acc.set(c, a);
    }
  }
  const labels = await readLabels(s, rt, modelId(m));
  const clusters = m.clusters.flatMap((c) => {
    const a = acc.get(c.id);
    if (!a) return [];
    const label = labels[c.id];
    return [
      {
        id: c.id,
        parent: c.parent >= 0 ? clusterId(m, c.parent) : null,
        level: c.level,
        size: a.n,
        topTerms: c.terms.slice(0, 12),
        aiLabel: label ? { text: label.text, meta: label.meta } : null,
        centroid: { x: Math.round((a.sx / a.n) * 1e4) / 1e4, y: Math.round((a.sy / a.n) * 1e4) / 1e4 },
      },
    ];
  });
  return { points, clusters, seed: m.seed, builtAt: m.builtAt };
}

/* ------------------------------------------- similar, surprising, neighbours ------------------------------------------- */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function similarFromModel(view: LibraryView, lm: LoadedModel, rec: DocumentRecord, i: number, limit: number): SimilarItem[] {
  const m = lm.model;
  const mine = new Set(view.tagsOf(rec));
  const vec = (k: number) => ({ i: Int32Array.from(m.vi[k] as number[]), w: Float32Array.from(m.vw[k] as number[]) });
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
  return items.filter((it) => view.byId.has(it.docId));
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
  const vec = (k: number) => ({ i: Int32Array.from(m.vi[k] as number[]), w: Float32Array.from(m.vw[k] as number[]) });
  const pairs = surprisingPairs(m, { doc, limit: limit * 2 })
    .filter((p) => view.byId.has(m.ids[p.a] as string) && view.byId.has(m.ids[p.b] as string))
    .slice(0, limit)
    .map((p) => {
      const [a, b] = doc !== undefined && p.b === doc ? [p.b, p.a] : [p.a, p.b];
      return { a: m.ids[a] as string, b: m.ids[b] as string, score: clamp01(p.text), terms: sharedTerms(vec(a), vec(b), m.vocab, 8) };
    });
  return { pairs };
}

type NodeKind = 'doc' | 'folder' | 'tag';
interface OutNode {
  kind: NodeKind;
  id: string;
  label: string;
  count?: number;
}
interface OutEdge {
  from: string;
  to: string;
  kind: 'similar' | 'cites' | 'tagged' | 'contains';
  weight: number;
}

const folderLabel = (f: string) => (f === '' ? '/' : f.slice(f.lastIndexOf('/') + 1));

export async function neighbors(
  s: MainServices,
  req: { node: { kind: NodeKind; id: string }; kinds: string[]; limit: number },
): Promise<{ nodes: OutNode[]; edges: OutEdge[] }> {
  const rt = await s.runtime.require();
  const view = await loadView(rt);
  const nodes = new Map<string, OutNode>();
  const edges: OutEdge[] = [];
  const addNode = (n: OutNode) => nodes.set(`${n.kind}:${n.id}`, n);
  const docNode = (r: DocumentRecord): OutNode => ({ kind: 'doc', id: r.id, label: titleOf(r) });
  const has = (k: string) => req.kinds.includes(k);
  const { id } = req.node;
  const tagCount = (t: string) => view.records.filter((r) => view.tagsOf(r).includes(t)).length;
  const tagNode = (t: string): OutNode => ({ kind: 'tag', id: t, label: view.lookup.tagLabel(t) ?? t, count: tagCount(t) });

  if (req.node.kind === 'doc') {
    const rec = view.byId.get(id);
    if (!rec) throw new AppError('NOT_FOUND', 'Unknown document');
    if (has('similar')) {
      for (const it of (await similar(s, id, Math.min(req.limit, STORE_K))).slice(0, req.limit)) {
        const other = view.byId.get(it.docId);
        if (!other) continue;
        addNode(docNode(other));
        edges.push({ from: id, to: other.id, kind: 'similar', weight: it.score });
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
          edges.push(outgoing ? { from: id, to: other.id, kind: 'cites', weight: 1 } : { from: other.id, to: id, kind: 'cites', weight: 1 });
        }
      }
    }
    if (has('tags')) {
      for (const t of rec.tags.slice(0, req.limit)) {
        addNode(tagNode(t));
        edges.push({ from: id, to: t, kind: 'tagged', weight: 1 });
      }
    }
    if (has('folder')) {
      const f = folderOfPath(rec.path);
      addNode({ kind: 'folder', id: f, label: folderLabel(f), count: view.folders().get(f)?.total ?? 0 });
      edges.push({ from: f, to: id, kind: 'contains', weight: 1 });
    }
  } else if (req.node.kind === 'folder') {
    const folders = view.folders();
    if (id !== '' && !folders.has(id)) throw new AppError('NOT_FOUND', 'Unknown folder');
    if (has('children')) {
      const kids = [...folders.keys()].filter((f) => f !== '' && folderOfPath(f) === id).sort();
      for (const f of kids.slice(0, req.limit)) {
        addNode({ kind: 'folder', id: f, label: folderLabel(f), count: (folders.get(f) as { total: number }).total });
        edges.push({ from: id, to: f, kind: 'contains', weight: 1 });
      }
    }
    if (has('documents')) {
      for (const r of view.records.filter((x) => folderOfPath(x.path) === id).sort((a, b) => (a.path < b.path ? -1 : 1)).slice(0, req.limit)) {
        addNode(docNode(r));
        edges.push({ from: id, to: r.id, kind: 'contains', weight: 1 });
      }
    }
    if (has('folder') && id !== '') {
      const parent = folderOfPath(id);
      addNode({ kind: 'folder', id: parent, label: folderLabel(parent), count: folders.get(parent)?.total ?? 0 });
      edges.push({ from: parent, to: id, kind: 'contains', weight: 1 });
    }
  } else {
    const family = view.tagFamily(id);
    if (!family) throw new AppError('NOT_FOUND', 'Unknown tag');
    if (has('documents')) {
      for (const r of view.records.filter((x) => view.tagsOf(x).some((t) => family.has(t))).sort((a, b) => (a.path < b.path ? -1 : 1)).slice(0, req.limit)) {
        addNode(docNode(r));
        edges.push({ from: r.id, to: id, kind: 'tagged', weight: 1 });
      }
    }
    if (has('children')) {
      for (const n of (view.tax?.nodes ?? []).filter((x) => x.parents.includes(id) && x.status !== 'deprecated').sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, req.limit)) {
        addNode(tagNode(n.id));
        edges.push({ from: id, to: n.id, kind: 'contains', weight: 1 });
      }
    }
    if (has('tags')) {
      // Related tags: those that appear on the same documents (Jaccard of the document sets).
      const mine = new Set(view.records.filter((x) => view.tagsOf(x).includes(id)).map((x) => x.id));
      const together = new Map<string, number>();
      for (const r of view.records) if (mine.has(r.id)) for (const t of view.tagsOf(r)) if (t !== id) together.set(t, (together.get(t) ?? 0) + 1);
      const related = [...together.entries()]
        .map(([t, n]) => ({ t, w: n / (mine.size + tagCount(t) - n) }))
        .sort((a, b) => b.w - a.w || (a.t < b.t ? -1 : 1))
        .slice(0, req.limit);
      for (const r of related) {
        addNode(tagNode(r.t));
        edges.push({ from: id, to: r.t, kind: 'similar', weight: clamp01(r.w) });
      }
    }
  }
  return { nodes: [...nodes.values()], edges };
}
