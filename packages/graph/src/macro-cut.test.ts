import { describe, expect, it } from 'vitest';
import { computeAreas, topicNodes } from './areas.js';
import { NO_VALUE_BLOCK, layoutBlocks } from './blocks.js';
import { mainValue, valueSpecificity, type PaperValues } from './families.js';
import { proposeCut, type CutDoc, type CutInput, type CutNode, type CutOp } from './macro-cut.js';
import { measureFamily } from './macro-measure.js';
import { makeRandom } from './random.js';

const node = (id: string, parents: string[] = ['topic'], label = id.toUpperCase()): CutNode => ({ id, label, parents, ...(id === 'topic' ? { family: 'many' } : {}) });
const docs = (prefix: string, count: number, tags: (i: number) => string[], pin?: (i: number) => string | undefined): CutDoc[] =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, tags: tags(i).map((id) => ({ id, w: 1 })), pin: pin?.(i) ?? null }));

/**
 * 120 invented papers under the family root `topic`: `g` is on half of them (generic) and has four children; `a` and `b` go together on 25
 * papers (3 more carry only `a`, 3 only `b`, so `b` is small); `c` and `d` are single-valued.
 */
function corpus(): CutInput {
  const nodes = [node('topic', []), node('g'), ...['c1', 'c2', 'c3', 'c4'].map((c) => node(c, ['g'])), node('a'), node('b'), node('c'), node('d')];
  const all = [
    ...docs('g', 60, (i) => ['g', `c${(i % 4) + 1}`]),
    ...docs('ab', 25, () => ['a', 'b']),
    ...docs('a', 3, () => ['a']),
    ...docs('b', 3, () => ['b']),
    ...docs('c', 15, () => ['c']),
    ...docs('d', 14, () => ['d']),
  ];
  return { nodes, top: ['g', 'a', 'b', 'c', 'd'], root: 'topic', docs: all, n: all.length };
}

/** The tree after the operations, to check the depth under the root. */
function depthAfter(input: CutInput, ops: readonly CutOp[]): number {
  const parents = new Map(input.nodes.map((n) => [n.id, [...n.parents]]));
  for (const o of ops) {
    if (o.op === 'create') parents.set(o.id, [...o.parents]);
    else if (o.op === 'move') parents.set(o.id, [...o.parents]);
  }
  const depth = (id: string, guard = 0): number => (guard > 10 ? 99 : Math.max(0, ...(parents.get(id) ?? []).map((p) => 1 + depth(p, guard + 1))));
  return Math.max(...[...parents.keys()].map((id) => depth(id)));
}

describe('proposeCut', () => {
  it('splits the generic value and gathers the values that go together: clearer, 3 to 10 blocks, none above half the papers', () => {
    const input = corpus();
    const p = proposeCut(input)!;
    expect(p.moves.map((m) => m.id)).toEqual(['split:g', 'gather:new:a+b']);
    expect(p.before.clearPct).toBe(79);
    const sel = p.select();
    expect(sel.after.clearPct).toBeGreaterThanOrEqual(80);
    expect(sel.after.blocks).toBeGreaterThanOrEqual(3);
    expect(sel.after.blocks).toBeLessThanOrEqual(10);
    expect(sel.after.largestPct).toBeLessThanOrEqual(50);
    expect(sel.after.smallest).toBeGreaterThanOrEqual(2);
    expect(depthAfter(input, sel.ops)).toBeLessThanOrEqual(3);
    // The split value becomes a family of its own and its children rise to the level of the family root; the gathered values go under the new parent.
    expect(sel.ops).toEqual([
      { op: 'create', id: 'a-b', label: 'A & B', parents: ['topic'] },
      { op: 'move', id: 'g', parents: [] },
      { op: 'setFamily', id: 'g', family: 'many' },
      ...['c1', 'c2', 'c3', 'c4'].map((id) => ({ op: 'move', id, parents: ['topic'] })),
      { op: 'move', id: 'a', parents: ['a-b'] },
      { op: 'move', id: 'b', parents: ['a-b'] },
    ]);
    expect(p.moves[0]).toMatchObject({ kind: 'split', label: 'G', children: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }] });
    expect(p.moves[1]).toMatchObject({ kind: 'gather', parent: { kind: 'provisional', label: 'A & B' }, requires: [] });
  });

  it('is deterministic', () => {
    const run = () => {
      const p = proposeCut(corpus())!;
      return JSON.stringify({ before: p.before, moves: p.moves, sel: p.select() });
    };
    expect(run()).toBe(run());
  });

  it('takes the name the user wrote for a provisional parent, and a move left out leaves the rest alone', () => {
    const p = proposeCut(corpus())!;
    const named = p.select([], { 'gather:new:a+b': 'Wave things' });
    expect(named.ops[0]).toEqual({ op: 'create', id: 'wave-things', label: 'Wave things', parents: ['topic'] });
    expect(named.cut.find((c) => c.kind === 'gather')).toMatchObject({ label: 'Wave things', children: [{ id: 'a' }, { id: 'b' }] });
    const noSplit = p.select(['split:g']);
    expect(noSplit.skipped).toEqual(['split:g']);
    expect(noSplit.ops.some((o) => o.op === 'setFamily')).toBe(false);
    expect(noSplit.after.blocks).toBe(4);
    expect(noSplit.cut.map((c) => c.id).sort()).toEqual(['c', 'd', 'g', 'new:a+b']);
    expect(p.select(['split:g', 'gather:new:a+b']).ops).toEqual([]);
  });

  it('a gather over values that a split raised needs the split: leaving the split out leaves the gather out', () => {
    const nodes = [node('topic', []), node('g'), node('c1', ['g']), node('c2', ['g']), node('c3', ['g']), node('x'), node('y')];
    const all = [...docs('p', 40, (i) => (i < 20 ? ['g', 'c1', 'c2'] : ['g', 'c3'])), ...docs('x', 10, () => ['x']), ...docs('y', 10, () => ['y'])];
    const p = proposeCut({ nodes, top: ['g', 'x', 'y'], root: 'topic', docs: all, n: all.length })!;
    const gather = p.moves.find((m) => m.kind === 'gather');
    expect(gather?.requires).toEqual(['split:g']);
    const sel = p.select(['split:g']);
    expect(sel.skipped).toEqual([gather!.id, 'split:g'].sort());
    expect(sel.ops).toEqual([]);
  });

  it('takes the parent from the field vocabulary when there is one, and asks for it to be materialized', () => {
    const input = { ...corpus(), latent: [{ id: 'concept-ab', label: 'Alpha and beta', covers: ['a', 'b'] }] };
    const p = proposeCut(input)!;
    const gather = p.moves.find((m) => m.kind === 'gather')!;
    expect(gather.parent).toEqual({ kind: 'pack', id: 'concept-ab', label: 'Alpha and beta' });
    const sel = p.select();
    expect(sel.materialize).toEqual(['concept-ab']);
    expect(sel.ops).toContainEqual({ op: 'move', id: 'a', parents: ['concept-ab'] });
    expect(sel.ops.some((o) => o.op === 'create')).toBe(false);
  });

  it('does not propose a gather that would take a node below depth 3', () => {
    const base = corpus();
    // `a` has a child and a grandchild: under a new parent it would sit at level 2, its grandchild at level 4.
    const input = { ...base, nodes: [...base.nodes, node('a1', ['a']), node('a11', ['a1'])] };
    const p = proposeCut(input)!;
    expect(p.moves.some((m) => m.kind === 'gather' && m.children.some((c) => c.id === 'a'))).toBe(false);
    expect(depthAfter(input, p.select().ops)).toBeLessThanOrEqual(3);
  });

  it('proposes nothing when the cut does not improve the objective by 0.05', () => {
    const nodes = [node('topic', []), ...['a', 'b', 'c', 'd', 'e'].map((id) => node(id))];
    const all = ['a', 'b', 'c', 'd', 'e'].flatMap((t) => docs(t, 20, () => [t]));
    const p = proposeCut({ nodes, top: ['a', 'b', 'c', 'd', 'e'], root: 'topic', docs: all, n: all.length })!;
    expect(p.moves).toEqual([]);
    expect(p.before.clearPct).toBe(100);
    expect(p.select().ops).toEqual([]);
    expect(proposeCut({ nodes, top: ['a'], root: 'topic', docs: all })).toBeNull();
  });

  it('counts a fixed main value as clear, and tells how many fixed values a split makes automatic again', () => {
    const base = corpus();
    // Three papers of `g` were fixed on `g` itself, two of the `a` and `b` papers were fixed on `a`.
    const fixed = base.docs.map((d, i) => (d.id.startsWith('g') && i < 3 ? { ...d, pin: 'g' } : d.id.startsWith('ab') && i % 12 === 0 ? { ...d, pin: 'a' } : d));
    const p = proposeCut({ ...base, docs: fixed })!;
    expect(p.before.clearPct).toBeGreaterThanOrEqual(79);
    expect(p.moves.find((m) => m.id === 'split:g')?.pinsLost).toBe(3);
  });

  it('lists the papers whose main value is not clear', () => {
    const p = proposeCut(corpus())!;
    expect(p.unclear).toHaveLength(25);
    expect(p.unclear.every((id) => id.startsWith('ab'))).toBe(true);
  });

  it.skipIf(!process.env['RL_HEAVY_TESTS'])('stays within 300 ms on 5000 papers', () => {
    const rnd = makeRandom(7);
    const nodes: CutNode[] = [node('topic', []), node('g')];
    for (let i = 0; i < 12; i++) nodes.push(node(`v${i}`));
    for (let i = 0; i < 8; i++) nodes.push(node(`k${i}`, ['g']));
    const all: CutDoc[] = Array.from({ length: 5000 }, (_, i) => {
      const tags = rnd() < 0.55 ? ['g', `k${Math.floor(rnd() * 8)}`] : [`v${Math.floor(rnd() * 12)}`];
      if (rnd() < 0.3) tags.push(`v${Math.floor(rnd() * 12)}`);
      return { id: `d${i}`, tags: tags.map((id) => ({ id, w: 1 })) };
    });
    const t0 = performance.now();
    const p = proposeCut({ nodes, top: ['g', ...Array.from({ length: 12 }, (_, i) => `v${i}`)], root: 'topic', docs: all, n: 5000 })!;
    expect(performance.now() - t0).toBeLessThan(300);
    expect(p.select().after.largestPct).toBeLessThanOrEqual(50);
  });

  it.skipIf(!process.env['RL_HEAVY_TESTS'])('keeps the targets on 5000 papers of the hard shape too', () => {
    const input = bigCorpus(5000, 20);
    const t0 = performance.now();
    const p = proposeCut(input)!;
    expect(performance.now() - t0).toBeLessThan(300);
    const a = p.select().after;
    expect(a.blocks).toBeGreaterThanOrEqual(4);
    expect(a.blocks).toBeLessThanOrEqual(7);
    expect(a.largestPct).toBeLessThanOrEqual(50);
    expect(a.clearPct).toBeGreaterThan(p.before.clearPct);
  });
});

/**
 * The hard shape found on a real library of 26 works: 14 small, generic values of level 1 (each on 2 to 7 works), almost every work on two or three of them
 * (so none is clear), a few on one. The values belong to five themes (planted below), most works stay within one theme; three works cross themes on purpose.
 */
const VALUES = Array.from({ length: 14 }, (_, i) => `v${String(i + 1).padStart(2, '0')}`);
const THEMES: string[][] = [['v01', 'v02', 'v03'], ['v04', 'v05', 'v06'], ['v07', 'v08', 'v09'], ['v10', 'v11', 'v12'], ['v13', 'v14']];
const WORKS: string[][] = [
  ['v01', 'v02'], ['v01', 'v02'], ['v02', 'v03'], ['v01', 'v03'], ['v01', 'v02', 'v03'], ['v02'],
  ['v04', 'v05'], ['v04', 'v05'], ['v05', 'v06'], ['v04', 'v06'], ['v04', 'v05', 'v06'], ['v04', 'v05', 'v09'],
  ['v07', 'v08'], ['v07', 'v08'], ['v08', 'v09'], ['v07', 'v09', 'v02'], ['v08'],
  ['v10', 'v11'], ['v11', 'v12'], ['v10', 'v12', 'v03'], ['v10', 'v11', 'v12'],
  ['v13', 'v14'], ['v13'],
  ['v03', 'v04'], ['v06', 'v07'], ['v09', 'v10'],
];
function hard(extra: Partial<CutInput> = {}): CutInput {
  const nodes: CutNode[] = [node('topic', []), ...VALUES.map((id) => node(id))];
  const all: CutDoc[] = WORKS.map((tags, i) => ({ id: `w${String(i).padStart(2, '0')}`, tags: tags.map((id) => ({ id, w: 1 })) }));
  return { nodes, top: VALUES, root: 'topic', docs: all, n: all.length, ...extra };
}

/** What the Map shows for a taxonomy, with its own functions: the areas of Topic, the main value of each work, the blocks as laid out, the clarity of section 19.2.2. */
function mapShows(nodes: readonly CutNode[], docs: readonly CutDoc[]) {
  const model = computeAreas(topicNodes(nodes), docs.map((d) => ({ id: d.id, tags: d.tags })));
  const lists = new Map<string, PaperValues>();
  for (const [id, sh] of model.docs) if (sh.ar.length > 0) lists.set(id, sh.ar.map(([a, , q]) => ({ v: model.areas[a]!.id, w: q })));
  const spec = valueSpecificity(lists.values());
  let clear = 0;
  const placed = docs.map((d) => {
    const list = lists.get(d.id) ?? [];
    const value = mainValue(list, spec);
    if (value !== null && list.find((e) => e.v === value)!.w / list.reduce((s, e) => s + e.w, 0) >= 0.6) clear++;
    return { id: d.id, value };
  });
  const layout = layoutBlocks({ docs: placed, labels: new Map(), aspect: 1.6 });
  const counts = layout.blocks.filter((b) => b.id !== NO_VALUE_BLOCK).map((b) => b.count);
  const withValue = placed.filter((d) => d.value !== null).length;
  return { blocks: counts.length, smallest: Math.min(...counts), largestPct: Math.round((Math.max(...counts) / docs.length) * 100), clearPct: Math.round((clear / withValue) * 100), coverage: Math.round((withValue / docs.length) * 100), counts: counts.sort((a, b) => b - a) };
}
/** The taxonomy after the operations (what `taxonomy:apply` makes of them). */
function applied(input: CutInput, ops: readonly CutOp[], packs: Record<string, string> = {}): CutNode[] {
  const map = new Map(input.nodes.map((x) => [x.id, { ...x, parents: [...x.parents] }]));
  for (const [id, label] of Object.entries(packs)) map.set(id, { id, label, parents: input.root ? [input.root] : [] });
  for (const o of ops) {
    if (o.op === 'create') map.set(o.id, { id: o.id, label: o.label, parents: [...o.parents] });
    else if (o.op === 'move') map.get(o.id)!.parents = [...o.parents];
    else map.get(o.id)!.family = o.family;
  }
  return [...map.values()];
}

describe('the hard library: 14 small generic values, works on two or three of them', () => {
  it('is feasible: the themes themselves as parents make at least 80 % of the works clear', () => {
    const nodes = [node('topic', []), ...THEMES.map((_, t) => node(`th${t}`)), ...VALUES.map((v) => node(v, [`th${THEMES.findIndex((t) => t.includes(v))}`]))];
    const m = measureFamily(nodes, hard().docs, { mode: 'topic' });
    expect(m.clearPct).toBeGreaterThanOrEqual(80);
  });

  it('takes 12 blocks and 12 % clear works to 4-7 blocks, none under 2 works, none above half, 80 % clear or more', () => {
    const p = proposeCut(hard())!;
    expect(p.before).toMatchObject({ blocks: 12, clearPct: 12, smallest: 1 });
    const sel = p.select();
    expect(sel.after.blocks).toBeGreaterThanOrEqual(4);
    expect(sel.after.blocks).toBeLessThanOrEqual(7);
    expect(sel.after.smallest).toBeGreaterThanOrEqual(2);
    expect(sel.after.largestPct).toBeLessThanOrEqual(50);
    expect(sel.after.clearPct).toBeGreaterThanOrEqual(80);
    expect(sel.after.coverage).toBe(100);
    // The values of a theme went under one parent each, the tags of the works did not change.
    expect(p.moves.every((m) => m.kind === 'gather' && m.children.length >= 2)).toBe(true);
    expect(depthAfter(hard(), sel.ops)).toBeLessThanOrEqual(3);
  });

  it('the preview is what the Map shows after Apply: same blocks, sizes and clarity, for the whole cut and for a cut with a move left out', () => {
    const input = hard();
    const p = proposeCut(input)!;
    for (const skip of [[], [p.moves[0]!.id], p.moves.map((m) => m.id)]) {
      const sel = p.select(skip);
      const map = mapShows(applied(input, sel.ops), input.docs);
      expect(sel.after).toEqual({ blocks: map.blocks, clearPct: map.clearPct, coverage: map.coverage, largestPct: map.largestPct, smallest: map.smallest });
      // The blocks the dialog draws hold the papers the Map puts in them.
      expect(sel.cut.map((c) => c.papers).sort((a, b) => b - a)).toEqual(map.counts);
    }
    expect(p.select(p.moves.map((m) => m.id)).after).toEqual(p.before);
  });

  it('the preview holds with a fixed main value and with a split, as the Map counts them', () => {
    const base = hard();
    const nodes = [...base.nodes, node('k1', ['v05']), node('k2', ['v05'])];
    const docsWithKids = base.docs.map((d, i) => (i % 4 === 0 && d.tags.some((t) => t.id === 'v05') ? { ...d, tags: [...d.tags, { id: i % 8 === 0 ? 'k1' : 'k2', w: 1 }] } : i === 24 ? { ...d, pin: 'v03' } : d));
    const input = { ...base, nodes, docs: docsWithKids };
    const p = proposeCut(input)!;
    const sel = p.select();
    const m = measureFamily(applied(input, sel.ops), input.docs, { mode: 'topic' });
    expect(sel.after).toMatchObject({ blocks: m.blocks, clearPct: m.clearPct, smallest: m.smallest });
  });

  it('uses the ancestors of the field vocabulary as parents and still reaches the targets', () => {
    const latent = [
      { id: 'c-one', label: 'One', covers: ['v01', 'v02', 'v03'] },
      { id: 'c-two', label: 'Two', covers: ['v04', 'v05', 'v06'] },
      { id: 'c-three', label: 'Three', covers: ['v07', 'v08', 'v09'] },
      { id: 'c-four', label: 'Four', covers: ['v10', 'v11', 'v12'] },
      // A broad concept over most values, as a distractor: a parent over what is left of its values is fine, one over most of the papers would be undone by the Map.
      { id: 'c-wide', label: 'Wide', covers: VALUES.slice(0, 10) },
    ];
    const input = hard({ latent });
    const p = proposeCut(input)!;
    const sel = p.select();
    expect(sel.materialize.length).toBeGreaterThan(0);
    const packs = Object.fromEntries(latent.filter((l) => sel.materialize.includes(l.id)).map((l) => [l.id, l.label]));
    const map = mapShows(applied(input, sel.ops, packs), input.docs);
    expect(sel.after).toEqual({ blocks: map.blocks, clearPct: map.clearPct, coverage: map.coverage, largestPct: map.largestPct, smallest: map.smallest });
    expect(sel.after.blocks).toBeGreaterThanOrEqual(4);
    expect(sel.after.blocks).toBeLessThanOrEqual(7);
    expect(sel.after.smallest).toBeGreaterThanOrEqual(2);
    expect(sel.after.largestPct).toBeLessThanOrEqual(50);
    expect(sel.after.clearPct).toBeGreaterThanOrEqual(80);
  });

  it('leaves no block of one work: the values that hold one work each go under a parent', () => {
    // `v13` and `v14` hold one work each (and do not meet): today two blocks of one.
    const base = hard();
    const docs = [...base.docs.filter((d) => !d.tags.some((t) => t.id === 'v13' || t.id === 'v14')), { id: 'x1', tags: [{ id: 'v13', w: 1 }, { id: 'v01', w: 1 }] }, { id: 'x2', tags: [{ id: 'v14', w: 1 }] }];
    const p = proposeCut({ ...base, docs, n: docs.length })!;
    expect(p.before.smallest).toBe(1);
    const sel = p.select();
    expect(sel.after.smallest).toBeGreaterThanOrEqual(2);
    const gathered = new Set(p.moves.flatMap((m) => m.children.map((c) => c.id)));
    expect(gathered.has('v13') && gathered.has('v14')).toBe(true);
  });

  it('applies the targets across invented libraries of the same shape (never worse than today, always 4-7 blocks)', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const input = shaped(seed);
      const p = proposeCut(input)!;
      const a = p.select().after;
      expect(a.clearPct).toBeGreaterThanOrEqual(p.before.clearPct + 25);
      expect(a.blocks).toBeGreaterThanOrEqual(4);
      expect(a.blocks).toBeLessThanOrEqual(7);
      expect(a.smallest).toBeGreaterThanOrEqual(2);
      expect(a.largestPct).toBeLessThanOrEqual(50);
    }
  });

  it('answers in 50 ms for 300 works', () => {
    const input = bigCorpus(300, 14);
    // The first call of a process pays for the compiler (about twice as long): not what a second proposal costs.
    proposeCut(hard());
    const runs = Array.from({ length: 3 }, () => {
      const t0 = performance.now();
      proposeCut(input);
      return performance.now() - t0;
    });
    expect(Math.min(...runs)).toBeLessThan(50);
  });
});

/** An invented library of 26 works over 13 or 14 values in four or five themes, seeded. */
function shaped(seed: number): CutInput {
  const rnd = makeRandom(seed);
  const nt = 4 + Math.floor(rnd() * 2);
  const theme = VALUES.map((_, i) => (i < nt ? i : Math.floor(rnd() * nt)));
  const pick = (arr: readonly string[]) => arr[Math.floor(rnd() * arr.length)]!;
  const all: CutDoc[] = Array.from({ length: 26 }, (_, k) => {
    const mine = VALUES.filter((_, i) => theme[i] === Math.floor(rnd() * nt));
    const r = rnd();
    const tags = r < 0.12 ? [pick(mine)] : r < 0.52 ? [pick(mine), pick(mine)] : r < 0.77 ? [pick(mine), pick(mine), pick(VALUES)] : r < 0.85 ? [pick(mine), pick(mine), pick(mine)] : [pick(mine), pick(VALUES)];
    return { id: `w${String(k).padStart(2, '0')}`, tags: [...new Set(tags)].map((id) => ({ id, w: 1 })) };
  });
  const present = new Set(all.flatMap((d) => d.tags.map((t) => t.id)));
  return { nodes: [node('topic', []), ...VALUES.map((id) => node(id))], top: VALUES.filter((v) => present.has(v)), root: 'topic', docs: all, n: all.length };
}
/** `n` works on `nv` values in six themes and a generic value with eight children on 40 % of them. */
function bigCorpus(n: number, nv: number): CutInput {
  const rnd = makeRandom(5);
  const vs = Array.from({ length: nv }, (_, i) => `v${i}`);
  const nodes = [node('topic', []), node('g'), ...vs.map((id) => node(id)), ...Array.from({ length: 8 }, (_, i) => node(`k${i}`, ['g']))];
  const all: CutDoc[] = Array.from({ length: n }, (_, i) => {
    const th = Math.floor(rnd() * 6);
    const mine = vs.filter((_, j) => j % 6 === th);
    const tags = rnd() < 0.4 ? ['g', `k${Math.floor(rnd() * 8)}`] : [mine[Math.floor(rnd() * mine.length)]!];
    if (rnd() < 0.6) tags.push(mine[Math.floor(rnd() * mine.length)]!);
    if (rnd() < 0.25) tags.push(vs[Math.floor(rnd() * nv)]!);
    return { id: `d${i}`, tags: [...new Set(tags)].map((id) => ({ id, w: 1 })) };
  });
  return { nodes, top: ['g', ...vs], root: 'topic', docs: all, n };
}
