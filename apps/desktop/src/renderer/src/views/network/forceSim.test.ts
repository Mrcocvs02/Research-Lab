import { describe, expect, it } from 'vitest';
import { ALPHA_MIN, Network, REST, restLength, springWeight, type EdgeKind, type RawEdge, type RawNode } from './forceSim';

/** A small seeded generator (mulberry32): the tests do not depend on Math.random. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const raw = (i: number, extra: Partial<RawNode> = {}): RawNode => ({ kind: 'doc', id: `n${i}`, label: `n${i}`, ...extra });
const edge = (i: number, j: number, weight: number, kind: EdgeKind = 'similar'): RawEdge => ({ from: `doc:n${i}`, to: `doc:n${j}`, kind, weight });

/** Nodes at seeded random positions, loaded through `load` (entity networks come placed). */
function build(n: number, edges: RawEdge[], seed = 7, group?: (i: number) => string | undefined): Network {
  const r = rng(seed);
  const net = new Network();
  const nodes = Array.from({ length: n }, (_, i) => {
    const g = group?.(i);
    return raw(i, { x: (r() - 0.5) * REST * Math.sqrt(n), y: (r() - 0.5) * REST * Math.sqrt(n), ...(g !== undefined ? { group: g } : {}) });
  });
  net.load(nodes, edges.map((e) => ({ a: e.from, b: e.to, kind: e.kind, weight: e.weight })), 1);
  return net;
}

function run(net: Network, steps: number): number {
  let ran = 0;
  while (ran < steps && net.tick()) ran++;
  return ran;
}

const list = (net: Network) => [...net.nodes.values()];
const centre = (ns: ReturnType<typeof list>) => ({ x: ns.reduce((s, n) => s + n.x, 0) / ns.length, y: ns.reduce((s, n) => s + n.y, 0) / ns.length });

describe('spring simulation that never collapses (section 18.3.1)', () => {
  it('(a) a complete graph of strong edges keeps every pair apart and spread', () => {
    const n = 50;
    const edges: RawEdge[] = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) edges.push(edge(i, j, 1));
    const net = build(n, edges);
    run(net, 300);
    const ns = list(net);
    let min = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) min = Math.min(min, Math.hypot(ns[i]!.x - ns[j]!.x, ns[i]!.y - ns[j]!.y));
    expect(min).toBeGreaterThanOrEqual(6 + 6 + 2);
    const c = centre(ns);
    expect(Math.max(...ns.map((p) => Math.hypot(p.x - c.x, p.y - c.y)))).toBeGreaterThanOrEqual(2 * REST);
  });

  it('(b) strong edges end shorter than weak ones', () => {
    const r = rng(11);
    const n = 120;
    const edges: RawEdge[] = [];
    for (let k = 0; k < 360; k++) {
      const i = Math.floor(r() * n);
      const j = Math.floor(r() * n);
      if (i !== j) edges.push(edge(i, j, r()));
    }
    const net = build(n, edges);
    run(net, 300);
    const len = (e: { a: string; b: string }) => Math.hypot(net.nodes.get(e.a)!.x - net.nodes.get(e.b)!.x, net.nodes.get(e.a)!.y - net.nodes.get(e.b)!.y);
    const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
    const strong = mean(net.edges.filter((e) => e.weight >= 0.7).map(len));
    const weak = mean(net.edges.filter((e) => e.weight <= 0.3).map(len));
    expect(strong).toBeLessThanOrEqual(weak * 0.75);
  });

  it('(c) a star of 200 leaves does not overlap and stays centred', () => {
    const n = 201;
    const edges: RawEdge[] = [];
    for (let i = 1; i < n; i++) edges.push(edge(0, i, 0.8));
    const net = build(n, edges);
    run(net, 300);
    const ns = list(net);
    let min = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) min = Math.min(min, Math.hypot(ns[i]!.x - ns[j]!.x, ns[i]!.y - ns[j]!.y));
    expect(min).toBeGreaterThanOrEqual(6 + 6);
    const c = centre(ns);
    expect(Math.hypot(ns[0]!.x - c.x, ns[0]!.y - c.y)).toBeLessThan(REST);
  });

  it('(d) two components stay apart without flying away', () => {
    const edges: RawEdge[] = [];
    for (let i = 0; i < 20; i++) for (let j = i + 1; j < 20; j++) if ((i + j) % 3 === 0) edges.push(edge(i, j, 0.6), edge(i + 20, j + 20, 0.6));
    for (let i = 0; i < 19; i++) edges.push(edge(i, i + 1, 0.6), edge(i + 20, i + 21, 0.6));
    const net = build(40, edges);
    run(net, 320);
    const ns = list(net);
    const a = ns.slice(0, 20);
    const b = ns.slice(20);
    const ca = centre(a);
    const cb = centre(b);
    const d = Math.hypot(ca.x - cb.x, ca.y - cb.y);
    expect(d).toBeGreaterThan(12);
    expect(d).toBeLessThan(8 * REST);
  });

  it('(e) stays finite and the temperature reaches ALPHA_MIN within 320 steps', () => {
    const r = rng(3);
    const edges: RawEdge[] = [];
    for (let k = 0; k < 150; k++) edges.push(edge(Math.floor(r() * 60), Math.floor(r() * 60), r()));
    const net = build(60, edges.filter((e) => e.from !== e.to));
    const steps = run(net, 400);
    expect(steps).toBeLessThanOrEqual(320);
    expect(net.alpha === 0 || net.alpha <= ALPHA_MIN).toBe(true);
    for (const n of net.nodes.values()) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
  });

  it('(f) one step with 800 nodes and 6400 edges is measured (never fails the run)', () => {
    const r = rng(5);
    const edges: RawEdge[] = [];
    for (let k = 0; k < 6400; k++) {
      const i = Math.floor(r() * 800);
      const j = Math.floor(r() * 800);
      if (i !== j) edges.push(edge(i, j, r()));
    }
    const net = build(800, edges);
    net.tick();
    const t0 = performance.now();
    net.tick();
    const ms = performance.now() - t0;
    if (ms > 6) console.warn(`forceSim step with 800 nodes and 6400 edges: ${ms.toFixed(1)} ms (budget 6 ms)`);
    expect(Number.isFinite(ms)).toBe(true);
  });

  it('keeps coincident nodes apart and does not move a fixed one', () => {
    const net = new Network();
    net.load([raw(0, { x: 0, y: 0 }), raw(1, { x: 0, y: 0 })], [], 1);
    net.nodes.get('doc:n0')!.fixed = true;
    run(net, 30);
    const [a, b] = list(net);
    expect(a!.x).toBe(0);
    expect(a!.y).toBe(0);
    expect(Math.hypot(b!.x, b!.y)).toBeGreaterThanOrEqual(6 + 6);
  });

  it('pulls a group of three or more together and rests strong edges shorter', () => {
    expect(restLength(1, 6, 6)).toBeLessThan(restLength(0, 6, 6));
    expect(restLength(1, 6, 6)).toBeCloseTo(12 + 0.45 * REST, 6);
    expect(springWeight({ kind: 'tagged', weight: 1 })).toBe(0.3);
    expect(springWeight({ kind: 'similar', weight: 0.8 })).toBe(0.8);
    const net = build(12, [], 9, (i) => (i < 6 ? 'g' : undefined));
    run(net, 300);
    const g = list(net).slice(0, 6);
    const c = centre(g);
    expect(Math.max(...g.map((p) => Math.hypot(p.x - c.x, p.y - c.y)))).toBeLessThan(6 * REST);
  });
});
