import { GRAPH_K, STORE_K, makeAnalysis, type Neighbor } from './analysis.js';
import { clusterHierarchy, globalMeans, symmetrize, topTermsOf } from './cluster.js';
import { forceLayout } from './layout.js';
import { buildVectors, countTerms, type Vocabulary } from './tfidf.js';
import { checkpoint, type Edge, type GraphDoc, type RunContext, type SparseVec } from './types.js';

export const MODEL_FORMAT = 'rl-graph-model';
export const MODEL_VERSION = 1;
const TOP_TERMS = 10;

export interface ModelCluster {
  id: string;
  /** Index of the parent cluster, -1 at the top level. */
  parent: number;
  level: number;
  size: number;
  terms: string[];
  cx: number;
  cy: number;
}

/**
 * The regenerable model of a library (kept in the local app data, never synced): positions, clusters, the sparse
 * vectors (to place new documents and to explain similarity) and the nearest neighbours of every document. Plain
 * arrays so that it is one JSON file; `ids[i]` is the document every parallel array describes at index `i`.
 */
export interface GraphModel {
  format: typeof MODEL_FORMAT;
  version: typeof MODEL_VERSION;
  seed: number;
  builtAt: string;
  ids: string[];
  sigs: string[];
  x: number[];
  y: number[];
  /** Per document, the cluster index at each level (shorter when its cluster was not split further). */
  cl: number[][];
  clusters: ModelCluster[];
  vocab: string[];
  idf: number[];
  /** Per document, term indexes and weights (1/1000 steps). */
  vi: number[][];
  vw: number[][];
  /** Per document, flat 9-number records of its neighbours: index, score, text, cit (x1000), shared citations, direct, shared tags, tag (x1000), same folder (see `neighborsOf`). */
  nb: number[][];
}

const FIELDS = 9;

export function encodeNeighbors(list: readonly Neighbor[]): number[] {
  const out: number[] = [];
  for (const n of list) out.push(n.j, Math.round(n.score * 1000), Math.round(n.text * 1000), Math.round(n.cit * 1000), n.citShared, n.direct ? 1 : 0, n.tagShared, Math.round(n.tag * 1000), n.sameFolder ? 1 : 0);
  return out;
}

export function neighborsOf(m: GraphModel, i: number): Neighbor[] {
  const flat = m.nb[i] as number[];
  const out: Neighbor[] = [];
  for (let p = 0; p + FIELDS <= flat.length; p += FIELDS) {
    out.push({
      j: flat[p] as number,
      score: (flat[p + 1] as number) / 1000,
      text: (flat[p + 2] as number) / 1000,
      cit: (flat[p + 3] as number) / 1000,
      citShared: flat[p + 4] as number,
      direct: flat[p + 5] === 1,
      tagShared: flat[p + 6] as number,
      tag: (flat[p + 7] as number) / 1000,
      sameFolder: flat[p + 8] === 1,
    });
  }
  return out;
}

export function modelVector(m: GraphModel, i: number): SparseVec {
  return { i: Int32Array.from(m.vi[i] as number[]), w: Float32Array.from(m.vw[i] as number[]) };
}

export function modelVocabulary(m: GraphModel): Vocabulary {
  return { terms: m.vocab, index: new Map(m.vocab.map((t, i) => [t, i])), idf: Float32Array.from(m.idf) };
}

export interface BuildOptions extends RunContext {
  seed: number;
  now?: () => Date;
}

/**
 * Builds the whole model of a set of documents: vectors, neighbours (text, citations, tags), clusters in levels, top
 * terms and the 2D layout. Cooperative: it yields now and then so that a cancel can reach the thread.
 */
export async function buildModel(docs: readonly GraphDoc[], options: BuildOptions): Promise<GraphModel> {
  const n = docs.length;
  const ctx: RunContext = { signal: options.signal, onProgress: options.onProgress };
  const counts = [];
  for (let i = 0; i < n; i++) {
    counts.push(countTerms(docs[i] as GraphDoc));
    if (i % 100 === 99) {
      ctx.onProgress?.('vectors', i + 1, n);
      await checkpoint(ctx);
    }
  }
  const { vocab, vectors } = buildVectors(counts);
  counts.length = 0;
  ctx.onProgress?.('vectors', n, n);
  const analysis = makeAnalysis(docs, vocab, vectors);

  const nb: number[][] = [];
  const edges: Edge[] = [];
  for (let i = 0; i < n; i++) {
    const list = analysis.neighborsOf(i, STORE_K);
    nb.push(encodeNeighbors(list));
    for (const h of list.slice(0, GRAPH_K)) edges.push({ a: i, b: h.j, w: h.score });
    if (i % 25 === 24) {
      ctx.onProgress?.('similarity', i + 1, n);
      await checkpoint(ctx);
    }
  }
  ctx.onProgress?.('similarity', n, n);
  const graph = symmetrize(edges);

  await checkpoint(ctx);
  const nodes = clusterHierarchy(n, graph, options.seed);
  const means = globalMeans(vectors, vocab.terms.length);
  const cl: number[][] = Array.from({ length: n }, () => []);
  // Members of a cluster come in level order, so each document's list is coarse to fine.
  for (const c of nodes) for (const d of c.members) (cl[d] as number[]).push(c.index);
  ctx.onProgress?.('clusters', 1, 1);

  const top = new Int32Array(n);
  for (const c of nodes) if (c.level === 0) for (const d of c.members) top[d] = c.index;
  // Layout works on the index of the top-level cluster (indexes of level 0 are 0..k-1).
  const layout = await forceLayout(n, graph, top, options.seed, ctx);

  const clusters: ModelCluster[] = nodes.map((c) => {
    let sx = 0;
    let sy = 0;
    for (const d of c.members) {
      sx += layout.x[d] as number;
      sy += layout.y[d] as number;
    }
    return {
      id: `c${c.level}.${c.index}`,
      parent: c.parent,
      level: c.level,
      size: c.members.length,
      terms: topTermsOf(vectors, c.members, vocab.terms, means, TOP_TERMS),
      cx: Math.round((sx / c.members.length) * 1e4) / 1e4,
      cy: Math.round((sy / c.members.length) * 1e4) / 1e4,
    };
  });

  return {
    format: MODEL_FORMAT,
    version: MODEL_VERSION,
    seed: options.seed,
    builtAt: (options.now?.() ?? new Date()).toISOString(),
    ids: docs.map((d) => d.id),
    sigs: docs.map((d) => d.sig),
    x: Array.from(layout.x),
    y: Array.from(layout.y),
    cl,
    clusters,
    vocab: vocab.terms,
    idf: Array.from(vocab.idf, (v) => Math.round(v * 1000) / 1000),
    vi: vectors.map((v) => Array.from(v.i)),
    vw: vectors.map((v) => Array.from(v.w, (w) => Math.round(w * 1000) / 1000)),
    nb,
  };
}

const isNumArray = (v: unknown, max = Infinity): v is number[] => Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** Checks the shape of a model read from disk (a damaged or newer file is `null`, never a crash later). */
export function decodeModel(raw: unknown): GraphModel | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Partial<GraphModel>;
  if (m.format !== MODEL_FORMAT || m.version !== MODEL_VERSION) return null;
  if (!Array.isArray(m.ids) || !Array.isArray(m.sigs) || !Array.isArray(m.cl) || !Array.isArray(m.vi) || !Array.isArray(m.vw) || !Array.isArray(m.nb)) return null;
  if (!isNumArray(m.x) || !isNumArray(m.y) || !isNumArray(m.idf) || !Array.isArray(m.vocab) || !Array.isArray(m.clusters)) return null;
  const n = m.ids.length;
  if (m.sigs.length !== n || m.x.length !== n || m.y.length !== n || m.cl.length !== n || m.vi.length !== n || m.vw.length !== n || m.nb.length !== n) return null;
  if (!m.ids.every((s) => typeof s === 'string') || !m.sigs.every((s) => typeof s === 'string') || !m.vocab.every((s) => typeof s === 'string') || m.idf.length !== m.vocab.length) return null;
  if (typeof m.seed !== 'number' || typeof m.builtAt !== 'string') return null;
  const cc = m.clusters.length;
  for (const c of m.clusters) {
    if (typeof c !== 'object' || c === null || typeof c.id !== 'string' || !isNumArray([c.parent, c.level, c.size, c.cx, c.cy]) || !Array.isArray(c.terms) || c.parent >= cc) return null;
  }
  const nv = m.vocab.length;
  for (let i = 0; i < n; i++) {
    const vi = m.vi[i];
    const vw = m.vw[i];
    const nbi = m.nb[i];
    if (!isNumArray(m.cl[i]) || !isNumArray(vi) || !isNumArray(vw) || !isNumArray(nbi) || vi.length !== vw.length || nbi.length % FIELDS !== 0) return null;
    if ((m.cl[i] as number[]).some((c) => c < 0 || c >= cc) || vi.some((t) => t < 0 || t >= nv)) return null;
    for (let p = 0; p < nbi.length; p += FIELDS) if ((nbi[p] as number) < 0 || (nbi[p] as number) >= n) return null;
  }
  return m as GraphModel;
}
