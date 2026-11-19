import { describe, expect, it } from 'vitest';
import { boundsOf, PointGrid } from './geometry';
import type { PreparedMap } from './mapModel';
import { between, yearLayout } from './timeline';

function map(n: number): PreparedMap {
  const xs = new Float32Array(n).map((_, i) => (i % 5) * 10);
  const ys = new Float32Array(n).map((_, i) => Math.floor(i / 5) * 10);
  const bounds = boundsOf(xs, ys, n);
  return { n, ids: Array.from({ length: n }, (_, i) => `d${i}`), xs, ys, bounds, grid: new PointGrid(xs, ys, n, bounds), indexOf: new Map(), levels: [], clusterById: new Map(), groups: [], seed: 1, builtAt: '', omitted: 0 };
}

describe('timeline layout', () => {
  const years: Record<string, number | null> = { d0: 2000, d1: 2005, d2: 2010, d3: null, d4: 2005 };
  it('puts the points on an axis of years, left to right, and the ones without a year after it', () => {
    const { map: m, withoutYear } = yearLayout(map(5), (id) => years[id] ?? null);
    expect(withoutYear).toBe(1);
    expect(m.xs[0]!).toBeLessThan(m.xs[1]!);
    expect(m.xs[1]!).toBeCloseTo(m.xs[4]!, 3);
    expect(m.xs[1]!).toBeLessThan(m.xs[2]!);
    expect(m.xs[3]!).toBeGreaterThan(m.xs[2]!);
  });
  it('keeps the ids and the count of the map', () => {
    const a = map(5);
    const { map: m } = yearLayout(a, () => 2000);
    expect(m.ids).toBe(a.ids);
    expect(m.n).toBe(5);
  });
  it('flies between two layouts and ends on the target', () => {
    const a = map(5);
    const b = yearLayout(a, (id) => years[id] ?? null).map;
    expect(between(a, b, 0).xs[2]).toBeCloseTo(a.xs[2]!, 4);
    expect(between(a, b, 1).xs[2]).toBeCloseTo(b.xs[2]!, 4);
  });
});
