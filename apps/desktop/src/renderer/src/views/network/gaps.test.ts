import { describe, expect, it } from 'vitest';
import type { EvEdge } from './edges';
import { gapPairs, isolatedOf, mostCentral, MAX_GAP_PAIRS, type GapBlock } from './gaps';

const sim = (a: string, b: string, e: number): EvEdge => ({ a, b, e, kinds: ['similar'], w: e });
const cites = (a: string, b: string): EvEdge => ({ a, b, e: 1, kinds: ['cites'] });

describe('isolated papers', () => {
  it('are the papers with no evidence edge at all', () => {
    const edges = [sim('a', 'b', 0.7), cites('c', 'd')];
    expect([...isolatedOf(['a', 'b', 'c', 'd', 'e', 'f'], edges)].sort()).toEqual(['e', 'f']);
  });

  it('count a similarity only from tau; a citation or a link always', () => {
    const edges = [sim('a', 'b', 0.3), cites('c', 'd'), sim('e', 'f', 0.6)];
    expect([...isolatedOf(['a', 'b', 'c', 'd', 'e', 'f'], edges, 0.5)].sort()).toEqual(['a', 'b']);
  });

  it('ignore an edge to a paper that is not on the map and an edge of a paper to itself', () => {
    expect([...isolatedOf(['a', 'b'], [sim('a', 'zzz', 0.9), sim('b', 'b', 0.9)])].sort()).toEqual(['a', 'b']);
  });
});

const block = (id: string, n: number, extra: Partial<GapBlock> = {}): GapBlock => ({ id, docs: Array.from({ length: n }, (_, i) => `${id}${i}`), ...extra });

describe('pairs of blocks with no link', () => {
  it('lists the pairs with no evidence edge between their papers, the biggest product first', () => {
    const blocks = [block('A', 5), block('B', 4), block('C', 3), block('D', 2)];
    const edges = [sim('A0', 'B0', 0.8)];
    const pairs = gapPairs(blocks, edges);
    expect(pairs.map((p) => [p.a, p.b])).toEqual([
      [0, 2], // 5 x 3
      [1, 2], // 4 x 3
      [0, 3], // 5 x 2
      [1, 3], // 4 x 2
      [2, 3], // 3 x 2
    ]);
    expect(pairs[0]).toMatchObject({ na: 5, nb: 3 });
  });

  it('leaves out Other, No value and blocks of fewer than two papers', () => {
    const blocks = [block('A', 3), block('B', 3), block('o', 4, { other: true }), block('n', 4, { none: true }), block('s', 1)];
    expect(gapPairs(blocks, []).map((p) => [p.a, p.b])).toEqual([[0, 1]]);
  });

  it('shows at most 6, however many blocks', () => {
    const blocks = Array.from({ length: 9 }, (_, i) => block(`B${i}`, 2 + (i % 3)));
    expect(gapPairs(blocks, [])).toHaveLength(MAX_GAP_PAIRS);
    expect(gapPairs(blocks, [], null, 3)).toHaveLength(3);
  });

  it('are none when every pair is tied, and a weak similarity under tau does not tie', () => {
    const blocks = [block('A', 2), block('B', 2)];
    expect(gapPairs(blocks, [cites('A0', 'B1')])).toEqual([]);
    expect(gapPairs(blocks, [sim('A0', 'B1', 0.2)], 0.5)).toHaveLength(1);
  });

  it('is deterministic for equal products (by position)', () => {
    const blocks = [block('A', 2), block('B', 2), block('C', 2)];
    expect(gapPairs(blocks, []).map((p) => [p.a, p.b])).toEqual([[0, 1], [0, 2], [1, 2]]);
  });
});

describe('the most central paper', () => {
  it('has the most evidence edges, then the higher centrality, then the smaller id', () => {
    const docs = ['x', 'y', 'z'];
    expect(mostCentral(docs, [sim('x', 'y', 0.5), sim('y', 'z', 0.5), sim('y', 'q', 0.5)])).toBe('y');
    expect(mostCentral(docs, [], (id) => (id === 'z' ? 3 : 1))).toBe('z');
    expect(mostCentral(docs, [])).toBe('x');
    expect(mostCentral([], [])).toBeNull();
  });
});
