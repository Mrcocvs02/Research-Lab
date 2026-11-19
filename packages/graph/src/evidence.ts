/**
 * Evidence between papers (D-499, sections 19.2.3 and 19.2.5): citations and links of the user count 1, similarity counts its weight, and
 * similarity below the library threshold tau never makes an edge. At most k edges per paper; the shortest path over the evidence is a
 * Dijkstra. Pure: the caller reads the model, the citations and the links.
 */
export type Strictness = 'strict' | 'normal' | 'wide';
export type EvidenceKind = 'cites' | 'linked' | 'similar';
export interface EvidenceEdge {
  a: string;
  b: string;
  e: number;
  kinds: EvidenceKind[];
  w?: number | undefined;
}

export const EDGES_PER_NODE = 5;
/** Neighbours of each paper that give the weights the threshold is read from. */
export const TAU_NEIGHBORS = 10;
const TAU_SMALL = 0.25;
const TAU_MIN_DOCS = 8;
/** Percentile and bounds of tau for each strictness. */
const TAU: Record<Strictness, [number, number, number]> = { strict: [0.9, 0.2, 0.6], normal: [0.75, 0.15, 0.5], wide: [0.5, 0.1, 0.4] };
/** Path: similarity counts from this share of tau, each step costs 1 - e + STEP, at most MAX_STEPS steps. */
export const PATH_TAU_SHARE = 0.75;
const STEP_COST = 0.15;
export const MAX_STEPS = 6;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Percentile (linear between ranks) of values sorted ascending. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const at = p * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/** The weights tau is read from: for each paper the `TAU_NEIGHBORS` heaviest of its similarity weights. */
export function topWeights(perDoc: Iterable<readonly number[]>): number[] {
  const out: number[] = [];
  for (const ws of perDoc) out.push(...[...ws].sort((x, y) => y - x).slice(0, TAU_NEIGHBORS));
  return out.sort((x, y) => x - y);
}

/** Similarity threshold of the library; `sortedWeights` as given by `topWeights`. With fewer than 8 papers a fixed 0.25. */
export function similarityThreshold(sortedWeights: readonly number[], strictness: Strictness, docs: number): number {
  if (docs < TAU_MIN_DOCS || sortedWeights.length === 0) return TAU_SMALL;
  const [p, lo, hi] = TAU[strictness];
  return Math.round(clamp(percentile(sortedWeights, p), lo, hi) * 1000) / 1000;
}

export interface EvidenceInput {
  /** Similarity weight of a pair (either order; the heaviest wins). */
  similar: ReadonlyArray<{ a: string; b: string; w: number }>;
  /** Citation pairs (either direction) and links of the user. */
  cites: ReadonlyArray<readonly [string, string]>;
  links: ReadonlyArray<readonly [string, string]>;
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

/** Every pair with evidence: explicit (citation, link) always, similarity from `minSimilar`. The score is the sum, capped at 1. */
export function pairEvidence(input: EvidenceInput, minSimilar: number): EvidenceEdge[] {
  const pairs = new Map<string, { a: string; b: string; cites: boolean; linked: boolean; w: number }>();
  const get = (x: string, y: string) => {
    const k = pairKey(x, y);
    let p = pairs.get(k);
    if (!p) pairs.set(k, (p = { a: x < y ? x : y, b: x < y ? y : x, cites: false, linked: false, w: 0 }));
    return p;
  };
  for (const [x, y] of input.cites) if (x !== y) get(x, y).cites = true;
  for (const [x, y] of input.links) if (x !== y) get(x, y).linked = true;
  for (const s of input.similar) if (s.a !== s.b && s.w >= minSimilar && s.w > 0) {
    const p = get(s.a, s.b);
    p.w = Math.max(p.w, Math.min(1, s.w));
  }
  const out: EvidenceEdge[] = [];
  for (const p of pairs.values()) {
    const kinds: EvidenceKind[] = [];
    if (p.cites) kinds.push('cites');
    if (p.linked) kinds.push('linked');
    if (p.w > 0) kinds.push('similar');
    if (kinds.length === 0) continue;
    const e = Math.min(1, (p.cites ? 1 : 0) + (p.linked ? 1 : 0) + p.w);
    out.push({ a: p.a, b: p.b, e: Math.round(e * 1000) / 1000, kinds, ...(p.w > 0 ? { w: Math.round(p.w * 1000) / 1000 } : {}) });
  }
  return out;
}

const explicit = (e: EvidenceEdge): boolean => e.kinds.length > 1 || e.kinds[0] !== 'similar';
/** Strongest first; at equal score the explicit ones, then by ids. */
const stronger = (x: EvidenceEdge, y: EvidenceEdge): number => y.e - x.e || Number(explicit(y)) - Number(explicit(x)) || cmp(x.a, y.a) || cmp(x.b, y.b);

/** The edges of the Map: similarity only from tau, and each paper keeps its `k` strongest (an edge stays if either end keeps it): at most k x papers. */
export function buildEvidence(input: EvidenceInput, tau: number, k = EDGES_PER_NODE): EvidenceEdge[] {
  const all = pairEvidence(input, tau).sort(stronger);
  const keep = new Set<EvidenceEdge>();
  // Each paper picks its k strongest; an edge stays when either end picked it.
  const own = new Map<string, EvidenceEdge[]>();
  for (const e of all) {
    for (const end of [e.a, e.b]) {
      const list = own.get(end) ?? own.set(end, []).get(end)!;
      if (list.length < k) list.push(e);
    }
  }
  for (const list of own.values()) for (const e of list) keep.add(e);
  return all.filter((e) => keep.has(e));
}

/** Shortest chain from `from` to `to` over the evidence (similarity from 0.75 tau): cost 1 - e + 0.15 a step, at most 6 steps. Empty when none. */
export function findPath(input: EvidenceInput, tau: number, from: string, to: string): EvidenceEdge[] {
  if (from === to) return [];
  const edges = pairEvidence(input, Math.round(tau * PATH_TAU_SHARE * 1000) / 1000);
  const adj = new Map<string, Array<{ to: string; edge: EvidenceEdge }>>();
  for (const e of edges) {
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push({ to: e.b, edge: e });
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push({ to: e.a, edge: e });
  }
  for (const list of adj.values()) list.sort((x, y) => cmp(x.to, y.to));
  // Dijkstra over (paper, steps taken): the step limit is part of the state.
  type Entry = { cost: number; node: string; steps: number; prev: Entry | null; edge: EvidenceEdge | null };
  const heap: Entry[] = [{ cost: 0, node: from, steps: 0, prev: null, edge: null }];
  const less = (x: Entry, y: Entry) => x.cost - y.cost || x.steps - y.steps || cmp(x.node, y.node);
  const push = (v: Entry) => {
    heap.push(v);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(heap[p]!, heap[i]!) <= 0) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = (): Entry => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l]!, heap[m]!) < 0) m = l;
        if (r < heap.length && less(heap[r]!, heap[m]!) < 0) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  const best = new Map<string, number>();
  while (heap.length > 0) {
    const cur = pop();
    if (cur.node === to) {
      const out: EvidenceEdge[] = [];
      for (let c: Entry | null = cur; c?.edge; c = c.prev) out.unshift(c.edge);
      return out;
    }
    const key = `${cur.node}\u0000${cur.steps}`;
    if (best.has(key)) continue;
    best.set(key, cur.cost);
    if (cur.steps >= MAX_STEPS) continue;
    for (const n of adj.get(cur.node) ?? []) {
      if (best.has(`${n.to}\u0000${cur.steps + 1}`)) continue;
      push({ cost: cur.cost + 1 - n.edge.e + STEP_COST, node: n.to, steps: cur.steps + 1, prev: cur, edge: n.edge });
    }
  }
  return [];
}
