/**
 * Macro-areas proposed as a cut of the tree (D-520, section 20.2). The blocks of the Map are the values of level 1 of a family; values on
 * half of the papers (generic) or on one or two (small) make them unclear. A CUT is a set of nodes, none an ancestor of another, taken as the
 * level 1 values. Two moves lead from today's values to a better cut: SPLIT a generic value (its children rise to level 1, the value becomes a
 * family of its own) and GATHER siblings that go together or are small under a common parent (which becomes a level 1 value, the siblings its
 * sub-areas). The parent is, in order, a latent ancestor of the field vocabulary (when given), a node already there, or a provisional name.
 * A greedy climb on an objective of clarity x coverage with penalties for too many or too few blocks, small and generic values; two starts
 * (today's values, and the projection on the level 1 of the field vocabulary); a proposal only if the objective gains 0.05. Pure, deterministic
 * (ties by id), no files. The caller turns the answer into `taxonomy:apply` operations (`select(...).ops`).
 */

export interface CutNode {
  id: string;
  label: string;
  parents: readonly string[];
  status?: string | undefined;
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
  /** The cut with every move except `skip` (move ids); `names` = names for provisional parents by move id. */
  select(skip?: Iterable<string>, names?: Readonly<Record<string, string>>): CutSelection;
}

export const CUT = { kMin: 3, generic: 0.45, share: 0.6, gain: 0.05, rounds: 30, pairs: 40, maxDepth: 3 } as const;

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
  const n = Math.max(1, input.n ?? input.docs.length);
  const kMax = Math.min(10, Math.max(4, Math.round(Math.sqrt(2 * n))));
  const sMin = Math.max(2, Math.ceil(0.04 * n));

  // The tree under today's values.
  const live = new Map(input.nodes.filter((x) => x.status !== 'deprecated').map((x) => [x.id, x]));
  const top = [...new Set(input.top)].filter((t) => live.has(t));
  if (top.length < 2) return null;
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

  // Papers with their weighted tags in the tree, and the papers under each tag.
  const docs = input.docs.map((d) => {
    const w = new Map<string, number>();
    for (const t of d.tags) if (inTree.has(t.id) && t.w > 0) w.set(t.id, Math.max(w.get(t.id) ?? 0, Math.min(1, t.w)));
    return { id: d.id, tags: [...w].sort((a, b) => cmp(a[0], b[0])), pin: d.pin && w.has(d.pin) ? d.pin : null };
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

  const specOf = (agg: Pick<Agg, 'covered' | 'carry'>): Map<string, number> => new Map([...agg.carry].map(([v, c]) => [v, Math.max(0.15, Math.log(agg.covered / c))]));
  const judge = (d: (typeof docs)[number], vals: Map<string, number>, owners: (t: string) => string[], spec: ReadonlyMap<string, number>): { main: string | null; clear: boolean } => {
    if (vals.size === 0) return { main: null, clear: false };
    if (d.pin !== null) {
      const p = owners(d.pin).find((o) => vals.has(o));
      if (p !== undefined) return { main: p, clear: true };
    }
    let best: string | null = null;
    let sum = 0;
    for (const [v, w] of [...vals].sort((a, b) => cmp(a[0], b[0]))) {
      sum += w;
      if (best === null || w * (spec.get(v) ?? 1) > vals.get(best)! * (spec.get(best) ?? 1)) best = v;
    }
    return { main: best, clear: vals.get(best as string)! / sum >= CUT.share };
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
        for (const c of own) vals.set(c, Math.min(1, (vals.get(c) ?? 0) + w / own.length));
      }
      if (vals.size > 0) agg.covered++;
      for (const v of vals.keys()) bump(agg.carry, v, 1);
      agg.docs.set(i, { main: null, clear: false, vals });
    }
    // The specificity of a value (D-508) follows the papers that carry it now; the others keep the choice they had.
    const spec = specOf(agg);
    for (const i of list) {
      const s = agg.docs.get(i) as DocState;
      const j = judge(docs[i]!, s.vals, owners, spec);
      s.main = j.main;
      s.clear = j.clear;
      if (j.main !== null) bump(agg.main, j.main, 1);
      if (j.clear) agg.clear++;
    }
    return agg;
  };
  const objective = (a: Agg): number => {
    const blocks = a.main.size;
    const clarity = a.covered > 0 ? a.clear / a.covered : 0;
    let small = 0;
    for (const c of a.main.values()) if (c < sMin) small++;
    let generic = 0;
    for (const c of a.carry.values()) if (c / n > CUT.generic) generic++;
    return clarity * (a.covered / n) - 0.04 * Math.max(0, blocks - kMax) - 0.04 * Math.max(0, CUT.kMin - blocks) - 0.03 * small - 0.08 * generic;
  };
  const stats = (a: Agg): CutStats => {
    const counts = [...a.main.values()];
    return { blocks: counts.length, clearPct: Math.round((a.covered > 0 ? a.clear / a.covered : 0) * 100), coverage: Math.round((a.covered / n) * 100), largestPct: Math.round((Math.max(0, ...counts) / n) * 100), smallest: counts.length > 0 ? Math.min(...counts) : 0 };
  };
  const state0 = (): State => ({ cut: new Set(top), v: new Map(), vpar: new Map() });
  const clone = (st: State): State => ({ cut: new Set(st.cut), v: new Map(st.v), vpar: new Map(st.vpar) });

  // ---- moves on a state (a move gives the changed state, or null when it does not apply)
  const slugs = new Set(input.nodes.map((x) => x.id));
  const splitState = (st: State, g: string): State | null => {
    const rise = (kids.get(g) ?? []).filter((c) => under(c).size > 0);
    if (!st.cut.has(g) || st.v.has(g) || rise.length < 2) return null;
    const next = clone(st);
    next.cut.delete(g);
    for (const c of rise) next.cut.add(c);
    return next;
  };
  const latent = [...(input.latent ?? [])].sort((a, b) => a.covers.length - b.covers.length || cmp(a.id, b.id));
  const gatherState = (st: State, a: string, b: string): { state: State; touched: string[] } | null => {
    // The parent: a latent ancestor above both, else a node already there above both, else a provisional name.
    let kind: VNode['kind'] = 'provisional';
    let id = '';
    let name = '';
    let members = [a, b];
    const lat = latent.find((l) => l.covers.includes(a) && l.covers.includes(b));
    if (lat) {
      kind = 'pack';
      id = lat.id;
      name = lat.label;
      members = [...st.cut].filter((m) => !st.v.has(m) && lat.covers.includes(m)).sort(cmp);
    } else {
      const ancs = (x: string): Set<string> => {
        const out = new Set<string>();
        const stack = [...parentsOf(x)];
        while (stack.length > 0) {
          const p = stack.pop() as string;
          if (!out.has(p)) (out.add(p), stack.push(...parentsOf(p)));
        }
        return out;
      };
      const aa = ancs(a);
      // A top above both would only undo the split: that is no gather, the pair gets a parent of its own.
      const common = [...ancs(b)].filter((x) => aa.has(x) && !st.cut.has(x) && !topSet.has(x)).sort((x, y) => sub(x).size - sub(y).size || cmp(x, y));
      if (common.length > 0) {
        // A node already there: it takes the cut members under it, and they stop being values of their own (no new parent).
        const x = common[0] as string;
        if ([...st.v.values()].some((v) => v.members.some((m) => sub(x).has(m)))) return null;
        const next = clone(st);
        const gone = [...st.cut].filter((m) => !st.v.has(m) && sub(x).has(m));
        for (const m of gone) next.cut.delete(m);
        next.cut.add(x);
        return { state: next, touched: [...gone, x] };
      }
    }
    members = members.filter((m) => 1 + 1 + height(m) <= CUT.maxDepth);
    if (members.length < 2 || !members.includes(a) || !members.includes(b)) return null;
    if (kind === 'provisional') {
      members.sort((x, y) => under(y).size - under(x).size || cmp(x, y));
      id = `new:${[...members].sort(cmp).join('+')}`;
      name = members.map((m) => label(m)).slice(0, 3).join(' & ') + (members.length > 3 ? ' & …' : '');
    }
    const next = clone(st);
    for (const m of members) {
      next.cut.delete(m);
      next.vpar.set(m, id);
    }
    next.cut.add(id);
    next.v.set(id, { id, label: name, members: [...members].sort(cmp), kind });
    return { state: next, touched: [...members, id] };
  };

  type Cand = { state: State; touched: string[] };
  type Scored = { state: State; agg: Agg; j: number };
  const score = (c: Cand, st: State, agg: Agg): Scored => {
    const affected = new Set<number>();
    for (const t of c.touched) for (const i of docsOfMember(t, c.state)) affected.add(i);
    const a = assess(c.state, affected, agg);
    return { state: c.state, agg: a, j: objective(a) };
  };
  /** The pairs of cut members (`only`: just these) that go together or are small, best first, as gather candidates. */
  const gatherCands = (st: State, agg: Agg, only?: ReadonlySet<string>): Cand[] => {
    const real = [...st.cut].filter((m) => !st.v.has(m) && (!only || only.has(m))).sort(cmp);
    const ranked: Array<{ a: string; b: string; score: number }> = [];
    for (let x = 0; x < real.length; x++) {
      for (let y = x + 1; y < real.length; y++) {
        const A = docsOfMember(real[x]!, st);
        const B = docsOfMember(real[y]!, st);
        const [few, many] = A.size < B.size ? [A, B] : [B, A];
        let both = 0;
        for (const i of few) if (many.has(i)) both++;
        let sc = A.size > 0 && B.size > 0 ? (both / A.size) * (both / B.size) : 0;
        const small = (agg.main.get(real[x]!) ?? 0) < sMin || (agg.main.get(real[y]!) ?? 0) < sMin;
        // Siblings that are small and have a parent to go under (a latent one, or a node above both that is no value of today) are candidates even if they never co-occur.
        if (sc === 0 && !(small && (latent.some((l) => l.covers.includes(real[x]!) && l.covers.includes(real[y]!)) || (topOf(real[x]!) === topOf(real[y]!) && !topSet.has(real[x]!))))) continue;
        if (sc === 0) sc = 1e-6;
        ranked.push({ a: real[x]!, b: real[y]!, score: sc });
      }
    }
    ranked.sort((p, q) => q.score - p.score || cmp(p.a, q.a) || cmp(p.b, q.b));
    return ranked.slice(0, CUT.pairs).flatMap((p) => gatherState(st, p.a, p.b) ?? []);
  };
  const best = (list: readonly Scored[], j: number): Scored | null => {
    let top: Scored | null = null;
    for (const c of list) if (c.j > j + 1e-9 && (!top || c.j > top.j + 1e-12)) top = c;
    return top;
  };

  /** One greedy climb from `st`. */
  const climb = (start: State): { st: State; agg: Agg; j: number } => {
    let st = start;
    let agg = assess(st, null, null);
    let j = objective(agg);
    for (let round = 0; round < CUT.rounds; round++) {
      const scored: Scored[] = [];
      for (const m of [...st.cut].sort(cmp)) {
        if (st.v.has(m) || (agg.carry.get(m) ?? 0) / n <= CUT.generic) continue;
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
      const pick = best(scored, j);
      if (!pick) break;
      st = pick.state;
      // An exact reading after each step keeps the approximation of the specificity from piling up.
      agg = assess(st, null, null);
      j = objective(agg);
    }
    return { st, agg, j };
  };

  const s0 = state0();
  const agg0 = assess(s0, null, null);
  const j0 = objective(agg0);
  let result = climb(s0);
  // Second start: the values of today gathered under the level 1 concepts of the field vocabulary.
  const tops = latent.filter((l) => l.top);
  if (tops.length > 0) {
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
    if (s1.v.size > 0) {
      const alt = climb(s1);
      if (alt.j > result.j + 1e-9) result = alt;
    }
  }
  // Too small a gain: no move, the cut stays today's values (the answer still carries the numbers of today).
  if (result.j < j0 + CUT.gain) result = { st: s0, agg: agg0, j: j0 };

  // ---- the moves of the final cut, and the cut with some of them left out
  const finalSt = result.st;
  const inMember = new Set([...finalSt.v.values()].flatMap((v) => v.members));
  const splits = top.filter((g) => !finalSt.cut.has(g) && !inMember.has(g));
  const risen = (st: State, g: string): string[] => [...st.cut].filter((c) => !st.v.has(c) && !topSet.has(c) && topOf(c) === g).sort(cmp);
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
    moves.push({ id: `split:${g}`, kind: 'split', label: label(g), papers: result.agg.carry.get(g) ?? under(g).size, share: r2(under(g).size / n), children: riseAll(finalSt, g).map((m) => childOf(m, finalSt, result.agg)), requires: [], pinsLost: pinsLostBy(g) });
  }
  for (const v of [...finalSt.v.values()].sort((a, b) => cmp(a.id, b.id))) {
    const requires = [...new Set(v.members.filter((m) => !topSet.has(m)).map((m) => topOf(m)).filter((g): g is string => g !== undefined && splits.includes(g)))].sort(cmp).map((g) => `split:${g}`);
    moves.push({
      id: `gather:${v.id}`,
      kind: 'gather',
      label: v.label,
      papers: result.agg.carry.get(v.id) ?? 0,
      share: r2((result.agg.carry.get(v.id) ?? 0) / n),
      children: v.members.map((m) => childOf(m, finalSt, result.agg)),
      parent: v.kind === 'pack' ? { kind: 'pack', id: v.id, label: v.label } : { kind: 'provisional', label: v.label },
      requires,
      pinsLost: 0,
    });
  }

  const splitsOf = (st: State): string[] => {
    const members = new Set([...st.v.values()].flatMap((v) => v.members));
    return top.filter((g) => !st.cut.has(g) && !members.has(g));
  };

  const select: CutProposal['select'] = (skipIds = [], names = {}) => {
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
    for (const m of moves) {
      if (!off.has(m.id) || m.kind !== 'split') continue;
      const g = m.id.slice('split:'.length);
      for (const c of risen(st, g)) st.cut.delete(c);
      st.cut.add(g);
    }
    const agg = assess(st, null, null);
    // Provisional parents take the name the user wrote.
    for (const v of st.v.values()) if (v.kind === 'provisional' && names[`gather:${v.id}`]) st.v.set(v.id, { ...v, label: names[`gather:${v.id}`] as string });
    const items: CutItem[] = [...st.cut].map((id) => {
      const virt = st.v.get(id);
      return { id, label: label(id, st), papers: agg.main.get(id) ?? 0, kind: virt ? ('gather' as const) : topSet.has(id) ? ('keep' as const) : ('split-child' as const), ...(virt ? { children: virt.members.map((m) => childOf(m, st, agg)) } : {}) };
    });
    items.sort((a, b) => b.papers - a.papers || cmp(a.id, b.id));
    const ops: CutOp[] = [];
    const materialize: string[] = [];
    const taken = new Set(slugs);
    const idOf = new Map<string, string>();
    for (const v of [...st.v.values()].sort((a, b) => cmp(a.id, b.id))) {
      if (v.kind === 'pack') {
        materialize.push(v.id);
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
    for (const v of [...st.v.values()].sort((a, b) => cmp(a.id, b.id))) for (const m of v.members) ops.push({ op: 'move', id: m, parents: [idOf.get(v.id) as string] });
    return { after: stats(agg), cut: items, ops, materialize, skipped: [...off].sort(cmp) };
  };

  const unclear = docs.flatMap((d, i) => (agg0.docs.get(i)?.clear ? [] : [d.id])).slice(0, 5000);
  return { before: stats(agg0), moves, unclear, select };
}
