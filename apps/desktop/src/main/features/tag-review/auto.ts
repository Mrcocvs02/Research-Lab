import type { TagAutoMode } from '@rl/core';
import type { CleanupInput, Proposal } from '@rl/data/tag-vocabulary';

/**
 * "Accept all", automatic acceptance and Haiku's decisions (D-512): which proposals may be taken without a look. Sure and likely ones
 * only (never "maybe"), minus what the real-data audit showed must stay a human choice: a macro-area folded into keywords, a merge
 * across different families or between a topic and a keyword, a pair marked distinct.
 */
type AutoNode = CleanupInput['nodes'][number];
type Distinct = ReadonlyArray<{ a: string; b: string }> | undefined;

const isMerge = (p: Proposal): boolean => p.kind === 'merge' || (p.kind === 'twins' && (p.action ?? 'merge') === 'merge');

/** The guardrails as questions about tags, shared by the three ways in (Accept all, automatic mode, Haiku). */
export function guards(nodes: readonly AutoNode[], distinct: Distinct) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rootOf = (id: string): AutoNode | undefined => {
    let n = byId.get(id);
    for (let i = 0; n && n.parents.length > 0 && n.family === undefined && i < 50; i++) n = byId.get(n.parents[0] as string);
    return n;
  };
  const familyOf = (id: string) => byId.get(id)?.family ?? rootOf(id)?.family;
  const topical = (id: string) => byId.get(id)?.group === 'macro' || byId.get(id)?.group === 'micro' || (familyOf(id) !== undefined && familyOf(id) !== 'keywords');
  const key = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  const bad = new Set((distinct ?? []).map((d) => key(d.a, d.b)));
  const isDistinct = (tags: readonly string[]) => tags.some((a, i) => tags.slice(i + 1).some((b) => bad.has(key(a, b))));
  return {
    /** Tags that may be merged into one. */
    merge(tags: readonly string[]): boolean {
      if (isDistinct(tags)) return false;
      const fams = new Set(tags.map((t) => familyOf(t) ?? ''));
      if (fams.size > 1 && [...fams].some((f) => f !== '')) return false;
      return !(tags.some((t) => byId.get(t)?.group === 'macro') && tags.some((t) => familyOf(t) === 'keywords'));
    },
    /** Twins sent to Keywords: never the ones that are topics. */
    keywords: (tags: readonly string[]) => !tags.some(topical),
    /** `child` goes under `parent`. */
    parent: (parent: string, child: string): boolean => familyOf(parent) !== 'keywords' && byId.get(child)?.group !== 'macro',
  };
}

export function acceptableIds(proposals: readonly Proposal[], nodes: readonly AutoNode[], distinct: Distinct, mode: Exclude<TagAutoMode, 'off'>, dedupe = true): string[] {
  const g = guards(nodes, distinct);
  const sureOnly = mode === 'sure' || mode === 'sureHaiku';
  const ok = (p: Proposal): boolean => {
    if (p.confidence === 'maybe' || (sureOnly && !(p.confidence === 'sure' && (p.kind === 'merge' || p.kind === 'name')))) return false;
    if (isMerge(p)) return g.merge(p.tags);
    if (p.kind === 'twins') return g.keywords(p.tags);
    if (p.kind === 'parent' || p.kind === 'promote') return g.parent(p.tags[0] as string, p.tags[1] as string);
    return true;
  };
  if (!dedupe) return proposals.filter(ok).map((p) => p.id);
  // Overlaps would make one proposal refer to a tag another one removes ("unknown node"): sure first, the first merge of a tag wins.
  const rank = { sure: 0, likely: 1, maybe: 2 } as const;
  const touched = new Set<string>();
  const removed = new Set<string>();
  const out: string[] = [];
  for (const p of [...proposals].filter(ok).sort((a, b) => rank[a.confidence] - rank[b.confidence])) {
    if (isMerge(p)) {
      if (p.tags.some((t) => touched.has(t))) continue;
      for (const t of p.tags) touched.add(t);
      for (const t of p.tags) if (t !== p.keep) removed.add(t);
    } else if (p.tags.some((t) => removed.has(t))) continue;
    out.push(p.id);
  }
  return out;
}
