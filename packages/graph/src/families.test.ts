import { describe, expect, it } from 'vitest';
import { FAMILY_TOP, OTHER_CLUSTER, autoMemberships, familyEligibility, familyModel, mainValue, parseFamily, tagMemberships, valueSpecificity, vocabLinks } from './families.js';

const node = (id: string, extra: { level?: string; parents?: string[]; group?: string } = {}) => ({ id, label: id.toUpperCase(), parents: extra.parents ?? [], level: extra.level, group: extra.group });

describe('parseFamily', () => {
  it('reads the kinds and falls back to the topic', () => {
    expect(parseFamily('topic')).toEqual({ kind: 'topic', value: '' });
    expect(parseFamily('auto')).toEqual({ kind: 'auto', value: '' });
    expect(parseFamily('level:method')).toEqual({ kind: 'level', value: 'method' });
    expect(parseFamily('prefix:grp:')).toEqual({ kind: 'prefix', value: 'grp:' });
    expect(parseFamily('group:extra:x')).toEqual({ kind: 'group', value: 'extra:x' });
    expect(parseFamily('nonsense')).toEqual({ kind: 'topic', value: '' });
    expect(parseFamily('level:')).toEqual({ kind: 'topic', value: '' });
  });
});

describe('tagMemberships', () => {
  const nodes = [node('t1'), node('rct', { level: 'method' }), node('rct-blind', { level: 'method', parents: ['rct'] }), node('survey', { level: 'method', parents: ['t1'] })];
  it('uses the top-level members of the family as clusters', () => {
    const m = tagMemberships(parseFamily('level:method'), nodes, [
      { id: 'a', tags: [{ id: 'rct-blind', w: 1 }, { id: 't1', w: 1 }] },
      { id: 'b', tags: [{ id: 'survey', w: 1 }] },
      { id: 'c', tags: [{ id: 't1', w: 1 }] },
    ]);
    expect([...m.docs.keys()].sort()).toEqual(['a', 'b']);
    expect(m.docs.get('a')).toEqual([{ cluster: 'rct', w: 1 }]);
    expect(m.labels.get('rct')).toBe('RCT');
  });
  it('splits the weight of a tag under several top-level members and keeps prefix tags as their own clusters', () => {
    const dag = [node('x', { level: 'method' }), node('y', { level: 'method' }), node('z', { level: 'method', parents: ['x', 'y'] })];
    const m = tagMemberships(parseFamily('level:method'), dag, [{ id: 'a', tags: [{ id: 'z', w: 1 }] }]);
    expect(m.docs.get('a')?.map((e) => [e.cluster, e.w])).toEqual([
      ['x', 0.5],
      ['y', 0.5],
    ]);
    const g = tagMemberships(parseFamily('prefix:grp:'), [], [{ id: 'a', tags: [{ id: 'grp:Lab One', w: 1 }, { id: 't1', w: 1 }] }]);
    expect(g.docs.get('a')).toEqual([{ cluster: 'grp:Lab One', w: 1 }]);
    expect(g.labels.get('grp:Lab One')).toBe('Lab One');
  });
  it('root:<id> uses the values of level 1 under a family root of the controlled vocabulary (D-505)', () => {
    const fam = [node('meth'), node('m1', { parents: ['meth'] }), node('m1-sub', { parents: ['m1'] }), node('m2', { parents: ['meth'] }), node('other')];
    expect(parseFamily('root:meth')).toEqual({ kind: 'root', value: 'meth' });
    const m = tagMemberships(parseFamily('root:meth'), fam, [
      { id: 'a', tags: [{ id: 'm1-sub', w: 1 }] },
      { id: 'b', tags: [{ id: 'm2', w: 1 }, { id: 'other', w: 1 }] },
      { id: 'c', tags: [{ id: 'other', w: 1 }] },
    ]);
    expect(m.docs.get('a')).toEqual([{ cluster: 'm1', w: 1 }]);
    expect(m.docs.get('b')).toEqual([{ cluster: 'm2', w: 1 }]);
    expect(m.docs.has('c')).toBe(false);
  });
});

describe('familyModel', () => {
  it('keeps the biggest seven clusters and gathers the rest in "other"', () => {
    const labels = new Map<string, string>();
    const docs = new Map<string, Array<{ cluster: string; w: number }>>();
    let d = 0;
    for (let c = 0; c < 11; c++) {
      labels.set(`c${c}`, `C${c}`);
      for (let k = 0; k < 12 - c; k++) docs.set(`d${d++}`, [{ cluster: `c${c}`, w: 1 }]);
    }
    const model = familyModel({ labels, docs }, d + 5, 'Other');
    expect(model.areas).toHaveLength(FAMILY_TOP + 1);
    expect(model.areas.map((a) => a.id)).toContain(OTHER_CLUSTER);
    expect(model.areas.find((a) => a.id === OTHER_CLUSTER)!.count).toBe(5 + 4 + 3 + 2);
    expect(model.total).toBe(d + 5);
    expect(model.areas.filter((a) => a.id !== OTHER_CLUSTER)[0]!.id).toBe('c0');
  });
  it('a document in two clusters gets both shares (it lands between them)', () => {
    const docs = new Map([
      ['a', [{ cluster: 'p', w: 0.75 }, { cluster: 'q', w: 0.25 }]],
      ['b', [{ cluster: 'p', w: 1 }]],
      ['c', [{ cluster: 'q', w: 1 }]],
    ]);
    const model = familyModel({ labels: new Map([['p', 'P'], ['q', 'Q']]), docs }, 3, 'Other');
    const ar = model.docs.get('a')!.ar;
    expect(ar).toHaveLength(2);
    expect(ar.reduce((s, t) => s + t[2], 0)).toBe(100);
    expect(Math.max(...ar.map((t) => t[2]))).toBe(75);
    expect(model.docs.get('b')!.ar).toHaveLength(1);
  });
});

describe('autoMemberships', () => {
  it('finds the two blocks of the network and names them by their recurring tags', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `d${i}`);
    const edges: Array<{ a: number; b: number; w: number }> = [];
    for (let blk = 0; blk < 2; blk++) for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) edges.push({ a: blk * 6 + i, b: blk * 6 + j, w: 0.8 });
    edges.push({ a: 0, b: 6, w: 0.05 });
    const tags = (i: number): string[] => (i < 6 ? ['graphs', 'common'] : ['optics', 'common']);
    const m = autoMemberships(ids, edges, tags, (t) => t.toUpperCase(), 'Cluster', 7);
    expect(new Set([...m.docs.values()].map((v) => v[0]!.cluster)).size).toBe(2);
    expect(m.docs.get('d0')![0]!.cluster).toBe(m.docs.get('d5')![0]!.cluster);
    expect(m.docs.get('d0')![0]!.cluster).not.toBe(m.docs.get('d6')![0]!.cluster);
    expect([...m.labels.values()].sort()).toEqual(['GRAPHS', 'OPTICS']);
    const again = autoMemberships(ids, edges, tags, (t) => t.toUpperCase(), 'Cluster', 7);
    expect([...again.docs.entries()]).toEqual([...m.docs.entries()]);
  });
  it('leaves isolated documents out and falls back to a numbered name without tags', () => {
    const m = autoMemberships(['a', 'b', 'c'], [{ a: 0, b: 1, w: 1 }], () => [], (t) => t, 'Cluster');
    expect([...m.docs.keys()].sort()).toEqual(['a', 'b']);
    expect([...m.labels.values()]).toEqual(['Cluster 1']);
  });
});

describe('familyEligibility', () => {
  const clear = (v: string) => [{ v, w: 1 }];
  const docs = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => clear(f(i)));
  it('passes a family with good coverage, clear papers and 2 to 12 values', () => {
    const e = familyEligibility(docs(20, (i) => `v${i % 4}`), 24);
    expect(e).toMatchObject({ eligible: true, values: 4 });
    expect(e.coverage).toBeCloseTo(0.833, 3);
    expect(e.clarity).toBe(1);
  });
  it('fails on coverage under 0.6 and says so', () => {
    const e = familyEligibility(docs(8, (i) => `v${i % 3}`), 25);
    expect(e.eligible).toBe(false);
    expect(e.coverage).toBe(0.32);
  });
  it('fails on clarity under 0.7: papers whose main value holds less than 0.6 of their weight', () => {
    const blurry = Array.from({ length: 10 }, (_, i) => [{ v: `v${i % 2}`, w: 0.55 }, { v: `v${(i + 1) % 2}`, w: 0.45 }]);
    expect(familyEligibility(blurry, 10).eligible).toBe(false);
    expect(familyEligibility(blurry, 10).clarity).toBe(0);
    expect(familyEligibility(blurry, 10, { one: true }).eligible).toBe(true);
    const mixed = [...docs(8, (i) => `v${i % 2}`), ...[0, 1].map(() => [{ v: 'a', w: 0.5 }, { v: 'b', w: 0.5 }])];
    expect(familyEligibility(mixed, 10).clarity).toBe(0.8);
  });
  it('needs at least 2 values; allows more than 12 only when the 12 biggest hold 80%', () => {
    expect(familyEligibility(docs(10, () => 'a'), 10).eligible).toBe(false);
    const many = familyEligibility(docs(100, (i) => (i < 90 ? `v${i % 12}` : `r${i}`)), 100);
    expect(many.values).toBe(22);
    expect(many.eligible).toBe(true);
    expect(familyEligibility(docs(40, (i) => `v${i}`), 40).eligible).toBe(false);
  });
  it('never passes the keywords family, and ignores papers with no value', () => {
    expect(familyEligibility(docs(10, (i) => `v${i % 3}`), 10, { keywords: true }).eligible).toBe(false);
    expect(familyEligibility([...docs(6, (i) => `v${i % 2}`), [], [{ v: 'x', w: 0 }]], 8).coverage).toBe(0.75);
    expect(familyEligibility([], 0)).toMatchObject({ eligible: false, coverage: 0, values: 0 });
  });
  it('mainValue breaks ties by id', () => {
    expect(mainValue([{ v: 'b', w: 1 }, { v: 'a', w: 1 }])).toBe('a');
    expect(mainValue([])).toBeNull();
  });
  it('the main value is the most specific one when weights tie (a generic value does not win)', () => {
    // 10 papers: "wide" on all, "narrow" on 3, "mid" on 6; the tie on weight goes to the rarer value.
    const papers = Array.from({ length: 10 }, (_, i) => [{ v: 'wide', w: 1 }, ...(i < 3 ? [{ v: 'narrow', w: 1 }] : []), ...(i >= 3 && i < 9 ? [{ v: 'mid', w: 1 }] : [])]);
    const spec = valueSpecificity(papers);
    expect(spec.get('narrow')!).toBeGreaterThan(spec.get('mid')!);
    expect(spec.get('wide')).toBe(0.15);
    expect(mainValue(papers[0]!)).toBe('narrow'.localeCompare('wide') < 0 ? 'narrow' : 'wide');
    expect(mainValue(papers[0]!, spec)).toBe('narrow');
    expect(mainValue(papers[5]!, spec)).toBe('mid');
    expect(mainValue(papers[9]!, spec)).toBe('wide'); // only one value: still chosen
    // a clearly heavier weight still wins
    expect(mainValue([{ v: 'wide', w: 1 }, { v: 'narrow', w: 0.2 }], spec)).toBe('narrow');
    expect(mainValue([{ v: 'wide', w: 1 }, { v: 'mid', w: 0.1 }], spec)).toBe('wide');
  });
  it('eligibility counts the specific main values: a 80 % macro and a 60 % one no longer swallow the papers', () => {
    const papers = Array.from({ length: 20 }, (_, i) => [{ v: 'wide', w: 1 }, ...(i % 5 < 3 ? [{ v: 'mid', w: 1 }] : []), { v: `s${i % 4}`, w: 1 }]);
    const e = familyEligibility(papers, 20);
    expect(e.values).toBeGreaterThanOrEqual(4);
  });
});

describe('vocabLinks', () => {
  it('links nodes that go together at least 2 times above chance, at most 2 per node', () => {
    const papers = [...Array.from({ length: 4 }, () => ['x', 'y']), ['x'], ['y'], ...Array.from({ length: 20 }, (_, i) => [`z${i}`]), ['y', 'w'], ['y', 'w']];
    const out = vocabLinks(papers);
    const x = out.find((l) => l.a === 'x' && l.b === 'y')!;
    expect(x.shared).toBe(4);
    expect(x.lift).toBeGreaterThanOrEqual(2);
    const deg = new Map<string, number>();
    for (const l of out) for (const k of [l.a, l.b]) deg.set(k, (deg.get(k) ?? 0) + 1);
    expect(Math.max(...deg.values())).toBeLessThanOrEqual(2);
  });
  it('needs 2 shared papers and lift 2, and honours skip', () => {
    expect(vocabLinks([['a', 'b'], ['a'], ['b'], ['c'], ['c']])).toEqual([]);
    const together = [['a', 'b'], ['a', 'b'], ['c'], ['d'], ['e'], ['f']];
    expect(vocabLinks(together).length).toBe(1);
    expect(vocabLinks(together, (a, b) => a === 'a' && b === 'b')).toEqual([]);
  });
  it('keeps the biggest lifts when a node has more than 2', () => {
    const papers = [['h', 'a'], ['h', 'a'], ['h', 'b'], ['h', 'b'], ['h', 'c'], ['h', 'c'], ...Array.from({ length: 30 }, (_, i) => [`o${i}`])];
    expect(vocabLinks(papers).filter((l) => l.a === 'h' || l.b === 'h').length).toBe(2);
  });
});
