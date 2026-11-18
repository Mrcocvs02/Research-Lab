import type { AiTagScore } from '@rl/core';

/** The part of a taxonomy node the graph helpers need. */
export interface GraphNode {
  id: string;
  parents: readonly string[];
  implies?: readonly string[] | undefined;
}

/** Weight an ancestor inherits per level of distance (D-447: x0.7 per level). */
export const ANCESTOR_DECAY = 0.7;
/** Pairs with a weight below this are not proposed (D-447: a relevance threshold, not a count). */
export const TAG_MIN_WEIGHT = 0.3;
/** Most tags one document can be proposed (a safety cap, far above the 8-20 the prompt aims at). */
export const TAG_HARD_CAP = 60;

/** Ancestors of a node with their distance (a tag brings its parents and its implied nodes). Cycles and depth are bounded. */
export function ancestorsOf(byId: ReadonlyMap<string, GraphNode>, id: string, maxDepth = 12): Map<string, number> {
  const out = new Map<string, number>();
  let level = [id];
  for (let d = 1; d <= maxDepth && level.length > 0; d++) {
    const next: string[] = [];
    for (const cur of level) {
      const n = byId.get(cur);
      for (const p of [...(n?.parents ?? []), ...(n?.implies ?? [])]) {
        if (p === id || out.has(p) || !byId.has(p)) continue;
        out.set(p, d);
        next.push(p);
      }
    }
    level = next;
  }
  return out;
}

/**
 * Hierarchical closure (D-446 c, D-447): the chosen tags plus all their ancestors. A chosen tag keeps its weight; an ancestor
 * takes the best of `weight x 0.7^distance` over the chosen descendants (the maximum when it comes from several), or its
 * own weight when it was chosen too. Sorted by weight, highest first.
 */
export function closeTags(nodes: readonly GraphNode[], chosen: ReadonlyArray<{ id: string; weight: number; reason?: string | undefined }>, decay = ANCESTOR_DECAY): AiTagScore[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const best = new Map<string, AiTagScore>();
  for (const c of chosen) {
    if (!byId.has(c.id)) continue;
    const prev = best.get(c.id);
    if (!prev || c.weight > prev.weight) best.set(c.id, { id: c.id, weight: c.weight, origin: 'ai', ...(c.reason ? { reason: c.reason } : {}) });
  }
  const direct = [...best.values()];
  for (const t of direct) {
    for (const [anc, dist] of ancestorsOf(byId, t.id)) {
      const w = Math.round(t.weight * decay ** dist * 1000) / 1000;
      const cur = best.get(anc);
      if (!cur || (cur.origin === 'ancestor' && w > cur.weight)) best.set(anc, { id: anc, weight: w, origin: 'ancestor' });
    }
  }
  return [...best.values()].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
}
