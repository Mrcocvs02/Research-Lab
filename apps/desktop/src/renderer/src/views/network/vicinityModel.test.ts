import { describe, expect, it } from 'vitest';
import { Network, REST, RING_STEP, radialPull, type RawEdge, type RawNode } from './forceSim';
import { aboveTau, capEdges, chainOf, ringControls, ringFlags, strongestNew } from './vicinityModel';

const doc = (id: string): RawNode => ({ kind: 'doc', id, label: id });
const edge = (from: string, to: string, weight: number): RawEdge => ({ from: `doc:${from}`, to: `doc:${to}`, kind: 'similar', weight });

describe('radialPull', () => {
  it('pulls inward past the ring radius, outward inside it, and not at all at ring 0', () => {
    const target = 1 * RING_STEP * REST;
    expect(radialPull(target * 2, 0, 1).x).toBeLessThan(0);
    expect(radialPull(target / 2, 0, 1).x).toBeGreaterThan(0);
    expect(radialPull(target, 0, 1).x).toBeCloseTo(0, 6);
    expect(radialPull(50, 50, 0)).toEqual({ x: 0, y: 0 });
    expect(radialPull(0, 0, 1)).toEqual({ x: 0, y: 0 });
  });
  it('the force is 0.08 of the missing distance along the radius', () => {
    const r = radialPull(0, 100, 2);
    expect(r.x).toBeCloseTo(0, 9);
    expect(r.y).toBeCloseTo((2 * RING_STEP * REST - 100) * 0.08, 6);
  });
});

describe('neighbourhood layout', () => {
  it('settles each ring near its target radius around a fixed centre', () => {
    const net = new Network();
    const c = net.seed(doc('c'));
    c.fixed = true;
    net.center = c.key;
    const ids = ['a', 'b', 'c2', 'd', 'e', 'f'];
    const edges = ids.map((i) => edge('c', i, 0.8));
    net.expand(c, ids.map(doc), edges);
    for (const n of net.nodes.values()) if (n !== c) n.ring = 1;
    for (let i = 0; i < 2000 && net.tick(); i++);
    for (const n of net.nodes.values()) {
      if (n === c) continue;
      const d = Math.hypot(n.x - c.x, n.y - c.y);
      expect(d).toBeGreaterThan(RING_STEP * REST * 0.5);
      expect(d).toBeLessThan(RING_STEP * REST * 1.6);
    }
    expect(Math.hypot(c.x, c.y)).toBeLessThan(1e-6);
  });
});

describe('strongestNew', () => {
  it('keeps the strongest papers not already present, with the edges that stay inside', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(doc);
    const edges = [edge('x', 'a', 0.3), edge('x', 'b', 0.9), edge('x', 'c', 0.6), edge('x', 'd', 0.5), edge('b', 'c', 0.4), edge('c', 'd', 0.2)];
    const r = strongestNew(nodes, edges, 'doc:x', new Set(['doc:x', 'doc:d']), 2);
    expect(r.nodes.map((n) => n.id)).toEqual(['b', 'c']);
    expect(r.edges.map((e) => `${e.from}>${e.to}`).sort()).toEqual(['doc:b>doc:c', 'doc:c>doc:d', 'doc:x>doc:b', 'doc:x>doc:c', 'doc:x>doc:d'].sort());
  });
  it('ignores non-paper nodes', () => {
    const r = strongestNew([{ kind: 'tag', id: 't', label: 't' }, doc('a')], [edge('x', 'a', 0.5)], 'doc:x', new Set(), 5);
    expect(r.nodes.map((n) => n.id)).toEqual(['a']);
  });
});

describe('capEdges', () => {
  it('keeps every edge of the centre and at most 4 per other paper', () => {
    const edges = [
      ...['a', 'b', 'c', 'd', 'e', 'f'].map((i) => ({ a: 'doc:c', b: `doc:${i}`, weight: 0.5 })),
      ...['b', 'c', 'd', 'e', 'f'].map((i, k) => ({ a: 'doc:a', b: `doc:${i}`, weight: 0.9 - k * 0.1 })),
    ];
    const out = capEdges(edges, 'doc:c', 4);
    expect(out.filter((e) => e.a === 'doc:c')).toHaveLength(6);
    const deg = new Map<string, number>();
    for (const e of out) for (const k of [e.a, e.b]) deg.set(k, (deg.get(k) ?? 0) + 1);
    for (const [k, v] of deg) if (k !== 'doc:c') expect(v).toBeLessThanOrEqual(4);
    expect(out.length).toBeLessThan(edges.length);
  });
});

describe('chainOf', () => {
  it('walks the steps from the first paper', () => {
    expect(chainOf('a', [{ a: 'a', b: 'b' }, { a: 'c', b: 'b' }, { a: 'c', b: 'd' }])).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('aboveTau', () => {
  it('drops similarity under the threshold and keeps citations and links', () => {
    const edges: RawEdge[] = [edge('a', 'b', 0.4), edge('a', 'c', 0.1), { ...edge('a', 'd', 0.05), kind: 'cites' }];
    expect(aboveTau(edges, 0.2).map((e) => e.to)).toEqual(['doc:b', 'doc:d']);
  });
});

describe('ringControls', () => {
  const base = { ring1: 8, more: false, wide: false, canMore: true, size: 9, busy: false, empty: false };
  it('offers each step, then its opposite once done', () => {
    expect(ringControls(base)).toEqual({ more: 'do', widen: 'do' });
    expect(ringControls({ ...base, more: true, ring1: 16 })).toEqual({ more: 'undo', widen: 'do' });
    expect(ringControls({ ...base, wide: true })).toEqual({ more: 'do', widen: 'undo' });
  });
  it('switches off while busy or empty, and when there is nothing to add', () => {
    expect(ringControls({ ...base, busy: true })).toEqual({ more: 'off', widen: 'off' });
    expect(ringControls({ ...base, canMore: false, ring1: 0 })).toEqual({ more: 'off', widen: 'off' });
    expect(ringControls({ ...base, size: 30 }).widen).toBe('off');
  });
  it('names the open rings for the history', () => {
    expect(ringFlags({ more: false, wide: false })).toBe('');
    expect(ringFlags({ more: true, wide: true })).toBe('mw');
  });
});
