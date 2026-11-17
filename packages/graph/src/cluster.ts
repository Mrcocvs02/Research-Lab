import { makeRandom, shuffledRange } from './random.js';
import type { Edge, SparseVec } from './types.js';

/** Weighted undirected graph in compressed rows; self loops are kept apart. */
interface Csr {
  n: number;
  start: Int32Array;
  to: Int32Array;
  w: Float64Array;
  self: Float64Array;
}

function toCsr(n: number, edges: readonly Edge[]): Csr {
  const deg = new Int32Array(n + 1);
  const self = new Float64Array(n);
  for (const e of edges) {
    if (e.a === e.b) continue;
    deg[e.a + 1] = (deg[e.a + 1] as number) + 1;
    deg[e.b + 1] = (deg[e.b + 1] as number) + 1;
  }
  for (let i = 0; i < n; i++) deg[i + 1] = (deg[i + 1] as number) + (deg[i] as number);
  const fill = deg.slice(0, n);
  const to = new Int32Array(deg[n] as number);
  const w = new Float64Array(deg[n] as number);
  for (const e of edges) {
    if (e.a === e.b) {
      self[e.a] = (self[e.a] as number) + e.w;
      continue;
    }
    let p = fill[e.a] as number;
    to[p] = e.b;
    w[p] = e.w;
    fill[e.a] = p + 1;
    p = fill[e.b] as number;
    to[p] = e.a;
    w[p] = e.w;
    fill[e.b] = p + 1;
  }
  return { n, start: deg, to, w, self };
}

/** Merges parallel edges (a, b) and (b, a): the same neighbour is listed once with the largest weight. */
export function symmetrize(edges: readonly Edge[]): Edge[] {
  const best = new Map<number, Edge>();
  for (const e of edges) {
    const a = Math.min(e.a, e.b);
    const b = Math.max(e.a, e.b);
    const key = a * 4_294_967_296 + b;
    const cur = best.get(key);
    if (!cur || e.w > cur.w) best.set(key, { a, b, w: e.w });
  }
  return [...best.values()].sort((p, q) => p.a - q.a || p.b - q.b);
}

/** One pass of local moves; returns the community of each node and whether anything moved. */
function localMoving(g: Csr, rnd: () => number): { comm: Int32Array; moved: boolean } {
  const { n, start, to, w, self } = g;
  const comm = new Int32Array(n);
  const deg = new Float64Array(n);
  const tot = new Float64Array(n);
  let m2 = 0;
  for (let i = 0; i < n; i++) {
    comm[i] = i;
    let d = 2 * (self[i] as number);
    for (let p = start[i] as number; p < (start[i + 1] as number); p++) d += w[p] as number;
    deg[i] = d;
    tot[i] = d;
    m2 += d;
  }
  if (m2 === 0) return { comm, moved: false };
  const toComm = new Float64Array(n);
  const touched: number[] = [];
  let moved = false;
  for (let pass = 0; pass < 25; pass++) {
    let changed = 0;
    for (const i of shuffledRange(n, rnd)) {
      const old = comm[i] as number;
      touched.length = 0;
      for (let p = start[i] as number; p < (start[i + 1] as number); p++) {
        const c = comm[to[p] as number] as number;
        if (toComm[c] === 0) touched.push(c);
        toComm[c] = (toComm[c] as number) + (w[p] as number);
      }
      tot[old] = (tot[old] as number) - (deg[i] as number);
      let best = old;
      let bestGain = (toComm[old] as number) - ((tot[old] as number) * (deg[i] as number)) / m2;
      for (const c of touched) {
        const gain = (toComm[c] as number) - ((tot[c] as number) * (deg[i] as number)) / m2;
        if (gain > bestGain + 1e-12) {
          best = c;
          bestGain = gain;
        }
      }
      tot[best] = (tot[best] as number) + (deg[i] as number);
      for (const c of touched) toComm[c] = 0;
      toComm[old] = 0;
      if (best !== old) {
        comm[i] = best;
        changed++;
      }
    }
    if (changed === 0) break;
    moved = true;
  }
  return { comm, moved };
}

/** Renumbers communities 0..c-1 by first appearance (deterministic); returns the count. */
function compact(comm: Int32Array): number {
  const map = new Map<number, number>();
  for (let i = 0; i < comm.length; i++) {
    let c = map.get(comm[i] as number);
    if (c === undefined) map.set(comm[i] as number, (c = map.size));
    comm[i] = c;
  }
  return map.size;
}

function aggregate(g: Csr, comm: Int32Array, count: number): Csr {
  const self = new Float64Array(count);
  const between = new Map<number, number>();
  for (let i = 0; i < g.n; i++) {
    const ci = comm[i] as number;
    self[ci] = (self[ci] as number) + (g.self[i] as number);
    for (let p = g.start[i] as number; p < (g.start[i + 1] as number); p++) {
      const cj = comm[g.to[p] as number] as number;
      if (cj === ci) self[ci] = (self[ci] as number) + (g.w[p] as number) / 2;
      else if (ci < cj) between.set(ci * count + cj, (between.get(ci * count + cj) ?? 0) + (g.w[p] as number));
    }
  }
  const edges: Edge[] = [...between.entries()].sort((p, q) => p[0] - q[0]).map(([key, w]) => ({ a: Math.floor(key / count), b: key % count, w }));
  const out = toCsr(count, edges);
  out.self.set(self);
  return out;
}

/** Louvain modularity optimisation (random node order from the seed): the community of each node, 0..c-1. */
export function louvain(n: number, edges: readonly Edge[], seed: number): Int32Array {
  const rnd = makeRandom(seed);
  let g = toCsr(n, edges);
  const node = new Int32Array(n);
  for (let i = 0; i < n; i++) node[i] = i;
  for (let level = 0; level < 12; level++) {
    const { comm, moved } = localMoving(g, rnd);
    if (!moved) break;
    const count = compact(comm);
    for (let i = 0; i < n; i++) node[i] = comm[node[i] as number] as number;
    if (count === g.n) break;
    g = aggregate(g, comm, count);
  }
  compact(node);
  return node;
}

export interface ClusterNode {
  /** Index of this cluster in the returned array. */
  index: number;
  parent: number;
  level: number;
  members: number[];
}

export interface HierarchyOptions {
  /** A cluster of at least this size is split again (default 16). */
  minSplit?: number;
  /** Communities smaller than this are merged into the neighbour they are most linked to (default 3). */
  minSize?: number;
  /** Levels, the coarsest included (default 3). */
  maxLevels?: number;
}

/**
 * Clusters of a graph in levels (0 = coarsest): Louvain on the whole graph, then again inside every cluster that is
 * large enough, as long as it splits in at least two. Same seed and graph, same clusters.
 */
export function clusterHierarchy(n: number, edges: readonly Edge[], seed: number, options: HierarchyOptions = {}): ClusterNode[] {
  const minSplit = options.minSplit ?? 16;
  const minSize = options.minSize ?? 3;
  const maxLevels = options.maxLevels ?? 3;
  const adj = toCsr(n, edges);
  const out: ClusterNode[] = [];
  const local = new Int32Array(n).fill(-1);

  const partition = (members: number[], topLevel: boolean, salt: number): number[][] => {
    members.forEach((m, k) => (local[m] = k));
    const sub: Edge[] = [];
    for (const m of members) {
      for (let p = adj.start[m] as number; p < (adj.start[m + 1] as number); p++) {
        const o = adj.to[p] as number;
        if (o > m && (local[o] as number) >= 0) sub.push({ a: local[m] as number, b: local[o] as number, w: adj.w[p] as number });
      }
    }
    const comm = louvain(members.length, sub, seed + salt * 7919);
    let groups: number[][] = [];
    comm.forEach((c, k) => ((groups[c] ??= []).push(members[k] as number)));
    // Small communities join the group they are most linked to; those linked to none go to the largest (or, at the top, together).
    const small = groups.map((g, gi) => [g, gi] as const).filter(([g]) => g.length < minSize);
    if (small.length > 0 && small.length < groups.length) {
      const owner = new Int32Array(n).fill(-1);
      groups.forEach((g, gi) => g.forEach((m) => (owner[m] = gi)));
      const dropped = new Set<number>();
      const loners: number[] = [];
      for (const [g, gi] of small.sort((p, q) => p[0].length - q[0].length)) {
        const link = new Map<number, number>();
        for (const m of g) {
          for (let p = adj.start[m] as number; p < (adj.start[m + 1] as number); p++) {
            const o = adj.to[p] as number;
            const og = owner[o] as number;
            if (og >= 0 && og !== gi && !dropped.has(og) && (local[o] as number) >= 0) link.set(og, (link.get(og) ?? 0) + (adj.w[p] as number));
          }
        }
        let best = -1;
        let bw = 0;
        for (const [og, wt] of [...link.entries()].sort((p, q) => p[0] - q[0])) if (wt > bw) [best, bw] = [og, wt];
        if (best >= 0) {
          for (const m of g) {
            (groups[best] as number[]).push(m);
            owner[m] = best;
          }
        } else loners.push(...g);
        dropped.add(gi);
      }
      groups = groups.filter((_, gi) => !dropped.has(gi));
      if (loners.length > 0) {
        if (topLevel) groups.push(loners);
        else {
          const largest = groups.reduce((bi, g, gi) => (g.length > (groups[bi] as number[]).length ? gi : bi), 0);
          (groups[largest] as number[]).push(...loners);
        }
      }
    }
    for (const m of members) local[m] = -1;
    return groups.map((g) => g.sort((p, q) => p - q)).sort((p, q) => q.length - p.length || (p[0] as number) - (q[0] as number));
  };

  if (n > 0) {
    // Level 0 always exists, even when the graph does not split.
    let current: ClusterNode[] = [];
    for (const g of partition(Array.from({ length: n }, (_, i) => i), true, 0)) {
      const node: ClusterNode = { index: out.length, parent: -1, level: 0, members: g };
      out.push(node);
      current.push(node);
    }
    for (let level = 1; level < maxLevels; level++) {
      const next: ClusterNode[] = [];
      for (const parent of current) {
        if (parent.members.length < minSplit) continue;
        const groups = partition(parent.members, false, parent.index + 1);
        if (groups.length < 2) continue;
        for (const g of groups) {
          const node: ClusterNode = { index: out.length, parent: parent.index, level, members: g };
          out.push(node);
          next.push(node);
        }
      }
      current = next;
    }
  }
  return out;
}

/**
 * The words that set a group of documents apart: the mean weight of a word in the group, boosted by how much
 * more it weighs there than in the whole corpus.
 */
export function topTermsOf(vectors: readonly SparseVec[], members: readonly number[], terms: readonly string[], globalMean: Float64Array, limit: number): string[] {
  const sum = new Map<number, number>();
  for (const m of members) {
    const v = vectors[m] as SparseVec;
    for (let k = 0; k < v.i.length; k++) sum.set(v.i[k] as number, (sum.get(v.i[k] as number) ?? 0) + (v.w[k] as number));
  }
  const scored: Array<[number, number]> = [];
  for (const [t, s] of sum) {
    const mean = s / members.length;
    scored.push([t, mean * Math.log(1 + mean / ((globalMean[t] as number) + 1e-9))]);
  }
  scored.sort((p, q) => q[1] - p[1] || p[0] - q[0]);
  return scored.slice(0, limit).map(([t]) => terms[t] as string);
}

/** Mean weight of every term over all documents. */
export function globalMeans(vectors: readonly SparseVec[], nTerms: number): Float64Array {
  const mean = new Float64Array(nTerms);
  for (const v of vectors) for (let k = 0; k < v.i.length; k++) mean[v.i[k] as number] = (mean[v.i[k] as number] as number) + (v.w[k] as number);
  for (let t = 0; t < nTerms; t++) mean[t] = (mean[t] as number) / Math.max(1, vectors.length);
  return mean;
}
