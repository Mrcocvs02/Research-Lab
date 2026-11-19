import { describe, expect, it } from 'vitest';
import { computeAreas, type AreaNode } from './areas.js';

const n = (id: string, parents: string[] = [], status?: string): AreaNode => ({ id, label: id.toUpperCase(), parents, status });
const tax: AreaNode[] = [n('phys'), n('cs'), n('optics', ['phys']), n('quantum', ['phys']), n('ml', ['cs']), n('old', ['phys'], 'deprecated')];
const d = (id: string, ...tags: Array<[string, number]>) => ({ id, tags: tags.map(([t, w]) => ({ id: t, w })) });

describe('computeAreas (§18.3.4)', () => {
  it('uses the roots as areas, ordered by documents, and gives full centrality to a lone strong tag', () => {
    const m = computeAreas(tax, [d('a', ['optics', 1]), d('b', ['quantum', 1]), d('c', ['ml', 1]), d('e', ['ml', 0.4]), d('f', ['optics', 1])]);
    expect(m.areas.map((a) => a.id)).toEqual(['phys', 'cs']);
    expect(m.areas[0]!.count).toBe(3);
    expect(m.docs.get('a')!.ar).toEqual([[0, 0, 100]]);
    expect(m.docs.get('a')!.az).toBe(83);
    expect(m.docs.get('e')!.az).toBe(33);
  });

  it('splits the weight between areas and keeps the top three summing to 100', () => {
    const t = [n('r1'), n('r2'), n('r3'), n('r4'), n('x1', ['r1']), n('x2', ['r2']), n('x3', ['r3']), n('x4', ['r4'])];
    const m = computeAreas(t, [d('a', ['x1', 1], ['x2', 0.5], ['x3', 0.25], ['x4', 0.1]), d('b', ['x1', 1]), d('c', ['x2', 1]), d('e', ['x3', 1]), d('f', ['x4', 1])]);
    const ar = m.docs.get('a')!.ar;
    expect(ar).toHaveLength(3);
    expect(ar.reduce((s, x) => s + x[2], 0)).toBe(100);
    expect(ar[0]![2]).toBeGreaterThan(ar[1]![2]);
  });

  it('descends to the children when a root covers 80 % of the tagged documents', () => {
    const t = [n('all'), n('a', ['all']), n('b', ['all']), n('a1', ['a'])];
    const m = computeAreas(t, [d('1', ['a1', 1]), d('2', ['a1', 1]), d('3', ['b', 1])]);
    expect(m.areas.map((a) => a.id).sort()).toEqual(['a', 'b']);
    expect(m.areas.find((a) => a.id === 'a')!.branches.map((b) => b.id)).toEqual(['a1']);
  });

  it('does not count an ancestor added by the closure twice and divides the weight in a DAG', () => {
    const t = [n('r1'), n('r2'), n('shared', ['r1', 'r2']), n('leaf', ['shared'])];
    const m = computeAreas(t, [d('a', ['leaf', 1], ['shared', 1]), d('b', ['leaf', 1])]);
    expect(m.docs.get('a')!.ar.map((x) => x[2])).toEqual([50, 50]);
  });

  it('leaves documents without known tags without area and ignores deprecated nodes', () => {
    const m = computeAreas(tax, [d('a', ['old', 1]), d('b', ['zzz', 1]), d('c', ['optics', 1]), d('e', ['ml', 1])]);
    expect(m.docs.has('a')).toBe(false);
    expect(m.docs.has('b')).toBe(false);
    expect(m.tagged).toBe(2);
  });

  it('shares a group by the mean of its documents, none under 30 % coverage, and a tag by its areas', () => {
    const m = computeAreas(tax, [d('a', ['optics', 1]), d('b', ['ml', 1]), d('c'), d('e'), d('f')]);
    const g = m.groupShare(['a', 'b'])!;
    expect(g.ar.map((x) => x[2])).toEqual([50, 50]);
    expect(m.groupShare(['a', 'c', 'e', 'f'])).toBeNull();
    expect(m.tagShare('ml')!.ar[0]![0]).toBe(m.docs.get('b')!.ar[0]![0]);
    expect(m.tagShare('nope')).toBeNull();
  });
});
