import type { RawEdge, RawNode } from './forceSim';

/** Pure rules of the neighbourhood view (section 19.2.5): how many papers each ring holds and which edges are drawn. */
export const RING1 = 8;
export const RING1_MAX = 16;
export const RING2_PER_NODE = 3;
export const VICINITY_MAX_NODES = 30;
export const EDGES_PER_NODE = 4;
/** Only edges of evidence: citations, links of the user, similarity. */
export const EVIDENCE_KINDS = ['similar', 'cites', 'linked'] as const;

/**
 * Among the papers an expansion of `fromKey` returned, the `n` strongest that are not in the network yet, with the edges among them and the
 * papers already there. Strength is the weight of the edge to `fromKey`.
 */
export function strongestNew(nodes: readonly RawNode[], edges: readonly RawEdge[], fromKey: string, present: ReadonlySet<string>, n: number): { nodes: RawNode[]; edges: RawEdge[] } {
  const w = new Map<string, number>();
  for (const e of edges) {
    const other = e.from === fromKey ? e.to : e.to === fromKey ? e.from : null;
    if (other !== null) w.set(other, Math.max(w.get(other) ?? 0, e.weight));
  }
  const keyOf = (r: RawNode): string => `${r.kind}:${r.id}`;
  const picked = nodes
    .filter((r) => r.kind === 'doc' && !present.has(keyOf(r)))
    .sort((a, b) => (w.get(keyOf(b)) ?? 0) - (w.get(keyOf(a)) ?? 0) || (keyOf(a) < keyOf(b) ? -1 : 1))
    .slice(0, Math.max(0, n));
  const keep = new Set([...present, fromKey, ...picked.map(keyOf)]);
  return { nodes: picked, edges: edges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
}

/** Ring 1 keeps only evidence above the threshold of the library: similarity edges lighter than `tau` go, citations and links stay. */
export function aboveTau<E extends { kind: string; weight: number }>(edges: readonly E[], tau: number): E[] {
  return edges.filter((e) => e.kind !== 'similar' || e.weight >= tau);
}

/** At most `max` edges for each paper, the strongest first; every edge of the centre is kept. */
export function capEdges<E extends { a: string; b: string; weight: number }>(edges: readonly E[], center: string | null, max = EDGES_PER_NODE): E[] {
  const deg = new Map<string, number>();
  const bump = (k: string): void => void deg.set(k, (deg.get(k) ?? 0) + 1);
  const out: E[] = [];
  const sorted = [...edges].sort((x, y) => y.weight - x.weight);
  for (const e of sorted) if (e.a === center || e.b === center) (out.push(e), bump(e.a), bump(e.b));
  for (const e of sorted) {
    if (e.a === center || e.b === center) continue;
    if ((deg.get(e.a) ?? 0) >= max || (deg.get(e.b) ?? 0) >= max) continue;
    out.push(e);
    bump(e.a);
    bump(e.b);
  }
  return out;
}

/** Order of the steps of a path chain: the steps come as a list of edges, the chain walks from `a` to `b`. */
export function chainOf(a: string, steps: ReadonlyArray<{ a: string; b: string }>): string[] {
  const out = [a];
  for (const s of steps) {
    const last = out[out.length - 1]!;
    out.push(s.a === last ? s.b : s.a);
  }
  return out;
}
