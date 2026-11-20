import type { EvEdge } from './edges';

/** "Next to read" of the Map (D-525, section 20.5): a pure choice over the evidence edges already loaded, no call to anything. */
export type ReadState = ReadonlyMap<string, 1 | 2>;

/** The link that explains a pick: the other paper and what ties the two. */
export interface PickLink {
  id: string;
  kind: 'cites' | 'linked' | 'similar';
  /** The strength of the evidence: 1 for a citation or a link of the user, the similarity otherwise. */
  e: number;
}
export interface NextPick {
  id: string;
  /** 1 = a direct neighbour of the start, 2 = two steps away, 0 = chosen with no start. */
  step: 0 | 1 | 2;
  /** The strongest tie of the pick to a paper already read. */
  read: PickLink | null;
  /** The tie to the start (step 1) or to the paper in between (step 2), and that paper. */
  from: PickLink | null;
  via?: string;
}
export interface NextOptions {
  /** The papers of the Map: the candidates when there is no start. Without it the papers the edges name are used. */
  ids?: readonly string[];
  /** Block of a paper: a tie is broken in favour of the pick that sits in the block of the start. */
  blockOf?(id: string): string | undefined;
  /** Centrality of a paper (`az`), the last tie-break of the pick with no start. */
  central?(id: string): number;
}

const explicit = (e: EvEdge): boolean => e.kinds.includes('cites') || e.kinds.includes('linked');
const kindOf = (e: EvEdge): PickLink['kind'] => (e.kinds.includes('linked') ? 'linked' : e.kinds.includes('cites') ? 'cites' : 'similar');
/** Strength of an edge, never below 0. */
const strength = (e: EvEdge): number => Math.max(0, e.e);

interface Adj {
  to: string;
  edge: EvEdge;
}
function adjacency(edges: readonly EvEdge[], known: ReadonlySet<string> | null): Map<string, Adj[]> {
  const adj = new Map<string, Adj[]>();
  const add = (a: string, b: string, edge: EvEdge) => {
    const l = adj.get(a);
    if (l) l.push({ to: b, edge });
    else adj.set(a, [{ to: b, edge }]);
  };
  for (const e of edges) {
    if (e.a === e.b || (known && (!known.has(e.a) || !known.has(e.b)))) continue;
    add(e.a, e.b, e);
    add(e.b, e.a, e);
  }
  return adj;
}
const link = (to: string, edge: EvEdge): PickLink => ({ id: to, kind: kindOf(edge), e: strength(edge) });

/**
 * The next paper to read. `state`: 1 = in studio, 2 = read, absent = to read; a paper is "unread" unless it is 2.
 * 1. From a paper (or a selection: the union of their edges): the unread neighbour with the strongest evidence; on a tie explicit evidence (a
 *    citation or a link) first, then the block of the start, then the id.
 * 2. With no unread direct neighbour: at most two steps, scored e1 * e2.
 * 3. With no start: the unread paper with the highest sum of evidence towards papers already READ; with none read, or none connected to one,
 *    the most central (evidence degree, then `central`, then the id).
 * `null` when nothing qualifies (the caller says "you have read every linked paper above the threshold").
 */
export function nextToRead(edges: readonly EvEdge[], state: ReadState, from: readonly string[] | null, opts: NextOptions = {}): NextPick | null {
  const known = opts.ids ? new Set(opts.ids) : null;
  const adj = adjacency(edges, known);
  const unread = (id: string): boolean => state.get(id) !== 2;
  const start = new Set((from ?? []).filter((id) => !known || known.has(id)));
  const startBlocks = new Set([...start].map((id) => opts.blockOf?.(id)).filter((b): b is string => b !== undefined));
  const sameBlock = (id: string): number => {
    const b = opts.blockOf?.(id);
    return b !== undefined && startBlocks.has(b) ? 1 : 0;
  };

  if (start.size > 0) {
    // Step 1: the strongest unread neighbour of any of the start papers.
    let best: { id: string; score: number; ex: number; blk: number; via: PickLink } | null = null;
    const better = (c: NonNullable<typeof best>): boolean => !best || c.score > best.score || (c.score === best.score && (c.ex > best.ex || (c.ex === best.ex && (c.blk > best.blk || (c.blk === best.blk && c.id < best.id)))));
    for (const s of start) {
      for (const { to, edge } of adj.get(s) ?? []) {
        if (start.has(to) || !unread(to)) continue;
        const c = { id: to, score: strength(edge), ex: explicit(edge) ? 1 : 0, blk: sameBlock(to), via: link(s, edge) };
        if (better(c)) best = c;
      }
    }
    if (best) return { id: best.id, step: 1, read: strongestRead(adj, state, best.id, start), from: best.via };
    // Step 2: through a neighbour (read, since every unread one was refused above), score e1 * e2.
    let two: { id: string; score: number; ex: number; blk: number; mid: string; first: PickLink } | null = null;
    for (const s of start) {
      for (const { to: mid, edge: e1 } of adj.get(s) ?? []) {
        if (start.has(mid)) continue;
        for (const { to, edge: e2 } of adj.get(mid) ?? []) {
          if (start.has(to) || to === mid || !unread(to)) continue;
          const c = { id: to, score: strength(e1) * strength(e2), ex: explicit(e1) && explicit(e2) ? 1 : 0, blk: sameBlock(to), mid, first: link(s, e1) };
          if (!two || c.score > two.score || (c.score === two.score && (c.ex > two.ex || (c.ex === two.ex && (c.blk > two.blk || (c.blk === two.blk && c.id < two.id)))))) two = c;
        }
      }
    }
    return two ? { id: two.id, step: 2, read: strongestRead(adj, state, two.id, start), from: two.first, via: two.mid } : null;
  }

  // No start: the unread paper closest to what was read, else the most central.
  const universe = opts.ids ?? [...adj.keys()];
  let pick: { id: string; sum: number; deg: number; az: number } | null = null;
  for (const id of universe) {
    if (!unread(id)) continue;
    const near = adj.get(id) ?? [];
    let sum = 0;
    for (const { to, edge } of near) if (state.get(to) === 2) sum += strength(edge);
    const c = { id, sum, deg: near.length, az: opts.central?.(id) ?? 0 };
    const win = !pick || c.sum > pick.sum || (c.sum === pick.sum && (c.deg > pick.deg || (c.deg === pick.deg && (c.az > pick.az || (c.az === pick.az && c.id < pick.id)))));
    if (win) pick = c;
  }
  if (!pick) return null;
  return { id: pick.id, step: 0, read: strongestRead(adj, state, pick.id, new Set()), from: null };
}

/** The strongest tie of `id` to a paper read that is not one of the start papers (they are named by `from`). */
function strongestRead(adj: Map<string, Adj[]>, state: ReadState, id: string, skip: ReadonlySet<string>): PickLink | null {
  let best: PickLink | null = null;
  for (const { to, edge } of adj.get(id) ?? []) {
    if (state.get(to) !== 2 || skip.has(to)) continue;
    const c = link(to, edge);
    if (!best || c.e > best.e || (c.e === best.e && (c.kind !== 'similar' ? 1 : 0) > (best.kind !== 'similar' ? 1 : 0)) || (c.e === best.e && c.kind === best.kind && c.id < best.id)) best = c;
  }
  return best;
}
