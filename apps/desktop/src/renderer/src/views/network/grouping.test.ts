import { describe, expect, it } from 'vitest';
import { AREA_TINTS } from './colors';
import { OTHER, OTHER_CLUSTER_ID, assignAreaSlots } from './areaColors';
import { CROSS_CLUSTER, Network, SAME_CLUSTER, clusterAffinity, clusterMultiplier, clustersOf, type RawNode } from './forceSim';
import { applyShares, clearShare, isPartial, offerFamilies, type FamilyInfo } from './grouping';

const def = (id: string) => ({ id, label: id, count: 1, branches: [] });

describe('cluster assignment', () => {
  it('reads shares as memberships and puts nodes without a cluster in the none block', () => {
    expect(clustersOf([[0, -1, 75], [2, -1, 25]])).toEqual([[0, 0.75], [2, 0.25]]);
    expect(clustersOf(undefined)).toEqual([[-1, 1]]);
    expect(clustersOf([])).toEqual([[-1, 1]]);
  });
  it('affinity is 1 inside a cluster, 0 across, partial in between', () => {
    expect(clusterAffinity(clustersOf([[1, -1, 100]]), clustersOf([[1, -1, 100]]))).toBe(1);
    expect(clusterAffinity(clustersOf([[1, -1, 100]]), clustersOf([[2, -1, 100]]))).toBe(0);
    expect(clusterAffinity(clustersOf([[1, -1, 50], [2, -1, 50]]), clustersOf([[2, -1, 100]]))).toBeCloseTo(0.5);
    expect(clusterAffinity(clustersOf(undefined), clustersOf(undefined))).toBe(1);
  });
  it('multiplier: stronger inside, weaker across, monotone and clamped', () => {
    expect(clusterMultiplier(1)).toBe(SAME_CLUSTER);
    expect(clusterMultiplier(0)).toBe(CROSS_CLUSTER);
    expect(SAME_CLUSTER).toBeGreaterThan(1);
    expect(CROSS_CLUSTER).toBeLessThan(1);
    expect(clusterMultiplier(0.5)).toBeGreaterThan(clusterMultiplier(0.2));
    expect(clusterMultiplier(7)).toBe(SAME_CLUSTER);
    expect(clusterMultiplier(-1)).toBe(CROSS_CLUSTER);
  });
  it('"other" never takes a tint and the others keep the first seven', () => {
    const defs = [def(OTHER_CLUSTER_ID), ...Array.from({ length: 9 }, (_, i) => def(`c${i}`))];
    const { slots } = assignAreaSlots(defs, null);
    expect(slots[0]).toBe(OTHER);
    expect(slots.slice(1, 8).sort()).toEqual(Array.from({ length: AREA_TINTS }, (_, i) => i));
    expect(slots[8]).toBe(OTHER);
  });
  it('applyShares installs the shares of documents and clears the others', () => {
    const nodes = [{ kind: 'doc', id: 'a', ar: [[9, -1, 100]] as number[][], az: 5 }, { kind: 'doc', id: 'b' }, { kind: 'tag', id: 't', ar: [[1, -1, 100]] as number[][] }];
    applyShares(nodes, [{ id: 'b', ar: [[0, -1, 60], [1, -1, 40]], az: 80 }]);
    expect(nodes[0]!.ar).toBeUndefined();
    expect(nodes[1]!.ar).toEqual([[0, -1, 60], [1, -1, 40]]);
    expect(nodes[2]!.ar).toEqual([[1, -1, 100]]);
  });
});

function twoBlocks(): Network {
  const raws: RawNode[] = [];
  const net = new Network();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    // Interleaved start: the two clusters are mixed on screen.
    raws.push({ kind: 'doc', id: `d${i}`, label: `d${i}`, x: Math.cos(a) * 120, y: Math.sin(a) * 120, ar: [[i % 2, -1, 100]], az: 100 });
  }
  const edges: Array<{ a: string; b: string; kind: 'similar'; weight: number }> = [];
  for (let i = 0; i < 24; i++) for (const d of [1, 2, 4, 6]) edges.push({ a: `doc:d${i}`, b: `doc:d${(i + d) % 24}`, kind: 'similar', weight: 0.5 });
  net.load(raws, edges, 0.2);
  return net;
}
const meanDist = (net: Network, same: boolean): number => {
  const l = [...net.nodes.values()];
  let s = 0;
  let c = 0;
  for (let i = 0; i < l.length; i++) {
    for (let j = i + 1; j < l.length; j++) {
      if ((l[i]!.ar![0]![0] === l[j]!.ar![0]![0]) !== same) continue;
      s += Math.hypot(l[i]!.x - l[j]!.x, l[i]!.y - l[j]!.y);
      c++;
    }
  }
  return s / c;
};

describe('warm start and grouped physics', () => {
  it('regroup keeps the positions on screen (no random restart) and then forms blocks', () => {
    const net = twoBlocks();
    const before = [...net.nodes.values()].map((n) => [n.x, n.y]);
    net.regroup(true);
    expect([...net.nodes.values()].map((n) => [n.x, n.y])).toEqual(before);
    expect(net.heat).toBe(1);
    const ratioBefore = meanDist(net, true) / meanDist(net, false);
    const plain = twoBlocks();
    plain.warm(0.55);
    for (let i = 0; i < 400 && plain.tick(); i++);
    for (let i = 0; i < 400 && net.tick(); i++);
    for (const n of net.nodes.values()) expect(Number.isFinite(n.x + n.y)).toBe(true);
    expect(meanDist(net, true) / meanDist(net, false)).toBeLessThan(ratioBefore * 0.85);
    // ...and tighter than the same network settled without grouping.
    expect(meanDist(net, true) / meanDist(net, false)).toBeLessThan(meanDist(plain, true) / meanDist(plain, false));
    // Anti-collapse guarantee: the collision pass still holds.
    const l = [...net.nodes.values()];
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) expect(Math.hypot(l[i]!.x - l[j]!.x, l[i]!.y - l[j]!.y)).toBeGreaterThan(10);
  });
  it('with reduced motion it settles at once, still from the current positions', () => {
    const net = twoBlocks();
    const first = net.nodes.get('doc:d0')!;
    const at = [first.x, first.y];
    net.regroup(true, true);
    expect(net.heat).toBe(0);
    expect(Math.hypot(first.x - at[0]!, first.y - at[1]!)).toBeLessThan(400);
  });
  it('a node between two clusters lands between them', () => {
    const net = new Network();
    const raws: RawNode[] = [];
    for (let i = 0; i < 20; i++) raws.push({ kind: 'doc', id: `d${i}`, label: 'x', x: (i % 2 ? 150 : -150) + (i % 5) * 7, y: (i % 3) * 9, ar: [[i % 2, -1, 100]], az: 100 });
    raws.push({ kind: 'doc', id: 'mid', label: 'm', x: 0, y: 200, ar: [[0, -1, 50], [1, -1, 50]], az: 50 });
    net.load(raws, [], 0.5);
    net.regroup(true, true);
    const mid = net.nodes.get('doc:mid')!;
    const others = [...net.nodes.values()].filter((n) => n.id !== 'mid');
    const cx = (k: number) => {
      const l = others.filter((n) => n.ar![0]![0] === k);
      return l.reduce((s, n) => s + n.x, 0) / l.length;
    };
    expect(mid.x).toBeGreaterThan(Math.min(cx(0), cx(1)));
    expect(mid.x).toBeLessThan(Math.max(cx(0), cx(1)));
  });
});

describe('one name per cluster while a family is on (D-491)', () => {
  it('calls each map cluster after the family area that holds most of its points', async () => {
    const { nameByFamily } = await import('./grouping');
    const mk = (id: string) => ({ id, topTerms: ['x', 'y'], centroid: { x: 0, y: 0 } }) as never;
    const map = {
      n: 4,
      levels: [[mk('c0'), mk('c1'), mk('c2')]],
      groups: [{ order: new Uint32Array([0, 1, 2, 3]), starts: new Uint32Array([0, 2, 4, 4, 4]) }],
      areas: [def('Alpha'), def('Beta')],
      ar: [[[0, -1, 100]], [[0, -1, 60], [1, -1, 40]], [[1, -1, 100]], undefined],
      clusterById: new Map(),
    } as never as Parameters<typeof nameByFamily>[0];
    const r = nameByFamily(map);
    expect(r.levels[0]!.map((c) => c.famLabel)).toEqual(['Alpha', 'Beta', undefined]);
    expect(r.clusterById.get('c1')?.famLabel).toBe('Beta');
  });
});

describe('family offer list', () => {
  const fam = (id: string, cov: number, clarity: number, eligible = false): FamilyInfo => ({ id, label: id, count: 5, eligible, reason: { coverage: cov, clarity, values: 4 } });
  const list: FamilyInfo[] = [fam('topic', 0.4, 0.5), fam('level:method', 0.9, 0.9, true), fam('group:none', 0, 0), fam('group:low', 0.1, 0.5), { id: 'auto', label: 'Automatic', count: 0, eligible: true }];
  it('measures the share of papers in a clear value', () => {
    expect(clearShare(fam('topic', 0.4, 0.5))).toBe(20);
    expect(clearShare({})).toBe(0);
  });
  it('keeps partial families choosable and hides those at 0 %', () => {
    expect(offerFamilies(list, 'auto').map((f) => f.id)).toEqual(['topic', 'level:method', 'group:low', 'auto']);
  });
  it('keeps the chosen family even when it is at 0 %', () => {
    expect(offerFamilies(list, 'group:none').map((f) => f.id)).toContain('group:none');
  });
  it('tells a partial family from a good one', () => {
    expect(isPartial(list[0])).toBe(true);
    expect(isPartial(list[1])).toBe(false);
    expect(isPartial(undefined)).toBe(false);
  });
});
