import { describe, expect, it } from 'vitest';
import { bridgePath } from './BridgePath';
import { bridgeGeo, bridgeView } from './bridgeLayer';
import { takeMapBridge, setMapBridge } from './bridgeIntent';
import { degrees, missingMatches, sizedRadius, themeEdges } from './entityExtras';
import type { EntityNode } from './entityTypes';
import { Network } from './forceSim';
import { beginModeFlight, MODE_FLIGHT_MS, stepModeFlight } from './modeFlight';

const node = (id: string, count: number, colorKey: string): EntityNode => ({ id, label: id, count, years: Array.from({ length: 10 }, () => 0), colorKey, group: '' });

describe('mode flight', () => {
  it('starts at the Panorama places and ends where the layout settled, in 300 ms', () => {
    const net = new Network();
    net.load(
      [0, 1, 2, 3].map((i) => ({ kind: 'entity' as const, id: String(i), label: String(i), x: i * 2, y: 0, r: 6 })),
      [{ a: 'entity:0', b: 'entity:1', kind: 'link', weight: 0.8 }],
      1,
    );
    const f = beginModeFlight(net, 0);
    const end = new Map([...net.nodes.values()].map((n) => [n.key, { x: n.x, y: n.y }]));
    expect(stepModeFlight(net, f, 0)).toBe(true);
    for (const n of net.nodes.values()) expect(n.x).toBeCloseTo(f.from.get(n.key)!.x);
    let t = 0;
    while (stepModeFlight(net, f, (t += 16))) expect(t).toBeLessThan(MODE_FLIGHT_MS + 50);
    for (const n of net.nodes.values()) {
      expect(n.x).toBeCloseTo(end.get(n.key)!.x);
      expect(n.y).toBeCloseTo(end.get(n.key)!.y);
    }
  });
});

describe('size by, shared themes, nodes beyond the cap', () => {
  it('sizes by documents, links or equal', () => {
    expect(sizedRadius('equal', 1, 9, 10, 10)).toBe(8);
    expect(sizedRadius('docs', 10, 0, 10, 10)).toBeCloseTo(14);
    expect(sizedRadius('links', 0, 10, 10, 10)).toBeCloseTo(14);
    expect(degrees([{ a: 'x', b: 'y' }, { a: 'x', b: 'z' }]).get('x')).toBe(2);
  });

  it('joins authors of one topic that never wrote together, at most two edges each', () => {
    const nodes = [node('a', 9, 't1'), node('b', 8, 't1'), node('c', 7, 't1'), node('d', 6, 't1'), node('e', 5, 't2')];
    const edges = themeEdges(nodes, [{ a: 'b', b: 'a' }]);
    expect(edges.some((e) => (e.a === 'a' && e.b === 'b') || (e.a === 'b' && e.b === 'a'))).toBe(false);
    expect(edges.every((e) => e.w === 0.15)).toBe(true);
    expect(edges.some((e) => e.a === 'e' || e.b === 'e')).toBe(false);
    expect(edges.length).toBeLessThanOrEqual(2 * nodes.length);
  });

  it('finds matches that are not in the network', () => {
    const all = [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Alpine' }, { id: 'c', label: 'Beta' }];
    expect(missingMatches(all, new Set(['a']), 'alp').map((x) => x.id)).toEqual(['b']);
  });
});

describe('bridge on the map', () => {
  const path = bridgePath({ docId: 'a', title: 'A' }, { key: 'W1', title: 'Work' }, { docId: 'b', title: 'B' });
  const pos = (id: string): [number, number] | null => (id === 'a' ? [0, 0] : id === 'b' ? [10, 0] : null);

  it('puts the work off the line between the two documents', () => {
    const g = bridgeGeo(path, pos)!;
    expect(g.g[0]).toBeCloseTo(5);
    expect(Math.abs(g.g[1])).toBeGreaterThan(0);
    expect(bridgeGeo(path, () => null)).toBeNull();
  });

  it('shows the three points in the view', () => {
    const v = bridgeView(bridgeGeo(path, pos)!, 800, 600);
    expect(v.k).toBeGreaterThan(0);
    expect(v.x).toBeCloseTo(5);
  });

  it('is handed over once', () => {
    setMapBridge(path);
    expect(takeMapBridge()).toBe(path);
    expect(takeMapBridge()).toBeNull();
  });
});
