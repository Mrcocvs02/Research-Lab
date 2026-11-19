import { describe, expect, it } from 'vitest';
import { FAMILY_TOP, OTHER_CLUSTER, autoMemberships, familyModel, parseFamily, tagMemberships } from './families.js';

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
