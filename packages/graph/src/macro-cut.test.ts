import { describe, expect, it } from 'vitest';
import { areaValues, computeAreas, topicNodes } from './areas.js';
import { NO_VALUE_BLOCK, OTHER_BLOCK, layoutBlocks } from './blocks.js';
import { mainValue, type PaperValues } from './families.js';
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
    const sel = p.select([]);
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

  it('without a field vocabulary a group by co-occurrence is only offered: flagged and unticked to begin with (D-568), the split stays', () => {
    const p = proposeCut(corpus())!;
    expect(p.moves.find((m) => m.kind === 'gather')?.cooc).toBe(true);
    expect(p.moves.find((m) => m.kind === 'split')?.cooc).toBeUndefined();
    expect(p.defaultSkip).toEqual(['gather:new:a+b']);
    const start = p.select();
    expect(start.skipped).toEqual(['gather:new:a+b']);
    expect(start.ops.some((o) => o.op === 'create')).toBe(false);
    expect(start.cut.map((c) => c.id).sort()).toEqual(['a', 'b', 'c', 'c1', 'c2', 'c3', 'c4', 'd']);
    // Ticking it is the user's call, and the preview follows.
    expect(p.select([]).ops.some((o) => o.op === 'create')).toBe(true);
  });

  it('is deterministic', () => {
    const run = () => {
      const p = proposeCut(corpus())!;
      return JSON.stringify({ before: p.before, moves: p.moves, sel: p.select([]) });
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

  it('does not propose a gather that would take a node below depth 3', () => {
    const base = corpus();
    // `a` has a child and a grandchild: under a new parent it would sit at level 2, its grandchild at level 4.
    const input = { ...base, nodes: [...base.nodes, node('a1', ['a']), node('a11', ['a1'])] };
    const p = proposeCut(input)!;
    expect(p.moves.some((m) => m.kind === 'gather' && m.children.some((c) => c.id === 'a'))).toBe(false);
    expect(depthAfter(input, p.select([]).ops)).toBeLessThanOrEqual(3);
  });

  it('proposes nothing when the cut does not improve the objective by 0.05', () => {
    const nodes = [node('topic', []), ...['a', 'b', 'c', 'd', 'e'].map((id) => node(id))];
    const all = ['a', 'b', 'c', 'd', 'e'].flatMap((t) => docs(t, 20, () => [t]));
    const p = proposeCut({ nodes, top: ['a', 'b', 'c', 'd', 'e'], root: 'topic', docs: all, n: all.length })!;
    expect(p.moves).toEqual([]);
    expect(p.before.clearPct).toBe(100);
    expect(p.select([]).ops).toEqual([]);
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
    // Without a vocabulary the groups by co-occurrence are offered and flagged, whatever the size (D-568).
    expect(p.moves.every((m) => m.kind === 'split' || m.cooc)).toBe(true);
  });

  it.skipIf(!process.env['RL_HEAVY_TESTS'])('keeps the targets on 5000 papers of the hard shape too', () => {
    const input = bigCorpus(5000, 20);
    const t0 = performance.now();
    const p = proposeCut(input)!;
    expect(performance.now() - t0).toBeLessThan(300);
    const a = p.select([]).after;
    expect(a.blocks).toBeGreaterThanOrEqual(4);
    expect(a.blocks).toBeLessThanOrEqual(7);
    expect(a.largestPct).toBeLessThanOrEqual(50);
    expect(a.clearPct).toBeGreaterThan(p.before.clearPct);
  });
});

/**
 * With a field vocabulary the macro-areas are the field's (D-568). `amber` and `cobalt` are two areas of the vocabulary that meet on most papers
 * (30 of 48); `copper` matches nothing; `tiny` sits on one paper.
 */
function fieldCorpus(): CutInput {
  const nodes = [node('topic', []), node('amber'), node('cobalt'), node('copper'), node('tiny')];
  const all = [...docs('ac', 30, () => ['amber', 'cobalt']), ...docs('a', 5, () => ['amber']), ...docs('c', 5, () => ['cobalt']), ...docs('k', 7, () => ['copper']), ...docs('t', 1, () => ['tiny'])];
  return {
    nodes,
    top: ['amber', 'cobalt', 'copper', 'tiny'],
    root: 'topic',
    docs: all,
    n: all.length,
    latent: [
      { id: 'f-amber', label: 'Amber field', covers: ['amber'], top: true },
      { id: 'f-cobalt', label: 'Cobalt field', covers: ['cobalt'], top: true },
    ],
  };
}

describe('with a field vocabulary the macro-areas are the field\'s, never groups by co-occurrence (D-568)', () => {
  it('two areas that meet on most papers stay two macro-areas, each under its own concept', () => {
    const input = fieldCorpus();
    const p = proposeCut(input)!;
    expect(p.moves.map((m) => m.id)).toEqual(['gather:f-amber', 'gather:f-cobalt']);
    // Every move places ONE value under ITS concept: no parent holds two values, none is a group by co-occurrence.
    expect(p.moves.every((m) => m.children.length === 1 && m.parent?.kind === 'pack' && !m.cooc)).toBe(true);
    expect(p.defaultSkip).toEqual([]);
    const sel = p.select();
    expect(sel.materialize).toEqual(['f-amber', 'f-cobalt']);
    expect(sel.ops).toEqual([{ op: 'move', id: 'amber', parents: ['f-amber'] }, { op: 'move', id: 'cobalt', parents: ['f-cobalt'] }]);
    expect(sel.cut.filter((c) => c.kind === 'gather').map((c) => [c.id, c.children?.map((k) => k.id)])).toEqual([['f-amber', ['amber']], ['f-cobalt', ['cobalt']]]);
  });

  it('a pack with nothing latent left offers no grouping either: `pack` alone switches the co-occurrence search off', () => {
    const input = { ...fieldCorpus(), latent: [], pack: true };
    const p = proposeCut(input)!;
    expect(p.moves).toEqual([]);
    expect(p.select().ops).toEqual([]);
  });

  it('a user area that matches a concept of the vocabulary goes under that concept\'s macro-area (even alone, or with a sibling); the value that is the macro-area stays', () => {
    const nodes = [node('topic', []), node('sub1'), node('sub2'), node('solo'), node('own'), node('field-z')];
    const all = [...docs('a', 9, () => ['sub1']), ...docs('b', 6, () => ['sub2']), ...docs('s', 5, () => ['solo']), ...docs('o', 8, () => ['own']), ...docs('z', 7, () => ['field-z'])];
    const input: CutInput = {
      nodes,
      top: ['sub1', 'sub2', 'solo', 'own', 'field-z'],
      root: 'topic',
      docs: all,
      n: all.length,
      // `field-z` is a level 1 concept of the vocabulary that the library already has as a node: it is the macro-area itself.
      fixed: ['field-z'],
      latent: [
        { id: 'f-two', label: 'Two', covers: ['sub1', 'sub2'], top: true },
        { id: 'f-one', label: 'One', covers: ['solo'], top: true },
        { id: 'f-mid', label: 'Middle', covers: ['sub1'] },
      ],
    };
    const p = proposeCut(input)!;
    expect(p.moves.map((m) => [m.id, m.children.map((c) => c.id)])).toEqual([['gather:f-one', ['solo']], ['gather:f-two', ['sub1', 'sub2']]]);
    const sel = p.select();
    expect(sel.ops).toEqual([{ op: 'move', id: 'solo', parents: ['f-one'] }, { op: 'move', id: 'sub1', parents: ['f-two'] }, { op: 'move', id: 'sub2', parents: ['f-two'] }]);
    // The area that matches nothing, and the one that is a macro-area, stay level 1 values of their own.
    expect(sel.cut.map((c) => c.id).sort()).toEqual(['f-one', 'f-two', 'field-z', 'own']);
    expect(sel.ops.some((o) => o.id === 'own' || o.id === 'field-z')).toBe(false);
    const packs = { 'f-one': 'One', 'f-two': 'Two' };
    const map = mapShows(applied(input, sel.ops, packs), input.docs);
    expect(sel.after).toEqual({ blocks: map.blocks, clearPct: map.clearPct, coverage: map.coverage, largestPct: map.largestPct, smallest: map.smallest });
  });

  it('a value on half of the papers is split unless it is a macro-area of the vocabulary', () => {
    const nodes = [node('topic', []), node('big'), node('k1', ['big']), node('k2', ['big']), node('x'), node('y')];
    const all = [...docs('b', 40, (i) => ['big', `k${(i % 2) + 1}`]), ...docs('x', 10, () => ['x']), ...docs('y', 10, () => ['y'])];
    const input: CutInput = { nodes, top: ['big', 'x', 'y'], root: 'topic', docs: all, n: all.length, pack: true, latent: [] };
    expect(proposeCut(input)!.moves.map((m) => m.id)).toEqual(['split:big']);
    expect(proposeCut({ ...input, fixed: ['big'] })!.moves).toEqual([]);
  });

  it('a macro-area on one paper is shown only inside "Other": no block, no merge into another area', () => {
    const input = fieldCorpus();
    const p = proposeCut(input)!;
    expect(p.moves.flatMap((m) => m.children.map((c) => c.id))).not.toContain('tiny');
    const sel = p.select();
    expect(sel.cut.map((c) => c.id).sort()).toEqual([OTHER_BLOCK, 'copper', 'f-amber', 'f-cobalt']);
    expect(sel.cut.find((c) => c.id === OTHER_BLOCK)).toMatchObject({ papers: 1 });
    expect(sel.cut.some((c) => c.id === 'tiny')).toBe(false);
    // Nothing is made of it in the taxonomy: no operation touches `tiny`.
    expect(sel.ops.some((o) => o.id === 'tiny')).toBe(false);
    const map = mapShows(applied(input, sel.ops, { 'f-amber': 'Amber field', 'f-cobalt': 'Cobalt field' }), input.docs);
    expect(map.blocks).toBe(4);
    expect(sel.after).toEqual({ blocks: map.blocks, clearPct: map.clearPct, coverage: map.coverage, largestPct: map.largestPct, smallest: map.smallest });
    expect(sel.after.smallest).toBeGreaterThanOrEqual(2);
  });

  it('every paper with a tag has a main macro-area; the preview is what the Map shows, for the whole cut and for a move left out; the same twice', () => {
    const input = fieldCorpus();
    const p = proposeCut(input)!;
    for (const skip of [[], ['gather:f-amber'], p.moves.map((m) => m.id)]) {
      const sel = p.select(skip);
      const map = mapShows(applied(input, sel.ops, { 'f-amber': 'Amber field', 'f-cobalt': 'Cobalt field' }), input.docs);
      expect(sel.after).toEqual({ blocks: map.blocks, clearPct: map.clearPct, coverage: map.coverage, largestPct: map.largestPct, smallest: map.smallest });
      expect(sel.after.coverage).toBe(100);
    }
    expect(p.select(p.moves.map((m) => m.id)).after).toEqual(p.before);
    const run = () => JSON.stringify({ moves: proposeCut(fieldCorpus())!.moves, sel: proposeCut(fieldCorpus())!.select() });
    expect(run()).toBe(run());
  });

  it.skipIf(!process.env['RL_HEAVY_TESTS'])('stays within 300 ms on 5000 papers with a vocabulary', () => {
    const rnd = makeRandom(11);
    const vs = Array.from({ length: 20 }, (_, i) => `v${i}`);
    const nodes: CutNode[] = [node('topic', []), ...vs.map((v) => node(v))];
    const all: CutDoc[] = Array.from({ length: 5000 }, (_, i) => ({ id: `d${i}`, tags: [...new Set([vs[Math.floor(rnd() * 20)]!, vs[Math.floor(rnd() * 20)]!])].map((id) => ({ id, w: 1 })) }));
    const latent = Array.from({ length: 6 }, (_, k) => ({ id: `f${k}`, label: `F${k}`, covers: vs.filter((_, j) => j % 6 === k), top: true }));
    const input: CutInput = { nodes, top: vs, root: 'topic', docs: all, n: 5000, latent, pack: true };
    const t0 = performance.now();
    const p = proposeCut(input)!;
    expect(performance.now() - t0).toBeLessThan(300);
    expect(p.moves.every((m) => !m.cooc && m.parent?.kind === 'pack')).toBe(true);
    expect(p.select().after.coverage).toBe(100);
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
  for (const d of docs) {
    const list = areaValues(model, d.id);
    if (list) lists.set(d.id, list);
  }
  let clear = 0;
  const placed = docs.map((d) => {
    const list = lists.get(d.id) ?? [];
    const value = mainValue(list);
    if (value !== null && list.find((e) => e.v === value)!.w / list.reduce((s, e) => s + e.w, 0) >= 0.6) clear++;
    return { id: d.id, value };
  });
  const layout = layoutBlocks({ docs: placed, labels: new Map(), aspect: 1.6 });
  // The blocks of their own: "Other" (the values under 2 works) stays out of the sizes, as in the preview.
  const counts = layout.blocks.filter((b) => b.id !== NO_VALUE_BLOCK && b.id !== OTHER_BLOCK).map((b) => b.count);
  const other = layout.blocks.find((b) => b.id === OTHER_BLOCK)?.count ?? 0;
  const withValue = placed.filter((d) => d.value !== null).length;
  return { blocks: counts.length + (other > 0 ? 1 : 0), smallest: counts.length > 0 ? Math.min(...counts) : other, largestPct: Math.round((Math.max(0, ...counts, other) / docs.length) * 100), clearPct: Math.round((clear / withValue) * 100), coverage: Math.round((withValue / docs.length) * 100), counts: [...counts, ...(other > 0 ? [other] : [])].sort((a, b) => b - a) };
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
    // 12 values with works; the ones under 2 works are shown inside "Other" (D-568): 8 blocks of their own and Other.
    expect(p.before).toMatchObject({ blocks: 9, clearPct: 12, smallest: 2 });
    expect(p.defaultSkip.length).toBe(p.moves.length);
    const sel = p.select([]);
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
    const sel = p.select([]);
    const m = measureFamily(applied(input, sel.ops), input.docs, { mode: 'topic' });
    expect(sel.after).toMatchObject({ blocks: m.blocks, clearPct: m.clearPct, smallest: m.smallest });
  });

  it('leaves no block of one work: the values that hold one work each go under a parent', () => {
    // `v13` and `v14` hold one work each (and do not meet): today two blocks of one.
    const base = hard();
    const docs = [...base.docs.filter((d) => !d.tags.some((t) => t.id === 'v13' || t.id === 'v14')), { id: 'x1', tags: [{ id: 'v13', w: 1 }, { id: 'v01', w: 1 }] }, { id: 'x2', tags: [{ id: 'v14', w: 1 }] }];
    const input = { ...base, docs, n: docs.length };
    const p = proposeCut(input)!;
    expect(measureFamily(input.nodes, input.docs, { mode: 'topic' }).small).toBeGreaterThan(0);
    const sel = p.select([]);
    expect(sel.after.smallest).toBeGreaterThanOrEqual(2);
    const gathered = new Set(p.moves.flatMap((m) => m.children.map((c) => c.id)));
    expect(gathered.has('v13') && gathered.has('v14')).toBe(true);
  });

  it('applies the targets across invented libraries of the same shape (never worse than today, always 4-7 blocks)', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const input = shaped(seed);
      const p = proposeCut(input)!;
      const a = p.select([]).after;
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

/**
 * Isolated values (D-562): 11 values on 1 to 4 works each, every work on one value only (no co-occurrence), five works with no value. `depth` = levels
 * under each value (the works carry the deepest tag): a value with two levels under it cannot go under a new parent without passing depth 3.
 */
function isolated(depth: number, sizes = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1, 1]): CutInput {
  const vals = sizes.map((_, i) => `v${String(i + 1).padStart(2, '0')}`);
  const nodes: CutNode[] = [node('topic', []), ...vals.map((v) => node(v))];
  const all: CutDoc[] = [];
  sizes.forEach((count, i) => {
    let leaf = vals[i]!;
    for (let d = 0; d < depth; d++) {
      nodes.push(node(`${vals[i]}k${d}`, [leaf]));
      leaf = `${vals[i]}k${d}`;
    }
    for (let k = 0; k < count; k++) all.push({ id: `w${i}_${k}`, tags: [{ id: leaf, w: 1 }] });
  });
  for (let k = 0; k < 5; k++) all.push({ id: `z${k}`, tags: [] });
  return { nodes, top: vals, root: 'topic', docs: all, n: all.length };
}

describe('isolated values: no block of one work is left (D-562)', () => {
  for (const depth of [0, 1, 2]) {
    it(`values with ${depth} level(s) under them: all go under a parent, the preview is what the Map shows, depth stays within 3`, () => {
      const input = isolated(depth);
      const p = proposeCut(input)!;
      expect(measureFamily(input.nodes, input.docs, { mode: 'topic' }).small).toBeGreaterThan(0);
      for (const skip of [[], [p.moves[0]!.id], p.moves.map((m) => m.id)]) {
        const sel = p.select(skip);
        const map = mapShows(applied(input, sel.ops), input.docs);
        expect(sel.after).toEqual({ blocks: map.blocks, clearPct: map.clearPct, coverage: map.coverage, largestPct: map.largestPct, smallest: map.smallest });
        expect(depthAfter(input, sel.ops)).toBeLessThanOrEqual(3);
      }
      const sel = p.select([]);
      expect(sel.after.smallest).toBeGreaterThanOrEqual(2);
      expect(sel.after.clearPct).toBe(100);
      // Values that never meet have no reason to merge once none is small: the block count may stay a little above k_max.
      expect(sel.after.blocks).toBeLessThanOrEqual(8);
      expect(p.select(p.moves.map((m) => m.id)).after).toEqual(p.before);
    });
  }

  it('one lone isolated value joins the smallest block rather than staying a block of one', () => {
    const input = isolated(2, [5, 4, 4, 3, 3, 2, 1]);
    const p = proposeCut(input)!;
    expect(measureFamily(input.nodes, input.docs, { mode: 'topic' }).small).toBeGreaterThan(0);
    const sel = p.select([]);
    expect(sel.after.smallest).toBeGreaterThanOrEqual(2);
    expect(mapShows(applied(input, sel.ops), input.docs).smallest).toBeGreaterThanOrEqual(2);
  });
});

describe('measureFamily under a Topic family root (D-572)', () => {
  it('a macro-area that covers most papers stays a block; its sub-areas never become blocks', () => {
    const nodes = [
      { id: 'topic', label: 'Topic', parents: [] as string[], family: 'many' },
      { id: 'ma', label: 'MA', parents: ['topic'] },
      { id: 'mb', label: 'MB', parents: ['topic'] },
      { id: 'ma1', label: 'MA1', parents: ['ma'] },
      { id: 'ma2', label: 'MA2', parents: ['ma'] },
      { id: 'mb1', label: 'MB1', parents: ['mb'] },
    ];
    const tags = (id: string) => [{ id, w: 1 }];
    const docs = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, tags: tags('ma1') })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: `c${i}`, tags: tags('ma2') })),
      { id: 'b0', tags: tags('mb1') },
      { id: 'b1', tags: tags('mb1') },
    ];
    const m = measureFamily(nodes, docs, { mode: 'topic' });
    expect([...m.main.keys()].sort()).toEqual(['ma', 'mb']);
    expect(m.main.get('ma')).toBe(8);
    expect(m.blocks).toBe(2);
  });
});
