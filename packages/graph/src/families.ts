/**
 * Grouping families of the Map (D-489, section 18.3.7). A family is a set of tags of one kind (the topic macro-areas, the nodes of one
 * level such as "method", a taxonomy group hint, an id prefix such as `grp:` for research groups) or the communities found in the
 * network itself ("auto"). Its clusters are the top-level values; the biggest `FAMILY_TOP` (7, one per palette tint) are kept, the rest become one "other"
 * cluster. The result has the shape of `AreaModel`, so colours, legend and hover cards reuse the macro-area machinery. Pure.
 */
import { computeAreas, type AreaDoc, type AreaModel, type AreaNode } from './areas.js';
import { louvain, symmetrize } from './cluster.js';
import type { Edge } from './types.js';

export const FAMILY_TOP = 7;
/** Id of the cluster that gathers the clusters beyond the biggest eight. */
export const OTHER_CLUSTER = '__other';

export type FamilyKind = 'topic' | 'level' | 'group' | 'prefix' | 'root' | 'auto';
export interface FamilyRef {
  kind: FamilyKind;
  value: string;
}
/** `topic`, `auto`, `level:method`, `group:extra:x`, `prefix:grp:`, `root:<id>` (a family of the controlled vocabulary, D-493). Unknown text is the topic family. */
export function parseFamily(id: string): FamilyRef {
  if (id === 'auto') return { kind: 'auto', value: '' };
  for (const k of ['level', 'group', 'prefix', 'root'] as const) if (id.startsWith(`${k}:`) && id.length > k.length + 1) return { kind: k, value: id.slice(k.length + 1) };
  return { kind: 'topic', value: '' };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Cluster ids with their labels and the weighted membership of each document (documents with none are absent). */
export interface Memberships {
  labels: Map<string, string>;
  docs: Map<string, Array<{ cluster: string; w: number; mw?: number; d?: number; n?: number }>>;
}
export type FamilyNode = AreaNode & { level?: string | undefined; group?: string | undefined };

/** Memberships of a tag family: `level:x` (nodes of that level), `group:x` (nodes with that group hint), `prefix:p` (tag ids starting with p, label = the rest), `root:r` (the values of level 1 under the family root r, D-505). */
export function tagMemberships(ref: FamilyRef, nodes: readonly FamilyNode[], docs: readonly AreaDoc[]): Memberships {
  const live = new Map<string, FamilyNode>();
  for (const n of nodes) if (n.status !== 'deprecated') live.set(n.id, n);
  const prefix = ref.kind === 'prefix';
  const member = (id: string): boolean =>
    prefix ? id.startsWith(ref.value) : ref.kind === 'root' ? (live.get(id)?.parents ?? []).includes(ref.value) : ref.kind === 'level' ? live.get(id)?.level === ref.value : live.get(id)?.group === ref.value;
  const parentsOf = (id: string): string[] => (prefix ? [] : (live.get(id)?.parents ?? []).filter((p) => live.has(p) && p !== id));
  /** Members among the ancestors of `id` (itself included). */
  const above = (id: string): string[] => {
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      const x = stack.pop()!;
      if (seen.has(x)) continue;
      seen.add(x);
      stack.push(...parentsOf(x));
    }
    return [...seen].filter(member);
  };
  const memo = new Map<string, string[]>();
  /** The top-level members of a tag: those with no member above them. */
  const topsOf = (id: string): string[] => {
    let r = memo.get(id);
    if (!r) {
      const ms = above(id);
      r = ms.filter((m) => above(m).length === 1).sort(cmp);
      // A cycle of members has no top: the smallest id stands for it.
      if (r.length === 0 && ms.length > 0) r = [ms.sort(cmp)[0]!];
      memo.set(id, r);
    }
    return r;
  };
  /** Depth of a tag in the tree (a root is 0): the deepest tag is the most specific (D-569). */
  const depthMemo = new Map<string, number>();
  const depth = (id: string, guard = 0): number => {
    const known = depthMemo.get(id);
    if (known !== undefined) return known;
    depthMemo.set(id, 0);
    const d = guard > 30 ? 0 : Math.max(-1, ...parentsOf(id).map((p) => depth(p, guard + 1))) + 1;
    depthMemo.set(id, d);
    return d;
  };
  const labels = new Map<string, string>();
  const out = new Map<string, Array<{ cluster: string; w: number; mw: number; d: number; n: number }>>();
  for (const d of docs) {
    const acc = new Map<string, { w: number; mw: number; d: number; n: number }>();
    for (const t of d.tags) {
      if (!prefix && !live.has(t.id)) continue;
      const own = topsOf(t.id);
      for (const c of own) {
        const e = acc.get(c) ?? acc.set(c, { w: 0, mw: 0, d: 0, n: 0 }).get(c)!;
        e.w = Math.min(1, e.w + t.w / own.length);
        // A tag that is the value itself is generic: it counts at half, so the specific tags decide (D-569).
        e.mw += (c === t.id ? t.w / 2 : t.w) / own.length;
        e.d = Math.max(e.d, depth(t.id));
        e.n++;
      }
    }
    if (acc.size === 0) continue;
    for (const c of acc.keys()) if (!labels.has(c)) labels.set(c, prefix ? c.slice(ref.value.length) : (live.get(c)?.label ?? c));
    out.set(d.id, [...acc].map(([cluster, e]) => ({ cluster, w: e.w, mw: e.mw, d: e.d, n: e.n })));
  }
  return { labels, docs: out };
}

/**
 * Communities of the weighted network (Louvain, seeded) over `ids`, each labelled by its most distinctive recurring tags
 * (TF-IDF: the share of the members that carry the tag times log(N / documents with the tag)). Communities of fewer than two
 * documents are left out; a community with no recurring tag is called "<fallback> k".
 */
export function autoMemberships(ids: readonly string[], edges: ReadonlyArray<{ a: number; b: number; w: number }>, tagsOf: (docIndex: number) => readonly string[], tagLabel: (tag: string) => string, fallback: string, seed = 1): Memberships {
  const n = ids.length;
  const comm = n === 0 ? new Int32Array(0) : louvain(n, symmetrize(edges.filter((e) => e.a !== e.b && e.w > 0).map((e): Edge => ({ a: e.a, b: e.b, w: e.w }))), seed);
  const members = new Map<number, number[]>();
  comm.forEach((c, i) => (members.get(c) ?? members.set(c, []).get(c)!).push(i));
  const df = new Map<string, number>();
  for (let i = 0; i < n; i++) for (const t of new Set(tagsOf(i))) df.set(t, (df.get(t) ?? 0) + 1);
  const big = [...members.values()].filter((m) => m.length >= 2).sort((x, y) => y.length - x.length || x[0]! - y[0]!);
  const labels = new Map<string, string>();
  const docs = new Map<string, Array<{ cluster: string; w: number }>>();
  big.forEach((m, k) => {
    const id = `auto:${k}`;
    const tf = new Map<string, number>();
    for (const i of m) for (const t of new Set(tagsOf(i))) tf.set(t, (tf.get(t) ?? 0) + 1);
    const top = [...tf]
      .filter(([t, c]) => c >= 2 && c / m.length >= 0.3 && (df.get(t) ?? 0) < n)
      .map(([t, c]) => ({ t, s: (c / m.length) * Math.log(n / (df.get(t) ?? 1)) }))
      .sort((x, y) => y.s - x.s || cmp(x.t, y.t))
      .slice(0, 2);
    labels.set(id, top.length > 0 ? top.map((x) => tagLabel(x.t)).join(' · ') : `${fallback} ${k + 1}`);
    for (const i of m) docs.set(ids[i]!, [{ cluster: id, w: 1 }]);
  });
  return { labels, docs };
}

/** The `AreaModel` of a set of memberships: the biggest `FAMILY_TOP` clusters, the rest as `OTHER_CLUSTER` labelled `otherLabel`. `total` counts every document of the scope. */
export function familyModel(m: Memberships, total: number, otherLabel: string, colors?: ReadonlyMap<string, string>): AreaModel {
  const count = new Map<string, number>();
  for (const list of m.docs.values()) for (const e of list) count.set(e.cluster, (count.get(e.cluster) ?? 0) + 1);
  const keep = new Set([...count.keys()].sort((a, b) => count.get(b)! - count.get(a)! || cmp(a, b)).slice(0, FAMILY_TOP));
  const nodes: AreaNode[] = [...keep].map((id) => ({ id, label: m.labels.get(id) ?? id, parents: [], color: colors?.get(id) }));
  if (keep.size < count.size) nodes.push({ id: OTHER_CLUSTER, label: otherLabel, parents: [] });
  const docs: AreaDoc[] = [];
  for (const [id, list] of m.docs) {
    const acc = new Map<string, number>();
    for (const e of list) {
      const c = keep.has(e.cluster) ? e.cluster : OTHER_CLUSTER;
      acc.set(c, Math.min(1, (acc.get(c) ?? 0) + e.w));
    }
    docs.push({ id, tags: [...acc].map(([id2, w]) => ({ id: id2, w })) });
  }
  const model = computeAreas(nodes, docs);
  return { ...model, total: Math.max(total, model.total) };
}

/** Thresholds of the eligibility test of a family for the blocks of the Map (D-498, section 19.2.2). */
export const ELIGIBLE = { coverage: 0.6, clarity: 0.7, share: 0.6, maxValues: 12, cover: 0.8 } as const;
export interface Eligibility {
  eligible: boolean;
  /** Papers with a value over papers. */
  coverage: number;
  /** Papers whose main value holds at least 0.6 of their weight over papers with a value. */
  clarity: number;
  /** Values of level 1. */
  values: number;
}

/** One value of a paper: its share `w`, and what the choice of the main value reads (D-569): `mw` the total weight of the paper's tags in the value (a generic tag, the value itself, at half), `d` the depth of the deepest tag, `n` the number of tags. */
export interface PaperValue {
  v: string;
  w: number;
  mw?: number | undefined;
  d?: number | undefined;
  n?: number | undefined;
}
/** The weighted values of one paper. `pin` is the value the user fixed by hand as its main one (D-521, `mainTags`), already resolved to a level 1 value. */
export type PaperValues = ReadonlyArray<PaperValue> & { pin?: string | null | undefined };

const EPS = 1e-9;
/**
 * The main value of a paper (D-569, section 19.2.2), the same rule for the blocks, the test, the preview and the proposal of macro-areas:
 * 1) the value the user fixed by hand (`pin`, or `list.pin`) while it is still one of the paper's values; 2) the biggest total tag weight
 * (`mw`; a generic tag, the value itself, counts at half; `w` when a list has no `mw`); 3) ties: the value reached by the deepest tag; 4) the value with
 * more of the paper's tags; 5) the smaller id. A pin that is no longer among the values (its tag was taken off) is ignored.
 */
export function mainValue(list: PaperValues, pin: string | null | undefined = list.pin): string | null {
  if (pin && list.some((e) => e.v === pin && e.w > 0)) return pin;
  let best: PaperValue | null = null;
  for (const e of list) {
    if (!(e.w > 0)) continue;
    if (!best) {
      best = e;
      continue;
    }
    const d = (e.mw ?? e.w) - (best.mw ?? best.w);
    const better = Math.abs(d) > EPS ? d > 0 : (e.d ?? 0) !== (best.d ?? 0) ? (e.d ?? 0) > (best.d ?? 0) : (e.n ?? 0) !== (best.n ?? 0) ? (e.n ?? 0) > (best.n ?? 0) : e.v < best.v;
    if (better) best = e;
  }
  return best?.v ?? null;
}

/**
 * The test: coverage >= 0.6, clarity >= 0.7, 2 to 12 values (more is fine when the 12 biggest hold 80% of the papers: the rest goes to "Other").
 * With `fieldPack` (a field vocabulary in use, Topic): coverage >= 0.6 and 2 values or more, clarity not asked (D-570). A family of kind `one` is clear by construction, and so is a paper whose main value the user fixed; the keywords family never passes. `shares` is the weighted values of each paper (the ones with none may be left out).
 */
export function familyEligibility(shares: Iterable<PaperValues>, total: number, opts: { one?: boolean; keywords?: boolean; fieldPack?: boolean } = {}): Eligibility {
  const { withValue, clear, main } = valueStats(shares, opts.one);
  const counts = [...main.values()].sort((a, b) => b - a);
  const values = counts.length;
  const coverage = total > 0 ? withValue / total : 0;
  const clarity = withValue > 0 ? clear / withValue : 0;
  const top = counts.slice(0, ELIGIBLE.maxValues).reduce((s, c) => s + c, 0);
  const fits = values <= ELIGIBLE.maxValues || (withValue > 0 && top / withValue >= ELIGIBLE.cover);
  const r = (v: number) => Math.round(v * 1000) / 1000;
  // With a field vocabulary the macro-areas are the field's and every paper has a main one (D-569, D-570): papers are legitimately mixed, so clarity
  // does not decide; at least 60 % of the papers with a main macro-area and 2 macro-areas used.
  if (opts.fieldPack) return { eligible: !opts.keywords && coverage >= ELIGIBLE.coverage && values >= 2, coverage: r(coverage), clarity: r(clarity), values };
  return { eligible: !opts.keywords && coverage >= ELIGIBLE.coverage && clarity >= ELIGIBLE.clarity && values >= 2 && fits, coverage: r(coverage), clarity: r(clarity), values };
}

/** What the blocks of the Map and the test read from the values of the papers: papers with a main value, papers whose main value is clear, papers per main value, and who is not clear. */
export interface ValueStats {
  withValue: number;
  clear: number;
  main: Map<string, number>;
  unclear: number[];
}
/** The one definition of "clear" (section 19.2.2): the main value (`mainValue`) is fixed by hand or holds at least `ELIGIBLE.share` of the weight of the paper. `unclear`: indexes in `shares` of papers with a value that is not clear. */
export function valueStats(shares: Iterable<PaperValues>, one = false): ValueStats {
  const all = [...shares];
  const main = new Map<string, number>();
  const unclear: number[] = [];
  let withValue = 0;
  let clear = 0;
  all.forEach((list, i) => {
    const m = mainValue(list);
    if (m === null) return;
    withValue++;
    main.set(m, (main.get(m) ?? 0) + 1);
    const sum = list.reduce((s, e) => s + Math.max(0, e.w), 0);
    if (one || (list.pin && list.pin === m) || list.find((e) => e.v === m)!.w / sum >= ELIGIBLE.share) clear++;
    else unclear.push(i);
  });
  return { withValue, clear, main, unclear };
}

export interface VocabLink {
  a: string;
  b: string;
  lift: number;
  shared: number;
}
export const VOCAB_LINKS_PER_NODE = 2;
const VOCAB_LIFT = 2;
const VOCAB_SHARED = 2;

/**
 * Cross links of the vocabulary tree (section 19.2.7): pairs of nodes that appear together in at least 2 papers and 2 times more than chance
 * (lift = shared x N / (n_a x n_b), N the papers with a node); at most 2 per node, the biggest lift first. `skip` leaves out pairs already
 * related in the tree (an ancestor and its descendant). `nodesOf` lists, for each paper, the distinct nodes it carries.
 */
export function vocabLinks(nodesOf: Iterable<readonly string[]>, skip?: (a: string, b: string) => boolean): VocabLink[] {
  const count = new Map<string, number>();
  const pair = new Map<string, number>();
  let n = 0;
  for (const raw of nodesOf) {
    const list = [...new Set(raw)].sort(cmp);
    if (list.length === 0) continue;
    n++;
    for (const x of list) count.set(x, (count.get(x) ?? 0) + 1);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const k = `${list[i]}\u0000${list[j]}`;
      pair.set(k, (pair.get(k) ?? 0) + 1);
    }
  }
  const cands: VocabLink[] = [];
  for (const [k, shared] of pair) {
    if (shared < VOCAB_SHARED) continue;
    const [a, b] = k.split('\u0000') as [string, string];
    const lift = (shared * n) / (count.get(a)! * count.get(b)!);
    if (lift >= VOCAB_LIFT && !skip?.(a, b)) cands.push({ a, b, lift: Math.round(lift * 100) / 100, shared });
  }
  cands.sort((x, y) => y.lift - x.lift || y.shared - x.shared || cmp(x.a, y.a) || cmp(x.b, y.b));
  const used = new Map<string, number>();
  const out: VocabLink[] = [];
  for (const c of cands) {
    if ((used.get(c.a) ?? 0) >= VOCAB_LINKS_PER_NODE || (used.get(c.b) ?? 0) >= VOCAB_LINKS_PER_NODE) continue;
    used.set(c.a, (used.get(c.a) ?? 0) + 1);
    used.set(c.b, (used.get(c.b) ?? 0) + 1);
    out.push(c);
  }
  return out;
}
