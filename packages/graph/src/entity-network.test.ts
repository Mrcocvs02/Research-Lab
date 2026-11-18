import { describe, expect, it } from 'vitest';
import { CONSORTIUM, buildEntityNetwork, communities, topEdges, type EntityDoc, type EntityEdge, type EntityInput, type EntityRequest } from './entity-network.js';
import { createExploreIndex, resolveAuthor } from './explore.js';

const docs = (list: Array<[string, string[], number | null, string[]]>): EntityDoc[] => list.map(([id, authors, year, tags]) => ({ id, authors, year, tags }));
const req = (mode: EntityRequest['mode'], more: Partial<EntityRequest> = {}): EntityRequest => ({ mode, minDocs: 1, minWeight: 0, limit: 800, ...more });
const input = (d: EntityDoc[], extra: Partial<EntityInput> = {}): EntityInput => ({ docs: d, tax: [], clusters: [], docClusters: new Map(), ...extra });
const node = (id: string, status: 'active' | 'deprecated' = 'active', extra: { parents?: string[]; implies?: string[]; color?: string; label?: string } = {}) => ({ id, label: extra.label ?? id, parents: extra.parents ?? [], implies: extra.implies ?? [], status, ...(extra.color ? { color: extra.color } : {}) });
const edgeKey = (e: EntityEdge) => [e.a, e.b].sort().join();

describe('author keys and corrections', () => {
  it('applies merges and splits by key and by written form', () => {
    expect(resolveAuthor('Anna Rossi')).toBe('rossi a');
    expect(resolveAuthor('Anna Rossi', { merge: { 'rossi a': 'bianchi g' }, split: [] })).toBe('bianchi g');
    expect(resolveAuthor('Anna Rossi', { merge: {}, split: ['rossi a'] })).toBe('rossi a|anna rossi');
    expect(resolveAuthor('Andrea Rossi', { merge: {}, split: ['rossi a'] })).toBe('rossi a|andrea rossi');
    // A name that is called like an object property is just a name.
    expect(resolveAuthor('Constructor', { merge: {}, split: [] })).toBe('constructor');
  });

  it('feeds Explore too: merged authors are one node, split ones are several', () => {
    const d = [
      { id: '1', title: 'a', year: 2020, authors: ['Anna Rossi'], tags: [] },
      { id: '2', title: 'b', year: 2021, authors: ['Andrea Rossi'], tags: [] },
    ];
    const tax = { nodes: [], venues: [] };
    expect(createExploreIndex(d, tax).documents('author', 'author:rossi a', 10, 0)?.total).toBe(2);
    const split = createExploreIndex(d, tax, { merge: {}, split: ['rossi a'] });
    expect(split.documents('author', 'author:rossi a|anna rossi', 10, 0)?.total).toBe(1);
    expect(split.documents('author', 'author:rossi a', 10, 0)).toBeNull();
    const merged = createExploreIndex(d, tax, { merge: { 'rossi a': 'bianchi g' }, split: [] });
    expect(merged.documents('author', 'author:bianchi g', 10, 0)?.total).toBe(2);
  });
});

describe('author network', () => {
  const consortium = Array.from({ length: CONSORTIUM + 5 }, (_, i) => `Person ${String.fromCharCode(65 + (i % 26))}${i}`);
  const d = docs([
    ['1', ['Rossi, Anna', 'Bianchi, Giulia'], 2016, []],
    ['2', ['Anna Rossi', 'Giulia Bianchi', 'Neri, Luca'], 2020, []],
    ['3', ['Andrea Rossi'], 2024, []],
    ['4', consortium, 2024, []],
  ]);

  it('counts variants, co-authorship strength and years', () => {
    const n = buildEntityNetwork(input(d), req('author'));
    const rossi = n.nodes.find((x) => x.id === 'author:rossi a')!;
    expect(rossi.count).toBe(3);
    expect(rossi.variants).toContain('Andrea Rossi');
    expect(rossi.years).toHaveLength(10);
    expect(rossi.years.reduce((a, b) => a + b, 0)).toBe(3);
    expect(n.yearRange).toEqual([2016, 2024]);
    expect(n.documents).toBe(4);
    const e = n.edges.find((x) => edgeKey(x) === 'author:bianchi g,author:rossi a')!;
    expect(e.n).toBe(2);
    expect(e.w).toBeCloseTo(1, 5);
    const neri = n.edges.find((x) => edgeKey(x) === 'author:neri l,author:rossi a')!;
    expect(neri.w).toBeCloseTo(Math.log(2) / Math.log(3), 6);
  });

  it('counts consortium authors but gives them no edges', () => {
    const n = buildEntityNetwork(input(d), req('author'));
    const members = new Set(n.nodes.filter((x) => x.label.startsWith('Person')).map((x) => x.id));
    expect(members.size).toBe(CONSORTIUM + 5);
    expect(n.edges.some((x) => members.has(x.a) || members.has(x.b))).toBe(false);
    // A work with exactly CONSORTIUM authors still links them.
    const edge = buildEntityNetwork(input(docs([['1', consortium.slice(0, CONSORTIUM), 2020, []]])), req('author'));
    expect(edge.edges.length).toBeGreaterThan(0);
  });

  it('applies the minimum of documents, the years and the user corrections', () => {
    expect(buildEntityNetwork(input(d), req('author', { minDocs: 2 })).nodes.map((x) => x.id).sort()).toEqual(['author:bianchi g', 'author:rossi a']);
    const y = buildEntityNetwork(input(d), req('author', { years: [2020, 2020] }));
    expect(y.nodes.every((x) => x.count === 1)).toBe(true);
    expect(y.documents).toBe(1);
    const split = buildEntityNetwork(input(d), req('author'), { merge: {}, split: ['rossi a'] });
    expect(split.nodes.map((x) => x.id)).toContain('author:rossi a|andrea rossi');
    expect(split.nodes.find((x) => x.id === 'author:rossi a|anna rossi')!.count).toBe(2);
    const merged = buildEntityNetwork(input(d), req('author'), { merge: { 'neri l': 'bianchi g' }, split: [] });
    expect(merged.nodes.some((x) => x.id === 'author:neri l')).toBe(false);
    expect(merged.nodes.find((x) => x.id === 'author:bianchi g')!.count).toBe(2);
  });

  it('does not depend on the order of the documents', () => {
    const a = buildEntityNetwork(input(d), req('author'));
    const b = buildEntityNetwork(input([...d].reverse()), req('author'));
    expect(b.nodes).toEqual(a.nodes);
    const order = (x: EntityEdge, y: EntityEdge) => (edgeKey(x) < edgeKey(y) ? -1 : 1);
    expect([...b.edges].sort(order)).toEqual([...a.edges].sort(order));
  });

  it('names a community after its most connected author', () => {
    const three = docs([
      ['1', ['A One', 'B Two', 'C Three'], 2020, []],
      ['2', ['A One', 'B Two'], 2021, []],
      ['3', ['A One', 'C Three'], 2021, []],
    ]);
    const a = buildEntityNetwork(input(three), req('author')).nodes.find((x) => x.id === 'author:one a')!;
    expect(a.group).not.toBe('');
    expect(a.groupLabel).toBe('A One');
  });
});

describe('tag network', () => {
  const tax = [
    node('phys', 'active', { label: 'Physics' }),
    node('optics', 'active', { parents: ['phys'], color: '#fffff0' }),
    node('laser', 'active', { parents: ['optics'], implies: ['optics'] }),
    node('stats'),
    node('old', 'deprecated'),
  ];
  const d = docs([
    ['1', [], 2020, ['laser', 'optics', 'phys']],
    ['2', [], 2021, ['laser', 'optics', 'phys', 'stats']],
    ['3', [], 2022, ['optics', 'phys']],
    ['4', [], 2022, ['stats', 'old']],
  ]);

  it('uses cosine co-occurrence, the implied edges, the branch and the colours', () => {
    const n = buildEntityNetwork(input(d, { tax }), req('tag'));
    expect(n.nodes.some((x) => x.id === 'old')).toBe(false);
    const laser = n.nodes.find((x) => x.id === 'laser')!;
    expect(laser.group).toBe('phys');
    expect(laser.groupLabel).toBe('Physics');
    const co = n.edges.find((x) => !x.implies && edgeKey(x) === 'laser,optics')!;
    expect(co.n).toBe(2);
    expect(co.w).toBeCloseTo(2 / Math.sqrt(2 * 3), 6);
    expect(n.edges.some((x) => x.implies && x.a === 'laser' && x.b === 'optics')).toBe(true);
    expect(n.nodes.find((x) => x.id === 'optics')!.colorKey).toBe('#fffff0');
    expect(n.nodes.find((x) => x.id === 'laser')!.colorKey).toBe('phys');
  });

  it('keeps only the tags of enough documents and respects the weight floor', () => {
    expect(buildEntityNetwork(input(d, { tax }), req('tag', { minDocs: 3 })).nodes.map((x) => x.id).sort()).toEqual(['optics', 'phys']);
    expect(buildEntityNetwork(input(d, { tax }), req('tag', { minWeight: 0.9 })).edges.every((e) => e.w >= 0.9)).toBe(true);
  });
});

describe('topic network', () => {
  const clusters = ['c0', 'c1', 'c2'].map((id, i) => ({ id, parent: null, level: 0, terms: [`t${i}`, 'x'], centroid: { x: i * 10, y: 0 } }));
  const d = docs([
    ['1', [], 2020, ['a', 'b']],
    ['2', [], 2020, ['a']],
    ['3', [], 2021, ['a', 'b']],
    ['4', [], 2021, ['z']],
  ]);
  const docClusters = new Map([['1', ['c0']], ['2', ['c0']], ['3', ['c1']], ['4', ['c2']]]);

  it('builds nodes from the clusters of a level and edges from the shared tags', () => {
    const n = buildEntityNetwork(input(d, { clusters, docClusters }), req('topic'));
    expect(n.nodes.map((x) => x.id).sort()).toEqual(['c0', 'c1', 'c2']);
    expect(n.nodes.find((x) => x.id === 'c0')!.label).toBe('t0, x');
    expect(n.edges.some((x) => edgeKey(x) === 'c0,c1')).toBe(true);
    expect(n.edges.some((x) => x.a === 'c2' || x.b === 'c2')).toBe(false);
  });

  it('prefers the label written by Claude and falls back to proximity without tags', () => {
    const labelled = clusters.map((c) => (c.id === 'c1' ? { ...c, label: 'Named' } : c));
    const bare = d.map((x) => ({ ...x, tags: [] }));
    const n = buildEntityNetwork(input(bare, { clusters: labelled, docClusters }), req('topic'));
    expect(n.nodes.find((x) => x.id === 'c1')!.label).toBe('Named');
    expect(n.edges.length).toBeGreaterThan(0);
    expect(n.edges.every((e) => e.w === 0.3)).toBe(true);
  });

  it('shows the children of a level with their parent as the group', () => {
    const kids = [{ id: 'k0', parent: 'c0', level: 1, terms: ['q'], centroid: { x: 0, y: 0 } }, ...clusters];
    const n = buildEntityNetwork(input(d, { clusters: kids, docClusters: new Map([['1', ['c0', 'k0']]]) }), req('topic', { level: 1 }));
    expect(n.nodes).toHaveLength(1);
    expect(n.nodes[0]).toMatchObject({ id: 'k0', group: 'c0' });
  });
});

describe('cap and top-k', () => {
  it('caps the nodes at 800 (the biggest) and says how many there were', () => {
    const many = Array.from({ length: 1000 }, (_, i) => [`d${i}`, [`G Fam${i}`, `G Fam${(i + 1) % 1000}`], 2020, []] as [string, string[], number, string[]]);
    const n = buildEntityNetwork(input(docs(many)), req('author'));
    expect(n.nodes).toHaveLength(800);
    expect(n.total).toBe(1000);
    expect(n.truncated).toBe(true);
    expect(buildEntityNetwork(input(docs(many)), req('author', { limit: 50 })).nodes).toHaveLength(50);
    const ids = new Set(n.nodes.map((x) => x.id));
    expect(n.edges.every((e) => ids.has(e.a) && ids.has(e.b))).toBe(true);
  });

  it('keeps the 8 heaviest edges of each node, an edge surviving when either end wants it', () => {
    const star: EntityEdge[] = Array.from({ length: 20 }, (_, i) => ({ a: 'hub', b: `n${i}`, w: (i + 1) / 40, n: i }));
    // Every leaf has one edge and keeps it: nothing is lost.
    expect(topEdges(star, 0)).toHaveLength(20);
    // With a heavier ring edge per leaf, the hub's own edges are wanted by nobody once each node keeps one.
    const ring: EntityEdge[] = Array.from({ length: 20 }, (_, i) => ({ a: `n${i}`, b: `n${(i + 1) % 20}`, w: 1, n: 1 }));
    expect(topEdges([...star, ...ring], 0, 1).filter((e) => e.a === 'hub')).toHaveLength(0);
    expect(topEdges(star, 0.3).every((e) => e.w >= 0.3)).toBe(true);
  });

  it('finds communities by label propagation', () => {
    const e = (a: string, b: string, w = 1): EntityEdge => ({ a, b, w, n: 1 });
    const edges = [e('a', 'b'), e('b', 'c'), e('a', 'c'), e('x', 'y'), e('y', 'z'), e('x', 'z'), e('c', 'x', 0.1)];
    const lab = communities(['a', 'b', 'c', 'x', 'y', 'z'], edges);
    expect(lab.get('a')).toBe(lab.get('b'));
    expect(lab.get('x')).toBe(lab.get('y'));
    expect(lab.get('a')).not.toBe(lab.get('z'));
  });
});

/** Heavy (RL_HEAVY_TESTS=1): 10 000 documents, up to ten authors and eight tags each, each mode within the 1.5 s of §4.21.3. */
describe.skipIf(!process.env['RL_HEAVY_TESTS'])('entity networks on 10 000 documents', () => {
  it('builds each mode within 1.5 s', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1_664_525 + 1_013_904_223) >>> 0) / 4_294_967_296;
    const authors = Array.from({ length: 6000 }, (_, i) => `Given${i % 17} Fam${i}`);
    const tagIds = Array.from({ length: 400 }, (_, i) => `t${i}`);
    const clusters = Array.from({ length: 120 }, (_, i) => ({ id: `c0.${i}`, parent: null, level: 0, terms: [`w${i}`], centroid: { x: i, y: i % 7 } }));
    const d: EntityDoc[] = Array.from({ length: 10_000 }, (_, i) => ({
      id: `d${i}`,
      year: 1990 + Math.floor(rnd() * 35),
      authors: Array.from({ length: 2 + Math.floor(rnd() * 9) }, () => authors[Math.floor(rnd() * rnd() * authors.length)]!),
      tags: Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => tagIds[Math.floor(rnd() * rnd() * tagIds.length)]!),
    }));
    const docClusters = new Map(d.map((x, i) => [x.id, [`c0.${i % 120}`]] as [string, string[]]));
    const tax = tagIds.map((id, i) => node(id, 'active', { parents: i < 10 ? [] : [`t${i % 10}`] }));
    for (const mode of ['author', 'tag', 'topic'] as const) {
      const t0 = performance.now();
      const n = buildEntityNetwork({ docs: d, tax, clusters, docClusters }, req(mode, { minDocs: 2 }));
      const ms = performance.now() - t0;
      expect(n.nodes.length).toBeGreaterThan(0);
      expect(n.nodes.length).toBeLessThanOrEqual(800);
      expect(ms).toBeLessThan(1500);
    }
  });
});
