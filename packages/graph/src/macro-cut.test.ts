import { describe, expect, it } from 'vitest';
import { makeRandom } from './random.js';
import { proposeCut, type CutDoc, type CutInput, type CutNode, type CutOp } from './macro-cut.js';

const node = (id: string, parents: string[] = ['topic'], label = id.toUpperCase()): CutNode => ({ id, label, parents });
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
    expect(p.moves.some((m) => m.kind === 'gather')).toBe(false);
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
});
