import { describe, expect, it } from 'vitest';
import { adjacency, bundleEdges, filterKinds, selectEdges, type EvEdge } from './edges';

const e = (a: string, b: string, w: number, kinds: EvEdge['kinds'] = ['similar']): EvEdge => ({ a, b, e: kinds.includes('similar') && kinds.length === 1 ? w : 1, kinds, w });

describe('evidence edges of the Map', () => {
  const edges = [e('a', 'b', 0.9), e('a', 'c', 0.8), e('a', 'd', 0.7), e('a', 'f', 0.6), e('b', 'c', 0.5), e('a', 'g', 0.4), e('a', 'h', 0.3), e('x', 'y', 0.5, ['cites'])];

  it('draws at most 5 edges for the selected paper', () => {
    const picked = selectEdges('selected', adjacency(edges), ['a', null]);
    expect(picked).toHaveLength(5);
    expect(picked.every((p) => p.a === 'a' || p.b === 'a')).toBe(true);
    expect(selectEdges('none', adjacency(edges), ['a'])).toEqual([]);
  });

  it('keeps an edge in the strong mode only when it is among the first 2 of both ends', () => {
    const picked = selectEdges('strong', adjacency(edges), []);
    const degree = new Map<string, number>();
    for (const p of picked) for (const id of [p.a, p.b]) degree.set(id, (degree.get(id) ?? 0) + 1);
    expect(Math.max(...degree.values())).toBeLessThanOrEqual(2);
    expect(picked.map((p) => `${p.a}${p.b}`).sort()).toEqual(['ab', 'ac', 'bc', 'xy']);
  });

  it('drops an edge whose kinds are all off', () => {
    const out = filterKinds([e('a', 'b', 0.9), e('a', 'c', 1, ['cites', 'similar'])], { cites: false, linked: true, similar: false });
    expect(out).toEqual([]);
    expect(filterKinds([e('a', 'c', 1, ['cites', 'similar'])], { cites: true, linked: true, similar: false })[0]!.kinds).toEqual(['cites']);
  });

  it('bundles two or more pairs between the same blocks, leaves a lone pair alone', () => {
    const block: Record<string, number> = { a: 0, b: 0, c: 1, d: 1, f: 2 };
    const r = bundleEdges([e('a', 'c', 0.5), e('b', 'd', 0.5), e('a', 'f', 0.5), e('a', 'b', 0.5)], (id) => block[id] ?? -1);
    expect(r.bundles).toHaveLength(1);
    expect(r.bundles[0]!.pairs).toHaveLength(2);
    expect(r.single).toHaveLength(2);
  });
});
