import { describe, expect, it } from 'vitest';
import { areaValues, computeAreas, type AreaNode } from './areas.js';
import { mainValue } from './families.js';

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

  it('carries the colour the user gave to an area node, when it is a valid #rrggbb', () => {
    const t = [{ ...n('phys'), color: '#aa3300' }, { ...n('cs'), color: 'red' }, n('optics', ['phys']), n('ml', ['cs'])];
    const m = computeAreas(t, [d('a', ['optics', 1]), d('b', ['ml', 1])]);
    expect(m.areas.find((a) => a.id === 'phys')!.color).toBe('#aa3300');
    expect(m.areas.find((a) => a.id === 'cs')!.color).toBeUndefined();
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
  it('treats childless roots as loose tags when the taxonomy has a hierarchy, and uses them only as a fallback (D-490)', () => {
    const kw = Array.from({ length: 30 }, (_, i) => n(`kw${i}`));
    const t = [...tax, ...kw];
    const many = kw.map((k): [string, number] => [k.id, 1]);
    const m = computeAreas(t, [d('a', ['optics', 1], ...many), d('b', ['ml', 1], ...many.slice(0, 10)), d('c', ['kw3', 1], ['kw4', 1])]);
    // The keywords do not become areas for documents that reach a real one: they keep their full colour.
    expect(m.docs.get('a')!.ar).toEqual([[m.areas.findIndex((x) => x.id === 'phys'), 0, 100]]);
    expect(m.docs.get('b')!.ar[0]![2]).toBe(100);
    // A document with keywords only still gets a colour from them.
    expect(m.docs.get('c')!.ar.map((x) => m.areas[x[0]]!.id).sort()).toEqual(['kw3', 'kw4']);
    expect(m.areas.map((x) => x.id)).toEqual(['cs', 'kw3', 'kw4', 'phys']);
    // A flat taxonomy (fewer than two roots with children) keeps every root as an area.
    const flat = computeAreas(kw, [d('a', ['kw1', 1]), d('b', ['kw2', 1])]);
    expect(flat.areas).toHaveLength(2);
  });
});

describe('the main area of a paper (D-569)', () => {
  // `z` and `a` are the areas (roots with children): the ids are chosen so that the last tie-break (the smaller id) would pick the other one.
  const t = [n('z'), n('a'), n('zk', ['z']), n('zk2', ['z']), n('zk3', ['zk']), n('ak', ['a']), n('ak2', ['a'])];
  const main = (...tags: Array<[string, number]>) => {
    const docs = [d('p', ...tags), d('q', ['zk', 1]), d('r', ['ak', 1])];
    const m = computeAreas(t, docs);
    const list = areaValues(m, 'p')!;
    return mainValue(list);
  };

  it('the area with the biggest total tag weight', () => {
    expect(main(['ak', 0.9], ['zk', 0.6])).toBe('a');
    expect(main(['ak', 0.5], ['zk', 0.6])).toBe('z');
    // Two tags in one area add up.
    expect(main(['ak', 0.4], ['ak2', 0.4], ['zk', 0.7])).toBe('a');
  });

  it('a tag that is the area itself is generic and counts at half, so the specific tags decide', () => {
    expect(main(['a', 1], ['zk', 0.6])).toBe('z');
    // A generic tag alone still gives its area.
    expect(main(['a', 1])).toBe('a');
    // Not generic when it is the only way in with the same weight: 1 against 0.5 + 0.5.
    expect(main(['a', 1], ['zk', 0.5], ['zk2', 0.5])).toBe('z');
  });

  it('ties go to the area reached by the deepest tag, then to the one with more of the tags, then to the id', () => {
    // 1 against 1: `zk3` sits at depth 2, `ak` at depth 1.
    expect(main(['zk3', 1], ['ak', 1])).toBe('z');
    // The same depth, 0.5 + 0.5 against 1: more tags.
    expect(main(['zk', 0.5], ['zk2', 0.5], ['ak', 1])).toBe('z');
    // Nothing separates them: the smaller id.
    expect(main(['zk', 1], ['ak', 1])).toBe('a');
  });

  it('is deterministic: the order of the tags and of the papers does not matter', () => {
    const tags: Array<[string, number]> = [['zk', 0.5], ['zk2', 0.5], ['ak', 1], ['ak2', 0.3]];
    const reference = main(...tags);
    for (const order of [[3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1]]) expect(main(...order.map((i) => tags[i]!))).toBe(reference);
    const docs = [d('p', ...tags), d('q', ['zk', 1]), d('r', ['ak', 1])];
    expect(mainValue(areaValues(computeAreas(t, [...docs].reverse()), 'p')!)).toBe(reference);
  });

  it('every paper with a tag in an area has a main area; a pinned value wins while it is one of its values', () => {
    const m = computeAreas(t, [d('p', ['zk', 1], ['ak', 0.2]), d('q', ['ak', 1])]);
    for (const id of ['p', 'q']) expect(mainValue(areaValues(m, id)!)).not.toBeNull();
    expect(areaValues(m, 'nobody')).toBeNull();
    const list = areaValues(m, 'p')!;
    expect(mainValue(list)).toBe('z');
    expect(mainValue(list, 'a')).toBe('a');
    expect(mainValue(list, 'gone')).toBe('z');
  });
});

describe('the areas under a Topic family root (D-572)', () => {
  const topic: AreaNode = { ...n('topic'), family: 'many' };
  // Level 1: `ma` (covers 90 % of the papers; children `ma1`, `ma2`), `mb` (child `mb1`). `side` is a root outside any family.
  const t = [topic, n('ma', ['topic']), n('mb', ['topic']), n('ma1', ['ma']), n('ma2', ['ma']), n('mb1', ['mb']), n('mc', ['topic']), n('side')];
  const docs = [
    ...Array.from({ length: 8 }, (_, i) => d(`a${i}`, ['ma1', 1])),
    d('x', ['ma2', 1]),
    d('b', ['mb1', 1]),
  ];

  it('the areas are the level-1 children that cover a paper, never the sub-areas of a wide one', () => {
    const m = computeAreas(t, docs);
    // `ma` covers 9 papers out of 10: without the family root it would give way to ma1 and ma2 (D-483).
    expect(m.areas.map((a) => a.id)).toEqual(['ma', 'mb']);
    expect(m.areas.find((a) => a.id === 'ma')!.branches.map((b) => b.id)).toEqual(['ma1', 'ma2']);
    // A level-1 value with no paper is no area, and the family root is none either.
    expect(m.areas.some((a) => a.id === 'mc' || a.id === 'topic')).toBe(false);
  });

  it('a paper with tags of two level-1 values gets its main area by the weight rule, with branches as sub-areas', () => {
    const m = computeAreas(t, [...docs, d('p', ['ma1', 0.4], ['mb1', 0.9])]);
    const list = areaValues(m, 'p')!;
    expect(list.map((e) => e.v).sort()).toEqual(['ma', 'mb']);
    expect(mainValue(list)).toBe('mb');
    const sh = m.docs.get('p')!;
    const top = m.areas[sh.ar[0]![0]]!;
    expect(top.id).toBe('mb');
    expect(top.branches[sh.ar[0]![1]]!.id).toBe('mb1');
  });

  it('roots outside any family are loose: they colour a paper only when it reaches no level-1 value', () => {
    const m = computeAreas(t, [...docs, d('s', ['side', 1]), d('u', ['side', 1], ['mb1', 1])]);
    expect(m.docs.get('u')!.ar.map((x) => m.areas[x[0]]!.id)).toEqual(['mb']);
    expect(m.docs.get('s')!.ar.map((x) => m.areas[x[0]]!.id)).toEqual(['side']);
  });

  it('without a Topic family root the old descent still applies', () => {
    const plain = t.map((x) => (x.id === 'topic' ? n('topic') : x)).filter((x) => x.id !== 'side');
    const m = computeAreas(plain, docs);
    // `topic` covers every paper, so it gives way to ma and mb; `ma` (90 %) gives way once more to ma1 and ma2.
    expect(m.areas.map((a) => a.id).sort()).toEqual(['ma1', 'ma2', 'mb']);
  });
});
