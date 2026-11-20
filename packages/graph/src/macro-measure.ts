/**
 * What the Map shows for a taxonomy (D-561): the same functions it runs (`computeAreas` or `tagMemberships` for the values of the papers,
 * `valueStats` for the main value and its clarity, the blocks as `layoutBlocks` counts them), here over a taxonomy that is only simulated.
 * The macro-area proposal reads the numbers of "before" and "after" from here, so the preview is what the Map shows after Apply. Pure.
 */
import { computeAreas, topicNodes } from './areas.js';
import { MAX_VALUES } from './blocks.js';
import { tagMemberships, valueStats, type PaperValues } from './families.js';

export interface MeasureNode {
  id: string;
  label: string;
  parents: readonly string[];
  status?: string | undefined;
  family?: string | undefined;
}
export interface MeasureDoc {
  id: string;
  tags: ReadonlyArray<{ id: string; w: number }>;
  /** The tag the user fixed as the main value (`mainTags`). */
  pin?: string | null | undefined;
}
export interface Measured {
  blocks: number;
  /** Percentages 0-100 of the papers with a clear main value over the papers with a value, of the papers with a value over the scope, of the biggest block over the scope. */
  clearPct: number;
  coverage: number;
  largestPct: number;
  /** Papers in the smallest block. */
  smallest: number;
  /** Exact counts behind the percentages. */
  covered: number;
  clear: number;
  largest: number;
  /** Blocks under `sMin` papers, and values carried by more than `generic` of the papers. */
  small: number;
  generic: number;
  /** Papers per main value (the blocks of the Map, before the values beyond the 12th biggest go to "Other"). */
  main: Map<string, number>;
  /** Ids of the papers with a value whose main value is not clear. */
  unclear: string[];
}

/**
 * The blocks of the family after the taxonomy `nodes`. `topic`: the macro-areas of the Topic (`computeAreas` over `topicNodes`); `root`: the
 * values of level 1 under the family root `root`. `n`: papers in the scope (default `docs.length`).
 */
export function measureFamily(nodes: readonly MeasureNode[], docs: readonly MeasureDoc[], opts: { mode?: 'topic' | 'root'; root?: string | undefined; n?: number | undefined; sMin?: number; generic?: number; skipGeneric?: ReadonlySet<string> } = {}): Measured {
  const n = Math.max(1, opts.n ?? docs.length);
  const lists = new Map<string, Array<{ v: string; w: number }> & { pin?: string | null | undefined }>();
  const pinOf = (d: MeasureDoc): string | null => (d.pin && d.tags.some((t) => t.id === d.pin) ? d.pin : null);
  if (opts.mode === 'root' && opts.root !== undefined) {
    const root = opts.root;
    const mem = tagMemberships({ kind: 'root', value: root }, nodes, docs);
    const byId = new Map(nodes.map((x) => [x.id, x]));
    const above = (t: string): string[] => {
      const seen = new Set<string>();
      const stack = [t];
      const out: string[] = [];
      while (stack.length > 0) {
        const x = stack.pop() as string;
        if (seen.has(x)) continue;
        seen.add(x);
        if (byId.get(x)?.parents.includes(root)) out.push(x);
        else stack.push(...(byId.get(x)?.parents ?? []));
      }
      return out;
    };
    for (const d of docs) {
      const l = mem.docs.get(d.id);
      if (!l) continue;
      const list: Array<{ v: string; w: number }> & { pin?: string | null | undefined } = l.map((e) => ({ v: e.cluster, w: e.w }));
      const pin = pinOf(d);
      const v = pin === null ? undefined : above(pin).find((o) => list.some((e) => e.v === o));
      if (v !== undefined) list.pin = v;
      lists.set(d.id, list);
    }
  } else {
    const m = computeAreas(topicNodes(nodes), docs.map((d) => ({ id: d.id, tags: d.tags })));
    for (const d of docs) {
      const sh = m.docs.get(d.id);
      if (!sh || sh.ar.length === 0) continue;
      const list: Array<{ v: string; w: number }> & { pin?: string | null | undefined } = sh.ar.map(([a, , q]) => ({ v: m.areas[a]!.id, w: q }));
      const pin = pinOf(d);
      const v = pin === null ? undefined : (m.tagShare(pin)?.ar ?? []).map(([a]) => m.areas[a]!.id).find((o) => list.some((e) => e.v === o));
      if (v !== undefined) list.pin = v;
      lists.set(d.id, list);
    }
  }
  const order = [...lists.keys()];
  const st = valueStats(order.map((id) => lists.get(id)!));
  // The blocks as `layoutBlocks` makes them: one per main value, the values beyond the biggest `MAX_VALUES` together as "Other".
  const ranked = [...st.main].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const sizes = ranked.slice(0, MAX_VALUES).map(([, c]) => c);
  const rest = ranked.slice(MAX_VALUES).reduce((s, [, c]) => s + c, 0);
  if (rest > 0) sizes.push(rest);
  const largest = Math.max(0, ...sizes);
  const sMin = opts.sMin ?? 2;
  const carry = new Map<string, number>();
  for (const l of lists.values()) for (const e of l) if (e.w > 0) carry.set(e.v, (carry.get(e.v) ?? 0) + 1);
  let generic = 0;
  for (const [v, c] of carry) if (c / n > (opts.generic ?? 0.45) && !opts.skipGeneric?.has(v)) generic++;
  return {
    blocks: sizes.length,
    clearPct: Math.round((st.withValue > 0 ? st.clear / st.withValue : 0) * 100),
    coverage: Math.round((st.withValue / n) * 100),
    largestPct: Math.round((largest / n) * 100),
    smallest: sizes.length > 0 ? Math.min(...sizes) : 0,
    covered: st.withValue,
    clear: st.clear,
    largest,
    small: sizes.filter((c) => c < sMin).length,
    generic,
    main: st.main,
    unclear: st.unclear.map((i) => order[i] as string),
  };
}
