import { describe, expect, it } from 'vitest';
import { knownPairs, novelPairs, pairKeyOf } from './surprise.js';

const ids = ['d0', 'd1', 'd2', 'd3', 'd4'];
const base = (over: Partial<Parameters<typeof novelPairs>[1]> = {}) => ({
  known: new Set<string>(),
  authorsOf: (id: string) => [`Author ${id}`],
  clusterOf: (i: number) => i,
  idOf: (i: number) => ids[i] as string,
  termsOf: () => ['alpha', 'beta', 'gamma'],
  ...over,
});
const pair = (a: number, b: number, text = 0.5) => ({ a, b, text });

describe('novelPairs', () => {
  it('drops pairs already cited either way, linked, dismissed', () => {
    const known = knownPairs([{ docId: 'd0', others: ['d1'] }, { docId: 'd3', others: ['d2'] }], [{ a: 'd0', b: 'd4' }]);
    const out = novelPairs([pair(0, 1), pair(2, 3), pair(0, 4), pair(1, 2)], base({ known }));
    expect(out.map((p) => pairKeyOf(ids[p.a]!, ids[p.b]!))).toEqual(['d1|d2']);
  });
  it('drops shared authors and weak evidence, and says nothing when nothing passes', () => {
    expect(novelPairs([pair(0, 1)], base({ authorsOf: () => [' Same Author '] }))).toEqual([]);
    expect(novelPairs([pair(0, 1)], base({ termsOf: () => ['one'] }))).toEqual([]);
    expect(novelPairs([], base())).toEqual([]);
  });
  it('ranks pairs across clusters first', () => {
    const out = novelPairs([pair(0, 1, 0.6), pair(2, 3, 0.4)], base({ clusterOf: (i) => (i < 2 ? 0 : i) }));
    expect(out.map((p) => p.a)).toEqual([2, 0]);
  });
});
