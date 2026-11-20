import type { EvEdge } from './edges';

/** Isolated papers and unlinked pairs of blocks of the Map (D-526, section 20.6): pure, from the evidence edges already loaded. */
export const MAX_GAP_PAIRS = 6;

/** Whether an edge counts as evidence: a citation or a link always, a similarity only from the threshold of the library. */
const counts = (e: EvEdge, tau: number | null): boolean => e.kinds.some((k) => k !== 'similar') || tau === null || (e.w ?? e.e) >= tau - 1e-9;

/**
 * Papers with no evidence edge at all: no citation, no link, no similarity at or above `tau` (the evidence the Map loads is already cut at it;
 * pass `tau` to cut again, for instance after the viewer changed the threshold). Only the papers of `ids` are judged.
 */
export function isolatedOf(ids: readonly string[], edges: readonly EvEdge[], tau: number | null = null): Set<string> {
  const known = new Set(ids);
  const linked = new Set<string>();
  for (const e of edges) if (e.a !== e.b && known.has(e.a) && known.has(e.b) && counts(e, tau)) (linked.add(e.a), linked.add(e.b));
  return new Set(ids.filter((id) => !linked.has(id)));
}

export interface GapBlock {
  id: string;
  /** "Other" and "No value" are never part of a pair. */
  other?: boolean;
  none?: boolean;
  docs: readonly string[];
}
export interface GapPair {
  /** Positions of the two blocks in the list given. */
  a: number;
  b: number;
  /** Papers in each block. */
  na: number;
  nb: number;
}

/**
 * Pairs of blocks (each with at least 2 papers, "Other" and "No value" left out) with no evidence edge between their papers. With k blocks
 * there are at most k(k-1)/2 pairs; the `max` biggest are returned, by the product of the sizes, then by position.
 */
export function gapPairs(blocks: readonly GapBlock[], edges: readonly EvEdge[], tau: number | null = null, max = MAX_GAP_PAIRS): GapPair[] {
  const of = new Map<string, number>();
  blocks.forEach((b, i) => {
    if (!b.other && !b.none && b.docs.length >= 2) for (const d of b.docs) of.set(d, i);
  });
  const tied = new Set<number>();
  const n = blocks.length;
  for (const e of edges) {
    const x = of.get(e.a);
    const y = of.get(e.b);
    if (x === undefined || y === undefined || x === y || !counts(e, tau)) continue;
    tied.add(Math.min(x, y) * n + Math.max(x, y));
  }
  const eligible = blocks.map((_, i) => i).filter((i) => !blocks[i]!.other && !blocks[i]!.none && blocks[i]!.docs.length >= 2);
  const out: GapPair[] = [];
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i]!;
      const b = eligible[j]!;
      if (!tied.has(a * n + b)) out.push({ a, b, na: blocks[a]!.docs.length, nb: blocks[b]!.docs.length });
    }
  }
  return out.sort((p, q) => q.na * q.nb - p.na * p.nb || p.a - q.a || p.b - q.b).slice(0, max);
}

/** The paper with the most evidence edges (the most central one), ties by `central` (higher first) then id; null when `docs` is empty. */
export function mostCentral(docs: readonly string[], edges: readonly EvEdge[], central?: (id: string) => number): string | null {
  const own = new Set(docs);
  const deg = new Map<string, number>();
  for (const e of edges) {
    if (e.a === e.b) continue;
    if (own.has(e.a)) deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
    if (own.has(e.b)) deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const d of docs) {
    if (best === null) best = d;
    else {
      const x = (deg.get(d) ?? 0) - (deg.get(best) ?? 0) || (central?.(d) ?? 0) - (central?.(best) ?? 0);
      if (x > 0 || (x === 0 && d < best)) best = d;
    }
  }
  return best;
}
