import { TEXT_REASON_MIN, type Neighbor } from './analysis.js';
import { modelVocabulary, neighborsOf, type GraphModel } from './model.js';
import { hash32 } from './random.js';
import { buildPostings, makeScratch, nearest, vectorize, type TermCounts } from './tfidf.js';
import type { SparseVec } from './types.js';

export interface Placement {
  x: number;
  y: number;
  /** Cluster indexes of the model, coarse to fine. */
  clusters: number[];
  /** The model documents it was placed from (index, cosine), closest first. */
  from: Array<{ j: number; s: number }>;
}

const PLACE_K = 5;
const JITTER = 0.02;

/**
 * Places a document that is not in the model (new or changed since the build) from its nearest neighbours in the
 * model (never from its own old entry, `exclude`), without touching anything else: position = mean of the neighbours' positions weighted by closeness squared,
 * plus a small jitter that depends only on the document id (so it never lands exactly on a neighbour and is the same
 * every time); its clusters are those most of its neighbours are in.
 */
export function createPlacer(model: GraphModel): { place(id: string, counts: TermCounts, exclude?: number): Placement; vector(counts: TermCounts): SparseVec } {
  const vocab = modelVocabulary(model);
  const vectors: SparseVec[] = model.vi.map((_, i) => ({ i: Int32Array.from(model.vi[i] as number[]), w: Float32Array.from(model.vw[i] as number[]) }));
  const post = buildPostings(vectors, vocab.terms.length);
  const scratch = makeScratch(model.ids.length);
  const clusterOf = (j: number) => model.cl[j] as number[];
  return {
    vector: (counts) => vectorize(counts, vocab),
    place(id, counts, exclude = -1) {
      const v = vectorize(counts, vocab);
      const near = nearest(post, v, exclude, PLACE_K, 0.05, scratch);
      const h = hash32(id);
      const angle = ((h & 0xffff) / 0xffff) * 2 * Math.PI;
      const radius = JITTER * (0.5 + ((h >>> 16) / 0xffff) * 0.5);
      if (near.length === 0) return { x: Math.cos(angle) * radius * 10, y: Math.sin(angle) * radius * 10, clusters: [], from: [] };
      let sw = 0;
      let sx = 0;
      let sy = 0;
      for (const h2 of near) {
        const wgt = h2.s * h2.s;
        sw += wgt;
        sx += wgt * (model.x[h2.j] as number);
        sy += wgt * (model.y[h2.j] as number);
      }
      const clusters: number[] = [];
      let pool = near;
      for (let level = 0; ; level++) {
        const votes = new Map<number, number>();
        for (const h2 of pool) {
          const c = clusterOf(h2.j)[level];
          if (c !== undefined) votes.set(c, (votes.get(c) ?? 0) + h2.s);
        }
        let best = -1;
        let bw = 0;
        for (const [c, wt] of [...votes.entries()].sort((p, q) => p[0] - q[0])) if (wt > bw) [best, bw] = [c, wt];
        if (best < 0) break;
        clusters.push(best);
        pool = pool.filter((h2) => clusterOf(h2.j)[level] === best);
      }
      return {
        x: Math.round((sx / sw + Math.cos(angle) * radius) * 1e4) / 1e4,
        y: Math.round((sy / sw + Math.sin(angle) * radius) * 1e4) / 1e4,
        clusters,
        from: near,
      };
    },
  };
}

/** Minimum text similarity of a "close but they do not look it" pair. */
export const SURPRISING_MIN_TEXT = Math.max(0.2, TEXT_REASON_MIN);

export interface SurprisingPair {
  a: number;
  b: number;
  text: number;
}

/** A neighbour that is close by text and shares no tag, no citation and no folder with the document. */
export const isSurprising = (n: Neighbor): boolean => n.text >= SURPRISING_MIN_TEXT && n.tagShared === 0 && n.citShared === 0 && !n.direct && !n.sameFolder;

/** The surprising pairs of the model, for one document (index) or the whole library, strongest first. */
export function surprisingPairs(model: GraphModel, options: { doc?: number | undefined; limit: number }): SurprisingPair[] {
  const out: SurprisingPair[] = [];
  const seen = new Set<number>();
  const from = options.doc ?? 0;
  const to = options.doc === undefined ? model.ids.length : options.doc + 1;
  for (let i = from; i < to; i++) {
    for (const n of neighborsOf(model, i)) {
      if (!isSurprising(n)) continue;
      const a = Math.min(i, n.j);
      const b = Math.max(i, n.j);
      const key = a * 4_294_967_296 + b;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a, b, text: n.text });
    }
  }
  out.sort((p, q) => q.text - p.text || p.a - q.a || p.b - q.b);
  return out.slice(0, options.limit);
}
