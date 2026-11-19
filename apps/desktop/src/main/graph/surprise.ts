import type { SurprisingPair } from '@rl/graph';

/**
 * "Sorprendimi" (D-492): a surprise must be a link the user does not know yet. The model already drops pairs that share a
 * tag, a folder or a citation key; this adds what the model cannot see: citations between the two (either way), links made
 * by hand or by the finder, pairs the user dismissed, and shared authors. Pairs across different clusters come first.
 */
export interface NoveltyContext {
  /** Unordered pair keys (`a|b`, smaller id first) of every relation the user already has. */
  known: ReadonlySet<string>;
  authorsOf(id: string): readonly string[];
  /** Top-level cluster of a document index, or undefined. */
  clusterOf(i: number): number | undefined;
  idOf(i: number): string;
  /** Terms the two documents share (real evidence). */
  termsOf(a: number, b: number): readonly string[];
}

/** The fewest shared terms a surprise needs: one word in common is a coincidence, not evidence. */
export const MIN_SHARED_TERMS = 2;

export const pairKeyOf = (x: string, y: string): string => (x < y ? `${x}|${y}` : `${y}|${x}`);

/** Known pairs from citation files (`docId` with the ids it cites or is cited by), doc links and dismissed pairs. */
export function knownPairs(cites: Iterable<{ docId: string; others: Iterable<string> }>, linked: Iterable<{ a: string; b: string }>): Set<string> {
  const out = new Set<string>();
  for (const c of cites) for (const o of c.others) if (o !== c.docId) out.add(pairKeyOf(c.docId, o));
  for (const l of linked) out.add(pairKeyOf(l.a, l.b));
  return out;
}

const norm = (s: string) => s.trim().toLowerCase();

/** The pairs that are new to the user, cross-cluster first; empty when nothing passes (never falls back to known ones). */
export function novelPairs(pairs: readonly SurprisingPair[], ctx: NoveltyContext): Array<SurprisingPair & { terms: string[] }> {
  const out: Array<SurprisingPair & { terms: string[]; rank: number }> = [];
  for (const p of pairs) {
    if (ctx.known.has(pairKeyOf(ctx.idOf(p.a), ctx.idOf(p.b)))) continue;
    const mine = new Set(ctx.authorsOf(ctx.idOf(p.a)).map(norm));
    if (ctx.authorsOf(ctx.idOf(p.b)).some((x) => mine.has(norm(x)))) continue;
    const terms = [...ctx.termsOf(p.a, p.b)];
    if (terms.length < MIN_SHARED_TERMS) continue;
    const ca = ctx.clusterOf(p.a);
    const cb = ctx.clusterOf(p.b);
    const across = ca !== undefined && cb !== undefined && ca !== cb;
    out.push({ ...p, terms, rank: p.text * (across ? 1 : 0.5) });
  }
  out.sort((x, y) => y.rank - x.rank || x.a - y.a || x.b - y.b);
  return out.map(({ rank: _r, ...rest }) => rest);
}
