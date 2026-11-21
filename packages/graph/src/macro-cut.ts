/**
 * Macro-areas proposed as a cut of the tree (D-520, D-561, D-568, section 20.2). The blocks of the Map are the values of level 1 of a family.
 * A CUT is a set of nodes, none an ancestor of another, taken as the level 1 values. The macro-areas are the field's fixed structure, not groups
 * of papers that happen to meet (D-568): WITH a field vocabulary (`pack`) the proposal never groups two values because they co-occur. Its moves are
 * PLACE each value that matches a concept of the vocabulary under that concept's macro-area (a latent ancestor of level 1, materialized on apply;
 * a value that IS a macro-area is the level 1 value itself, a value that matches nothing stays a level 1 value of its own) and, for a value that
 * sits on half of the papers (generic) and is no macro-area of the vocabulary, SPLIT it (its children rise to level 1, the value becomes a family
 * of its own). Values with fewer than 2 papers are not merged anywhere: the Map shows them inside "Other" (`blockValues`, display only).
 * WITHOUT a vocabulary the old search by co-occurrence may still be OFFERED: a greedy climb on an objective of clarity x coverage with penalties for
 * too many or too few blocks (4 to 7), small, generic and too big values, over the moves SPLIT and GATHER (siblings that go together under a common
 * parent: a latent ancestor, a node already there, or a provisional name); its gathers are flagged `cooc` and start UNTICKED (`defaultSkip`), a
 * proposal only if the objective gains 0.05. The search reads the papers like the Map does (a tag above another tag of the paper does not count),
 * but the numbers it reports, before and after, come from `measureFamily` over the taxonomy the operations lead to, and the finalists are chosen
 * by them: the preview is what the Map shows after Apply (D-561). Pure, deterministic (ties by id), no files. The caller turns the answer into
 * `taxonomy:apply` operations (`select(...).ops`).
 */
import { blockValues, OTHER_BLOCK } from './blocks.js';
import { mainValue, type PaperValues } from './families.js';
import { measureFamily, type Measured, type MeasureNode } from './macro-measure.js';

export interface CutNode {
  id: string;
  label: string;
  parents: readonly string[];
  status?: string | undefined;
  /** Family kind of a root (`many`, `one`, `keywords`): the Topic of the Map is the biggest `many` family. */
  family?: string | undefined;
}
/** A concept of the field vocabulary that is not a node of the library yet and sits above `covers` (ids of the library nodes below it in the vocabulary). `top`: it is a level 1 concept of the vocabulary. */
export interface LatentAncestor {
  id: string;
  label: string;
  covers: readonly string[];
  top?: boolean | undefined;
}
export interface CutDoc {
  id: string;
  tags: ReadonlyArray<{ id: string; w: number }>;
  /** The tag the user fixed as the main value of the paper (`mainTags`, D-521); used while the paper still carries it. */
  pin?: string | null | undefined;
}
export interface CutInput {
  nodes: readonly CutNode[];
  /** Values of level 1 today. */
  top: readonly string[];
  /** The node the level 1 values hang under (a family root such as Topic); absent when they are roots. */
  root?: string | undefined;
  docs: readonly CutDoc[];
  /** Papers of the scope; default `docs.length`. */
  n?: number | undefined;
  latent?: readonly LatentAncestor[] | undefined;
  /** What the Map reads after the cut: the macro-areas of the Topic (default) or the values of level 1 under `root` (a `root:` family). */
  family?: 'topic' | 'root' | undefined;
  /** A field vocabulary is in use (default: `latent` has concepts): the macro-areas are its level 1 concepts and nothing is grouped by co-occurrence (D-568). */
  pack?: boolean | undefined;
  /** Nodes of the library that are level 1 concepts of the vocabulary themselves: they are macro-areas already, never split. */
  fixed?: readonly string[] | undefined;
}

export interface CutStats {
  blocks: number;
  /** Percentages 0-100: papers with a clear main value over papers with a value, papers with a value over `n`, the biggest block over `n`. */
  clearPct: number;
  coverage: number;
  largestPct: number;
  /** Papers in the smallest block. */
  smallest: number;
}
export interface CutChild {
  id: string;
  label: string;
  papers: number;
}
export interface CutMove {
  id: string;
  kind: 'split' | 'gather';
  label: string;
  papers: number;
  share: number;
  children: CutChild[];
  parent?: { kind: 'pack' | 'existing' | 'provisional'; id?: string; label: string };
  requires: string[];
  pinsLost: number;
  /** A gather that comes from papers that meet, not from the structure of the field: offered without a vocabulary, unticked to begin with (D-568). */
  cooc?: boolean;
}
export interface CutItem {
  id: string;
  label: string;
  papers: number;
  kind: 'keep' | 'split-child' | 'gather';
  children?: CutChild[];
}
/** Taxonomy operations a cut leads to (a subset of `TaxonomyOp`). A pack parent is `create`d by the caller (materialization): its operations refer to the concept id. */
export type CutOp =
  | { op: 'create'; id: string; label: string; parents: string[] }
  | { op: 'move'; id: string; parents: string[] }
  | { op: 'setFamily'; id: string; family: 'many' };
export interface CutSelection {
  after: CutStats;
  cut: CutItem[];
  ops: CutOp[];
  /** Concept ids of the field vocabulary whose node must exist before the operations (they refer to it by that id). */
  materialize: string[];
  /** The moves left out: the unticked ones and those that need them. */
  skipped: string[];
}
export interface CutProposal {
  before: CutStats;
  moves: CutMove[];
  /** Papers whose main value is not clear today. */
  unclear: string[];
  /** The moves unticked to begin with (the gathers by co-occurrence, D-568): `select()` with no argument leaves them out too. */
  defaultSkip: string[];
  /** The cut with every move except `skip` (move ids); `names` = names for provisional parents by move id. */
  select(skip?: Iterable<string>, names?: Readonly<Record<string, string>>): CutSelection;
}

export const CUT = { sample: 200, detours: 1200, kMin: 4, kTop: 7, generic: 0.45, share: 0.6, big: 0.5, gain: 0.05, rounds: 30, pairs: 12, maxDepth: 3 } as const;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const r2 = (x: number): number => Math.round(x * 100) / 100;

interface VNode {
  id: string;
  label: string;
  members: string[];
  kind: 'pack' | 'existing' | 'provisional';
}
interface State {
  cut: Set<string>;
  v: Map<string, VNode>;
  /** Member -> the virtual node it was gathered under. */
  vpar: Map<string, string>;
  /** A value too deep to gather (its subtree would pass depth 3) -> the children that rose to level 1 in its place (they are what gets gathered). */
  lifts: Map<string, string[]>;
}
interface DocState {
  main: string | null;
  clear: boolean;
  vals: Map<string, number>;
}
interface Agg {
  covered: number;
  clear: number;
  main: Map<string, number>;
  carry: Map<string, number>;
  docs: Map<number, DocState>;
}

/** Proposes the cut; with no move when no cut gains enough (`moves` empty), `null` when there are fewer than two values to cut. */
export function proposeCut(input: CutInput): CutProposal | null {
  // With a vocabulary nothing is searched: the moves come from the structure of the field, on every paper.
  if (input.docs.length <= CUT.sample || (input.pack ?? (input.latent?.length ?? 0) > 0)) return cutCore(input).prop;
  // A big library: the search reads an even sample of the papers (every k-th by id); the cut it finds is then measured and described on all of them.
  const sorted = [...input.docs].sort((a, b) => cmp(a.id, b.id));
  const step = Math.ceil(sorted.length / CUT.sample);
  const sample = sorted.filter((_, i) => i % step === 0);
  const found = cutCore({ ...input, docs: sample, n: Math.max(1, Math.round(((input.n ?? input.docs.length) * sample.length) / input.docs.length)) });
  return found.state ? cutCore(input, found.state).prop : null;
}

function cutCore(input: CutInput, preset?: State): { prop: CutProposal | null; state: State | null } {
  const n = Math.max(1, input.n ?? input.docs.length);
  const kMax = Math.min(CUT.kTop, Math.max(CUT.kMin, Math.round(Math.sqrt(2 * n))));
  const sMin = Math.max(2, Math.ceil(0.04 * n));

  // The tree under today's values.
  const live = new Map(input.nodes.filter((x) => x.status !== 'deprecated').map((x) => [x.id, x]));
  const top = [...new Set(input.top)].filter((t) => live.has(t));
  const packMode = input.pack ?? (input.latent?.length ?? 0) > 0;
  if (top.length < (packMode ? 1 : 2)) return { prop: null, state: null };
  const childrenOf = new Map<string, string[]>();
  for (const x of [...live.values()].sort((a, b) => cmp(a.id, b.id))) for (const p of x.parents) (childrenOf.get(p) ?? childrenOf.set(p, []).get(p)!).push(x.id);
  const kids = new Map<string, string[]>();
  const inTree = new Set<string>();
  const queue = [...top];
  while (queue.length > 0) {
    const x = queue.pop() as string;
    if (inTree.has(x)) continue;
    inTree.add(x);
    for (const c of childrenOf.get(x) ?? []) {
      (kids.get(x) ?? kids.set(x, []).get(x)!).push(c);
      queue.push(c);
    }
  }
  const parentMemo = new Map<string, string[]>();
  const parentsOf = (id: string): string[] => {
    let ps = parentMemo.get(id);
    if (!ps) parentMemo.set(id, (ps = (live.get(id)?.parents ?? []).filter((p) => inTree.has(p) && p !== id)));
    return ps;
  };
  const topSet = new Set(top);
  const label = (id: string, st?: State): string => st?.v.get(id)?.label ?? live.get(id)?.label ?? id;
  const heightMemo = new Map<string, number>();
  const height = (id: string, guard = 0): number => {
    const known = heightMemo.get(id);
    if (known !== undefined) return known;
    heightMemo.set(id, 0);
    const h = guard > 20 ? 0 : Math.max(0, ...(kids.get(id) ?? []).map((c) => 1 + height(c, guard + 1)));
    heightMemo.set(id, h);
    return h;
  };
  /** The tags under a node (itself included). */
  const subMemo = new Map<string, Set<string>>();
  const sub = (id: string): Set<string> => {
    let s = subMemo.get(id);
    if (s) return s;
    s = new Set([id]);
    subMemo.set(id, s);
    for (const c of kids.get(id) ?? []) for (const t of sub(c)) s.add(t);
    return s;
  };
  const topOf = (id: string): string | undefined => {
    const seen = new Set<string>();
    const stack = [id];
    let found: string | undefined;
    while (stack.length > 0) {
      const x = stack.pop() as string;
      if (seen.has(x)) continue;
      seen.add(x);
      if (topSet.has(x) && (found === undefined || x < found)) found = x;
      stack.push(...parentsOf(x));
    }
    return found;
  };

  // Papers with their weighted tags in the tree, and the papers under each tag. Like the Map (`computeAreas`), a tag above another tag of the paper does not count.
  const ancMemo = new Map<string, Set<string>>();
  const strictAnc = (id: string): Set<string> => {
    let out = ancMemo.get(id);
    if (!out) {
      ancMemo.set(id, (out = new Set<string>()));
      const stack = [...parentsOf(id)];
      while (stack.length > 0) {
        const p = stack.pop() as string;
        if (!out.has(p)) (out.add(p), stack.push(...parentsOf(p)));
      }
    }
    return out;
  };
  const docs = input.docs.map((d) => {
    const w = new Map<string, number>();
    for (const t of d.tags) if (inTree.has(t.id) && t.w > 0) w.set(t.id, Math.max(w.get(t.id) ?? 0, Math.min(1, t.w)));
    const above = new Set<string>();
    for (const t of w.keys()) for (const a of strictAnc(t)) if (w.has(a)) above.add(a);
    return { id: d.id, tags: [...w].filter(([t]) => !above.has(t)).sort((a, b) => cmp(a[0], b[0])), pin: d.pin && w.has(d.pin) ? d.pin : null };
  });
  const docsOfTag = new Map<string, number[]>();
  docs.forEach((d, i) => d.tags.forEach(([t]) => (docsOfTag.get(t) ?? docsOfTag.set(t, []).get(t)!).push(i)));
  const underMemo = new Map<string, Set<number>>();
  const under = (id: string): Set<number> => {
    let s = underMemo.get(id);
    if (!s) {
      s = new Set<number>();
      for (const t of sub(id)) for (const i of docsOfTag.get(t) ?? []) s.add(i);
      underMemo.set(id, s);
    }
    return s;
  };
  const docsOfMember = (id: string, st: State): Set<number> => {
    const v = st.v.get(id);
    if (!v) return under(id);
    const s = new Set<number>();
    for (const m of v.members) for (const i of under(m)) s.add(i);
    return s;
  };

  /** The members of a cut above a tag (stops at a member: the cut is an antichain). */
  const ownersIn = (t: string, st: State): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    const stack = [t];
    while (stack.length > 0) {
      const x = stack.pop() as string;
      if (seen.has(x)) continue;
      seen.add(x);
      if (st.cut.has(x)) {
        out.push(x);
        continue;
      }
      stack.push(...parentsOf(x));
      const vp = st.vpar.get(x);
      if (vp !== undefined) stack.push(vp);
    }
    return out.sort(cmp);
  };

  const judge = (d: (typeof docs)[number], vals: Map<string, number>, owners: (t: string) => string[]): { main: string | null; clear: boolean } => {
    if (vals.size === 0) return { main: null, clear: false };
    const list: PaperValues = [...vals].map(([v, w]) => ({ v, w }));
    // The paper's fixed value, when it sits under one of its values; else the choice of the Map (`mainValue`, by weight; the search does not read the depth).
    const pin = d.pin !== null ? (owners(d.pin).find((o) => vals.has(o)) ?? null) : null;
    const main = mainValue(list, pin);
    if (main === null) return { main: null, clear: false };
    if (pin !== null && main === pin) return { main, clear: true };
    let sum = 0;
    for (const e of list) sum += e.w;
    return { main, clear: vals.get(main)! / sum >= CUT.share };
  };
  /** Re-reads the papers `which` under `st` into a copy of `base` (or from nothing, `base` null). */
  const assess = (st: State, which: Iterable<number> | null, base: Agg | null): Agg => {
    const agg: Agg = base ? { covered: base.covered, clear: base.clear, main: new Map(base.main), carry: new Map(base.carry), docs: new Map(base.docs) } : { covered: 0, clear: 0, main: new Map(), carry: new Map(), docs: new Map() };
    const memo = new Map<string, string[]>();
    const owners = (t: string): string[] => memo.get(t) ?? (memo.set(t, ownersIn(t, st)), memo.get(t) as string[]);
    const bump = (m: Map<string, number>, k: string, by: number): void => {
      const x = (m.get(k) ?? 0) + by;
      if (x <= 0) m.delete(k);
      else m.set(k, x);
    };
    const list = which ? [...which].sort((a, b) => a - b) : docs.map((_, i) => i);
    for (const i of list) {
      const old = agg.docs.get(i);
      if (old) {
        if (old.vals.size > 0) agg.covered--;
        if (old.clear) agg.clear--;
        if (old.main !== null) bump(agg.main, old.main, -1);
        for (const v of old.vals.keys()) bump(agg.carry, v, -1);
      }
      const vals = new Map<string, number>();
      for (const [t, w] of docs[i]!.tags) {
        const own = owners(t);
        for (const c of own) vals.set(c, (vals.get(c) ?? 0) + w / own.length);
      }
      if (vals.size > 0) agg.covered++;
      for (const v of vals.keys()) bump(agg.carry, v, 1);
      agg.docs.set(i, { main: null, clear: false, vals });
    }
    for (const i of list) {
      const s = agg.docs.get(i) as DocState;
      const j = judge(docs[i]!, s.vals, owners);
      s.main = j.main;
      s.clear = j.clear;
      if (j.main !== null) bump(agg.main, j.main, 1);
      if (j.clear) agg.clear++;
    }
    return agg;
  };
  const kMin = Math.min(CUT.kMin, top.length);
  /** The objective of a reading: clarity x coverage, less 0.05 per block beyond kMax and 0.15 per block short of kMin, 0.06 per small block, 0.08 per generic value, 2 per share of the papers a block holds beyond half. */
  const objectiveOf = (m: { blocks: number; clear: number; covered: number; small: number; generic: number; largest: number }): number => {
    const clarity = m.covered > 0 ? m.clear / m.covered : 0;
    return clarity * (m.covered / n) - 0.05 * Math.max(0, m.blocks - kMax) - 0.15 * Math.max(0, kMin - m.blocks) - 0.06 * m.small - 0.08 * m.generic - 2 * Math.max(0, m.largest / n - CUT.big);
  };
  const latentIds = new Set((input.latent ?? []).map((l) => l.id));
  const topicRooted = input.family !== 'root' && input.root !== undefined && live.get(input.root)?.family === 'many';
  const objective = (a: Agg): number => {
    let small = 0;
    for (const c of a.main.values()) if (c < sMin) small++;
    let generic = 0;
    // A parent made by gathering is as big as the values under it: the size of its block is held by the penalty for the biggest block.
    for (const [v, c] of a.carry) if (c / n > CUT.generic && !(v.startsWith('new:') || latentIds.has(v))) generic++;
    // Without a Topic family root the Map gives way to the children of a value that covers four papers in five (`computeAreas`): such a parent
    // would be undone at once. Under a Topic family root the level 1 values are never replaced by their children (D-572): no penalty.
    let wide = 0;
    if (!topicRooted) for (const c of a.carry.values()) if (a.covered > 0 && c / a.covered >= 0.8) wide++;
    return objectiveOf({ blocks: a.main.size, clear: a.clear, covered: a.covered, small, generic, largest: Math.max(0, ...a.main.values()) }) - 0.5 * wide;
  };
  const state0 = (): State => ({ cut: new Set(top), v: new Map(), vpar: new Map(), lifts: new Map() });
  const clone = (st: State): State => ({ cut: new Set(st.cut), v: new Map(st.v), vpar: new Map(st.vpar), lifts: new Map(st.lifts) });

  // ---- moves on a state (a move gives the changed state, or null when it does not apply)
  type Cand = { state: State; touched: string[] };
  const slugs = new Set(input.nodes.map((x) => x.id));
  const splitState = (st: State, g: string): State | null => {
    const rise = (kids.get(g) ?? []).filter((c) => under(c).size > 0);
    if (!st.cut.has(g) || st.v.has(g) || rise.length < 2) return null;
    const next = clone(st);
    next.cut.delete(g);
    for (const c of rise) next.cut.add(c);
    return next;
  };
  /** A child that rose in place of a deep value -> that value (its name stands for the child in a provisional parent). */
  const liftOrigin = new Map<string, string>();
  /** The children lifted in place of a value, at any depth. */
  const liftedAll = (st: State): Set<string> => new Set([...st.lifts.values()].flat());
  /**
   * A value of the cut that is too deep to gather (it would take its subtree below depth 3) and holds no paper by itself: its children rise to level 1
   * in its place, and they are what a gather takes (the value stays as a tag with no papers). `null` when it does not apply.
   */
  const liftState = (st: State, a: string): { state: State; units: string[] } | null => {
    if (!st.cut.has(a) || st.v.has(a) || 1 + 1 + height(a) <= CUT.maxDepth) return null;
    const next = clone(st);
    const units: string[] = [];
    const rise = (x: string): boolean => {
      if ((docsOfTag.get(x) ?? []).length > 0) return false;
      const ks = (kids.get(x) ?? []).filter((c) => under(c).size > 0);
      if (ks.length === 0) return false;
      next.cut.delete(x);
      next.lifts.set(x, ks);
      for (const c of ks) {
        liftOrigin.set(c, liftOrigin.get(x) ?? x);
        next.cut.add(c);
        if (1 + 1 + height(c) <= CUT.maxDepth) units.push(c);
        else if (!rise(c)) return false;
      }
      return true;
    };
    return rise(a) ? { state: next, units: units.sort(cmp) } : null;
  };
  const latent = [...(input.latent ?? [])].sort((a, b) => a.covers.length - b.covers.length || cmp(a.id, b.id));
  /** The id and the provisional name of a parent over `members`: the biggest three by papers. */
  const provisional = (members: readonly string[]): { id: string; name: string } => {
    const byPapers = [...members].sort((x, y) => under(y).size - under(x).size || cmp(x, y));
    // A child that rose in place of a deep value is named by that value.
    const origin = (m: string): string => liftOrigin.get(m) ?? m;
    const names = [...new Set(byPapers.map((m) => label(origin(m))))];
    return { id: `new:${[...members].sort(cmp).join('+')}`, name: names.slice(0, 3).join(' & ') + (names.length > 3 ? ' & …' : '') };
  };
  /** The ways two values of the cut gather: under each of the two smallest ancestors of the vocabulary above both, under a node already there above both, or else under a parent with a provisional name. */
  const gatherStates = (st: State, a: string, b: string): Array<{ state: State; touched: string[] }> => {
    const out: Array<{ state: State; touched: string[] }> = [];
    const make = (kind: VNode['kind'], id: string, name: string, members: string[]): void => {
      members = members.filter((m) => 1 + 1 + height(m) <= CUT.maxDepth);
      if (members.length < 2 || !members.includes(a) || !members.includes(b)) return;
      const next = clone(st);
      for (const m of members) {
        next.cut.delete(m);
        next.vpar.set(m, id);
      }
      next.cut.add(id);
      next.v.set(id, { id, label: name, members: [...members].sort(cmp), kind });
      out.push({ state: next, touched: [...members, id] });
    };
    for (const lat of latent.filter((l) => l.covers.includes(a) && l.covers.includes(b) && !st.v.has(l.id)).slice(0, 2)) make('pack', lat.id, lat.label, [...st.cut].filter((m) => !st.v.has(m) && lat.covers.includes(m)).sort(cmp));
    const aa = strictAnc(a);
    // A top above both would only undo the split: that is no gather, the pair gets a parent of its own.
    const common = [...strictAnc(b)].filter((x) => aa.has(x) && !st.cut.has(x) && !topSet.has(x)).sort((x, y) => sub(x).size - sub(y).size || cmp(x, y));
    if (common.length > 0) {
      // A node already there: it takes the cut members under it, and they stop being values of their own (no new parent).
      const x = common[0] as string;
      if (![...st.v.values()].some((v) => v.members.some((m) => sub(x).has(m)))) {
        const next = clone(st);
        const gone = [...st.cut].filter((m) => !st.v.has(m) && sub(x).has(m));
        for (const m of gone) next.cut.delete(m);
        next.cut.add(x);
        out.push({ state: next, touched: [...gone, x] });
      }
    } else {
      const { id, name } = provisional([a, b]);
      make('provisional', id, name, [a, b]);
    }
    return out;
  };
  /** A unit (a value of the cut, real or gathered) joins another: two values gather; a value joins a gathered parent; two gathered parents become one. Several values under one parent are what makes a paper with two or three small topics clear. */
  const joinStates = (st: State, a: string, b: string): Cand[] => {
    // A value too deep to gather: its children rise and go in its place, one after the other.
    for (const [deep, other] of [[a, b], [b, a]] as const) {
      const lifted = st.v.has(deep) ? null : liftState(st, deep);
      if (!lifted || lifted.units.length === 0) continue;
      let cur: Cand[] = joinStates(lifted.state, lifted.units[0] as string, other).map((c) => ({ state: c.state, touched: [...lifted.units, ...c.touched, deep] }));
      for (const u of lifted.units.slice(1)) {
        cur = cur.flatMap((c) => {
          const parent = [...c.state.v.values()].find((v) => v.members.includes(lifted.units[0] as string));
          return parent ? joinStates(c.state, u, parent.id).slice(0, 1).map((j) => ({ state: j.state, touched: [...c.touched, ...j.touched] })) : [];
        });
      }
      return cur.slice(0, 2);
    }
    const va = st.v.get(a);
    const vb = st.v.get(b);
    if (!va && !vb) return gatherStates(st, a, b);
    const pk = va?.kind === 'pack' ? va : vb?.kind === 'pack' ? vb : undefined;
    if (pk) {
      // A parent of the vocabulary takes the real values below it in the vocabulary, nothing else.
      const x = pk === va ? b : a;
      const lat = latent.find((l) => l.id === pk.id);
      if (st.v.has(x) || !lat || !lat.covers.includes(x) || 1 + 1 + height(x) > CUT.maxDepth) return [];
      const next = clone(st);
      next.cut.delete(x);
      next.vpar.set(x, pk.id);
      next.v.set(pk.id, { ...pk, members: [...pk.members, x].sort(cmp) });
      return [{ state: next, touched: [x, pk.id] }];
    }
    const members = [...(va?.members ?? [a]), ...(vb?.members ?? [b])];
    if (members.some((m) => 1 + 1 + height(m) > CUT.maxDepth)) return [];
    const { id, name } = provisional(members);
    const next = clone(st);
    for (const u of [a, b]) {
      next.cut.delete(u);
      next.v.delete(u);
    }
    for (const m of members) next.vpar.set(m, id);
    next.cut.add(id);
    next.v.set(id, { id, label: name, members: members.sort(cmp), kind: 'provisional' });
    return [{ state: next, touched: [...members, id, ...[a, b].filter((u) => st.v.has(u))] }];
  };

  /** A value leaves the gathered parent `vid` (a parent left with one value dissolves), and stays a value of the cut. */
  const leaveState = (st: State, vid: string, m: string): { state: State; touched: string[] } | null => {
    const v = st.v.get(vid);
    if (!v || v.kind !== 'provisional' || v.members.length < 2) return null;
    const rest = v.members.filter((x) => x !== m);
    const next = clone(st);
    next.cut.delete(vid);
    next.v.delete(vid);
    next.cut.add(m);
    next.vpar.delete(m);
    const touched = [...v.members, vid];
    if (rest.length === 1) {
      next.cut.add(rest[0] as string);
      next.vpar.delete(rest[0] as string);
    } else {
      const { id, name } = provisional(rest);
      for (const r of rest) next.vpar.set(r, id);
      next.cut.add(id);
      next.v.set(id, { id, label: name, members: rest, kind: 'provisional' });
      touched.push(id);
    }
    return { state: next, touched };
  };
  /** Second thoughts: a value of a gathered parent goes to the unit it meets most (or stands alone again). */
  const relocateCands = (st: State): Cand[] => {
    const out: Cand[] = [];
    const cache = new Map<string, Set<number>>();
    const docsOf = (u: string): Set<number> => cache.get(u) ?? (cache.set(u, docsOfMember(u, st)), cache.get(u) as Set<number>);
    for (const v of [...st.v.values()].sort((x, y) => cmp(x.id, y.id))) {
      if (v.kind !== 'provisional' || v.members.length < 2) continue;
      for (const m of v.members) {
        const left = leaveState(st, v.id, m);
        if (!left) continue;
        out.push(left);
        const M = under(m);
        const targets = [...left.state.cut]
          .filter((u) => u !== m)
          .map((u) => {
            const U = docsOf(u);
            let both = 0;
            for (const i of M) if (U.has(i)) both++;
            return { u, f: M.size > 0 ? both / M.size : 0 };
          })
          .sort((x, y) => y.f - x.f || cmp(x.u, y.u))
          .slice(0, 3);
        for (const t of targets) {
          // `leaveState` may have given the rest a new id: read the unit again from the state it made.
          for (const j of joinStates(left.state, m, t.u)) out.push({ state: j.state, touched: [...left.touched, ...j.touched] });
        }
      }
    }
    return out;
  };

  type Scored = { state: State; agg: Agg; j: number };
  const score = (c: Cand, st: State, agg: Agg): Scored => {
    const affected = new Set<number>();
    for (const t of c.touched) for (const i of docsOfMember(t, c.state)) affected.add(i);
    const a = assess(c.state, affected, agg);
    return { state: c.state, agg: a, j: objective(a) };
  };
  /** The pairs of values of the cut (`only`: just these) that go together or are small, best first, as candidates: gather, join, merge. */
  const pairMemo = new Map<string, { sc: number; size: number }>();
  const gatherCands = (st: State, agg: Agg, only?: ReadonlySet<string>): Cand[] => {
    const cache = new Map<string, Set<number>>();
    const docsOf = (u: string): Set<number> => cache.get(u) ?? (cache.set(u, docsOfMember(u, st)), cache.get(u) as Set<number>);
    const units = [...st.cut].filter((m) => !only || only.has(m)).sort(cmp);
    const sig = (u: string): string => {
      const v = st.v.get(u);
      return v ? `${u}#${v.members.join(',')}` : u;
    };
    const small = (u: string): boolean => (agg.main.get(u) ?? 0) < sMin;
    const ranked: Array<{ a: string; b: string; score: number }> = [];
    for (let x = 0; x < units.length; x++) {
      for (let y = x + 1; y < units.length; y++) {
        // What two units share depends on them alone: kept from round to round, only the pairs with a new unit are counted.
        const key = `${sig(units[x]!)}|${sig(units[y]!)}`;
        let known = pairMemo.get(key);
        if (!known) {
          const A = docsOf(units[x]!);
          const B = docsOf(units[y]!);
          const [few, many] = A.size < B.size ? [A, B] : [B, A];
          let both = 0;
          for (const i of few) if (many.has(i)) both++;
          pairMemo.set(key, (known = { sc: A.size > 0 && B.size > 0 ? (both / A.size) * (both / B.size) : 0, size: A.size + B.size }));
        }
        let sc = known.sc;
        // A small block that never meets another still has to go somewhere: into a parent it shares with it (vocabulary, tree), else the smallest block.
        if (sc === 0) {
          if (!small(units[x]!) && !small(units[y]!)) continue;
          const kin = latent.some((l) => l.covers.includes(units[x]!) && l.covers.includes(units[y]!)) || (topOf(units[x]!) === topOf(units[y]!) && !topSet.has(units[x]!));
          sc = (kin ? 1e-4 : 1e-6) / (1 + known.size);
        }
        ranked.push({ a: units[x]!, b: units[y]!, score: sc });
      }
    }
    ranked.sort((p, q) => q.score - p.score || cmp(p.a, q.a) || cmp(p.b, q.b));
    const pick = ranked.slice(0, CUT.pairs);
    for (const u of units) {
      const r = small(u) ? ranked.find((p) => p.a === u || p.b === u) : undefined;
      if (r && !pick.includes(r)) pick.push(r);
    }
    return pick.flatMap((p) => joinStates(st, p.a, p.b));
  };
  const best = (list: readonly Scored[], j: number): Scored | null => {
    let top: Scored | null = null;
    for (const c of list) if (c.j > j + 1e-9 && (!top || c.j > top.j + 1e-12)) top = c;
    return top;
  };

  /** One greedy climb from `st`. */
  const climb = (start: State, detour = 0): { st: State; agg: Agg; j: number } => {
    let st = start;
    let agg = assess(st, null, null);
    let j = objective(agg);
    for (let round = 0; round < Math.max(CUT.rounds, top.length); round++) {
      const scored: Scored[] = [];
      for (const m of [...st.cut].sort(cmp)) {
        if (st.v.has(m) || liftedAll(st).has(m) || (agg.carry.get(m) ?? 0) / n <= CUT.generic) continue;
        const sp = splitState(st, m);
        if (!sp) continue;
        let cur = score({ state: sp, touched: [m, ...sp.cut].filter((x) => !st.cut.has(x) || x === m) }, st, agg);
        scored.push(cur);
        // A split can leave children that go together (they co-occur): follow it with the gathers that help, so that one candidate holds both.
        const rise = new Set([...sp.cut].filter((x) => !st.cut.has(x)));
        for (let k = 0; k < 3; k++) {
          const next = best(gatherCands(cur.state, cur.agg, rise).map((c) => score(c, cur.state, cur.agg)), cur.j);
          if (!next) break;
          cur = next;
        }
        if (cur.state !== scored[scored.length - 1]!.state) scored.push(cur);
      }
      for (const c of gatherCands(st, agg)) scored.push(score(c, st, agg));
      // Second thoughts only when no split or gather helps any more.
      let pick = best(scored, j);
      // A detour: the first step is the `detour`-th best instead of the best, so the climb does not always end in the same corner.
      if (round === 0 && detour > 0) pick = [...scored].sort((p, q) => q.j - p.j)[detour] ?? null;
      if (!pick) pick = best(relocateCands(st).map((c) => score(c, st, agg)), j);
      if (!pick) break;
      st = pick.state;
      // An exact reading after each step keeps the approximation of the specificity from piling up.
      agg = assess(st, null, null);
      j = objective(agg);
    }
    return { st, agg, j };
  };

  // ---- the operations a cut leads to, and the numbers the Map shows after them
  const splitsOf = (st: State): string[] => {
    const members = new Set([...st.v.values()].flatMap((v) => v.members));
    return top.filter((g) => !st.cut.has(g) && !members.has(g) && !st.lifts.has(g));
  };
  const risen = (st: State, g: string): string[] => [...st.cut].filter((c) => !st.v.has(c) && !topSet.has(c) && topOf(c) === g).sort(cmp);
  /** Operations of a cut (provisional parents take their label as it is in `st`), the concepts of the vocabulary it needs, and the id each gathered parent will have. */
  const opsOf = (st: State): { ops: CutOp[]; materialize: string[]; idOf: Map<string, string>; packs: Array<{ id: string; label: string }> } => {
    const ops: CutOp[] = [];
    const materialize: string[] = [];
    const packs: Array<{ id: string; label: string }> = [];
    const taken = new Set(slugs);
    const idOf = new Map<string, string>();
    for (const v of [...st.v.values()].sort((a, b) => cmp(a.id, b.id))) {
      if (v.kind === 'pack') {
        materialize.push(v.id);
        packs.push({ id: v.id, label: v.label });
        idOf.set(v.id, v.id);
        continue;
      }
      const base = v.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'area';
      let id = base;
      for (let k = 2; taken.has(id); k++) id = `${base}-${k}`;
      taken.add(id);
      idOf.set(v.id, id);
      ops.push({ op: 'create', id, label: v.label, parents: input.root ? [input.root] : [] });
    }
    const level1 = input.root ? [input.root] : [];
    for (const g of splitsOf(st)) {
      if ((live.get(g)?.parents.length ?? 0) > 0) ops.push({ op: 'move', id: g, parents: [] });
      ops.push({ op: 'setFamily', id: g, family: 'many' });
      for (const c of risen(st, g)) ops.push({ op: 'move', id: c, parents: level1 });
    }
    for (const c of [...liftedAll(st)].sort(cmp)) if (st.cut.has(c) && !st.v.has(c)) ops.push({ op: 'move', id: c, parents: level1 });
    for (const v of [...st.v.values()].sort((a, b) => cmp(a.id, b.id))) for (const m of v.members) ops.push({ op: 'move', id: m, parents: [idOf.get(v.id) as string] });
    return { ops, materialize, idOf, packs };
  };
  /** The blocks the Map shows after the operations: the taxonomy they lead to, read by the Map's own functions. */
  const simulate = (ops: readonly CutOp[], packs: ReadonlyArray<{ id: string; label: string }>, made: ReadonlySet<string> = new Set()): Measured => {
    const map = new Map<string, MeasureNode>(input.nodes.map((x) => [x.id, { id: x.id, label: x.label, parents: [...x.parents], status: x.status, family: x.family }]));
    for (const pk of packs) if (!map.has(pk.id)) map.set(pk.id, { id: pk.id, label: pk.label, parents: input.root ? [input.root] : [] });
    for (const o of ops) {
      if (o.op === 'create') map.set(o.id, { id: o.id, label: o.label, parents: [...o.parents] });
      else {
        const x = map.get(o.id);
        if (!x) continue;
        if (o.op === 'move') x.parents = [...o.parents];
        else x.family = o.family;
      }
    }
    return measureFamily([...map.values()], input.docs, { mode: input.family ?? 'topic', root: input.root, n, sMin, skipGeneric: made });
  };
  const truth = (st: State): Measured => {
    const p = opsOf(st);
    return simulate(p.ops, p.packs, new Set(p.idOf.values()));
  };
  const statsOf = (m: Measured): CutStats => ({ blocks: m.blocks, clearPct: m.clearPct, coverage: m.coverage, largestPct: m.largestPct, smallest: m.smallest });

  const s0 = state0();
  const before = simulate([], []);
  const jBefore = objectiveOf(before);
  /**
   * With a field vocabulary (D-568): the structure is the field's, so nothing is searched. Values on half of the papers that are no macro-area of the
   * vocabulary are split; then every value that matches a concept below a level 1 concept of the vocabulary goes under that concept (one value is
   * enough), a value that matches nothing stays a level 1 value. Never a group made of values that co-occur.
   */
  const packCut = (): State => {
    let st = state0();
    const fixed = new Set(input.fixed ?? []);
    const carry = assess(st, null, null).carry;
    for (const g of top) {
      if (fixed.has(g) || (carry.get(g) ?? 0) / n <= CUT.generic) continue;
      st = splitState(st, g) ?? st;
    }
    for (const l of latent.filter((x) => x.top)) {
      const members = [...st.cut].filter((m) => !st.v.has(m) && l.covers.includes(m) && 1 + 1 + height(m) <= CUT.maxDepth).sort(cmp);
      if (members.length === 0) continue;
      const next = clone(st);
      for (const m of members) {
        next.cut.delete(m);
        next.vpar.set(m, l.id);
      }
      next.cut.add(l.id);
      next.v.set(l.id, { id: l.id, label: l.label, members, kind: 'pack' });
      st = next;
    }
    return st;
  };
  let result: { st: State; j: number } | null = null;
  if (packMode) result = { st: packCut(), j: 0 };
  else {
    const starts: Array<{ st: State }> = preset ? [{ st: preset }] : [climb(s0)];
    // On a small library there is time to start the climb again from the second and third best first step.
    if (!preset && docs.length * top.length <= CUT.detours) for (const d of [1, 2]) starts.push(climb(s0, d));
    // Second start: the values of today gathered under the level 1 concepts of the field vocabulary.
    const tops = latent.filter((l) => l.top);
    if (!preset && tops.length > 0) {
      const s1 = state0();
      for (const l of tops) {
        const members = top.filter((t) => s1.cut.has(t) && !s1.v.has(t) && l.covers.includes(t) && 2 + height(t) <= CUT.maxDepth);
        if (members.length < 2) continue;
        for (const m of members) {
          s1.cut.delete(m);
          s1.vpar.set(m, l.id);
        }
        s1.cut.add(l.id);
        s1.v.set(l.id, { id: l.id, label: l.label, members: [...members].sort(cmp), kind: 'pack' });
      }
      if (s1.v.size > 0) starts.push(climb(s1));
    }
    // The finalists are judged by what the Map will show; too small a gain: no move, the cut stays today's values.
    for (const r of starts) {
      const j = objectiveOf(truth(r.st));
      if (!result || j > result.j + 1e-9) result = { st: r.st, j };
    }
    if (!result || (!preset && result.j < jBefore + CUT.gain)) result = { st: s0, j: jBefore };
  }

  // ---- the moves of the final cut, and the cut with some of them left out
  const finalSt = result.st;
  const finalAgg = assess(finalSt, null, null);
  const inMember = new Set([...finalSt.v.values()].flatMap((v) => v.members));
  const splits = top.filter((g) => !finalSt.cut.has(g) && !inMember.has(g) && !finalSt.lifts.has(g));
  const childOf = (m: string, st: State, a: Agg): CutChild => ({ id: m, label: label(m, st), papers: a.carry.get(m) ?? under(m).size });
  /** Every node that rose out of `g`: in the cut, or gathered under a parent after rising. */
  const riseAll = (st: State, g: string): string[] => [...new Set([...st.cut, ...[...st.v.values()].flatMap((v) => v.members)])].filter((c) => !st.v.has(c) && !topSet.has(c) && topOf(c) === g).sort(cmp);
  const pinsLostBy = (g: string): number => {
    const s = sub(g);
    let c = 0;
    for (const d of docs) if (d.pin !== null && s.has(d.pin) && ownersIn(d.pin, finalSt).length === 0) c++;
    return c;
  };
  const moves: CutMove[] = [];
  for (const g of splits) {
    moves.push({ id: `split:${g}`, kind: 'split', label: label(g), papers: finalAgg.carry.get(g) ?? under(g).size, share: r2(under(g).size / n), children: riseAll(finalSt, g).map((m) => childOf(m, finalSt, finalAgg)), requires: [], pinsLost: pinsLostBy(g) });
  }
  for (const v of [...finalSt.v.values()].sort((a, b) => cmp(a.id, b.id))) {
    const requires = [...new Set(v.members.filter((m) => !topSet.has(m)).map((m) => topOf(m)).filter((g): g is string => g !== undefined && splits.includes(g)))].sort(cmp).map((g) => `split:${g}`);
    moves.push({
      id: `gather:${v.id}`,
      kind: 'gather',
      label: v.label,
      papers: finalAgg.carry.get(v.id) ?? 0,
      share: r2((finalAgg.carry.get(v.id) ?? 0) / n),
      children: v.members.map((m) => childOf(m, finalSt, finalAgg)),
      parent: v.kind === 'pack' ? { kind: 'pack', id: v.id, label: v.label } : { kind: 'provisional', label: v.label },
      requires,
      pinsLost: 0,
      ...(packMode ? {} : { cooc: true }),
    });
  }

  const defaultOff = moves.filter((m) => m.cooc).map((m) => m.id);
  const select: CutProposal['select'] = (skipIds = defaultOff, names = {}) => {
    const off = new Set(skipIds);
    // A move that needs a move left out goes too.
    for (let again = true; again; ) {
      again = false;
      for (const m of moves) if (!off.has(m.id) && m.requires.some((r) => off.has(r))) (off.add(m.id), (again = true));
    }
    const st = clone(finalSt);
    for (const m of moves) {
      if (!off.has(m.id) || m.kind !== 'gather') continue;
      const v = st.v.get(m.id.slice('gather:'.length)) as VNode;
      st.cut.delete(v.id);
      st.v.delete(v.id);
      for (const x of v.members) (st.cut.add(x), st.vpar.delete(x));
    }
    // A deep value whose children all came back to the cut stands as itself again.
    for (let again = true; again; ) {
      again = false;
      for (const [deep, ks] of [...st.lifts].sort((x, y) => cmp(x[0], y[0]))) {
        if (!ks.every((c) => st.cut.has(c))) continue;
        for (const c of ks) st.cut.delete(c);
        st.cut.add(deep);
        st.lifts.delete(deep);
        again = true;
      }
    }
    for (const m of moves) {
      if (!off.has(m.id) || m.kind !== 'split') continue;
      const g = m.id.slice('split:'.length);
      for (const c of risen(st, g)) st.cut.delete(c);
      st.cut.add(g);
    }
    // Provisional parents take the name the user wrote.
    for (const v of st.v.values()) if (v.kind === 'provisional' && names[`gather:${v.id}`]) st.v.set(v.id, { ...v, label: names[`gather:${v.id}`] as string });
    const plan = opsOf(st);
    const after = simulate(plan.ops, plan.packs, new Set(plan.idOf.values()));
    // The blocks of the Map: a value of the Map is the id the node will have; the papers of a block are the ones whose main value it is.
    const backTo = new Map([...plan.idOf].map(([virt, real]) => [real, virt]));
    // The blocks of the Map (`blockValues`): the values under 2 papers, and the ones beyond the 12th, are only shown inside "Other" (D-568), never merged.
    const shown = new Set(blockValues(after.main));
    const items: CutItem[] = [...after.main].filter(([value]) => shown.has(value)).map(([value, papers]) => {
      const id = backTo.get(value) ?? value;
      const virt = st.v.get(id);
      return { id, label: label(id, st), papers, kind: virt ? ('gather' as const) : topSet.has(id) ? ('keep' as const) : ('split-child' as const), ...(virt ? { children: virt.members.map((m) => childOf(m, st, finalAgg)) } : {}) };
    });
    const rest = [...after.main].filter(([value]) => !shown.has(value)).reduce((sum, [, papers]) => sum + papers, 0);
    if (rest > 0) items.push({ id: OTHER_BLOCK, label: 'Other', papers: rest, kind: 'keep' });
    items.sort((a, b) => b.papers - a.papers || cmp(a.id, b.id));
    return { after: statsOf(after), cut: items, ops: plan.ops, materialize: plan.materialize, skipped: [...off].sort(cmp) };
  };

  return { prop: { before: statsOf(before), moves, unclear: before.unclear.slice(0, 5000), defaultSkip: defaultOff, select }, state: finalSt };
}
