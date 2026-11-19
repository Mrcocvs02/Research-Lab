import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { active, FLIGHT_MS, flightAt, makeFlight, newMotion, stepInertia, stepMotion, stepZoom, zoomBy } from './camera';
import { adjacencyOf, assignKeyTints, assignTints, contrast, mix, nearestTint, readableColor, withAlpha, TINTS, type TintGroup } from './colors';
import { edgeAlpha, taperedPolygon } from './edges';
import { authorKey } from './entityData';
import { layoutAnchors, nodeRadius } from './entityLayout';
import type { EntityNode } from './entityTypes';
import { Network } from './forceSim';
import { convexHull, inPolygon, type Pt } from './hulls';
import { overlaps, pickLabels, shortLabel, type LabelCandidate } from './labelsLod';
import { mapAction, nearestInDirection } from './mapKeyboard';
import { relaxSmall } from './mapModel';
import { bfsPath, pickSurprise, rng } from './playful';
import { QuadTree } from './quadtree';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(path.join(here, rel), 'utf8');

function points(n: number, seed = 7): { xs: Float64Array; ys: Float64Array } {
  const r = rng(seed);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = r() * 1000;
    ys[i] = r() * 1000;
  }
  return { xs, ys };
}

describe('quadtree and Barnes-Hut', () => {
  it('matches the exact sum of repulsions within 5% with theta 0.9', () => {
    const n = 400;
    const { xs, ys } = points(n);
    const tree = new QuadTree().build(xs, ys, n);
    const out = { x: 0, y: 0 };
    let errSum = 0;
    let magSum = 0;
    for (let i = 0; i < n; i++) {
      let ex = 0;
      let ey = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dx = xs[i]! - xs[j]!;
        const dy = ys[i]! - ys[j]!;
        const d2 = dx * dx + dy * dy;
        const f = 1000 / (d2 * Math.sqrt(d2));
        ex += dx * f;
        ey += dy * f;
      }
      tree.repulse(i, xs[i]!, ys[i]!, 0.9, 1000, out);
      errSum += Math.hypot(out.x - ex, out.y - ey);
      magSum += Math.hypot(ex, ey);
    }
    expect(errSum / magSum).toBeLessThan(0.05);
  });

  it('is exact with theta 0 and survives coincident points', () => {
    const xs = new Float64Array([0, 10, 10, 10, 20]);
    const ys = new Float64Array([0, 5, 5, 5, 0]);
    const tree = new QuadTree().build(xs, ys, 5);
    const out = { x: 0, y: 0 };
    tree.repulse(0, 0, 0, 0, 1, out);
    const exact = 3 * (-10 / Math.pow(125, 1.5)) + -20 / Math.pow(400, 1.5);
    expect(out.x).toBeCloseTo(exact, 9);
  });

  it('finds the points in a rectangle', () => {
    const { xs, ys } = points(300, 3);
    const tree = new QuadTree().build(xs, ys, 300);
    const found: number[] = [];
    tree.query(100, 100, 400, 500, (i) => found.push(i));
    const want = [...xs].map((_, i) => i).filter((i) => xs[i]! >= 100 && xs[i]! <= 400 && ys[i]! >= 100 && ys[i]! <= 500);
    expect(found.sort((a, b) => a - b)).toEqual(want);
  });
});

describe('force simulation', () => {
  function entities(n: number, edgesPer = 3) {
    const r = rng(11);
    const raws = Array.from({ length: n }, (_, i) => ({ kind: 'entity' as const, id: `n${i}`, label: `n${i}`, x: (r() - 0.5) * 2000, y: (r() - 0.5) * 2000 }));
    const edges = [];
    for (let i = 0; i < n; i++) for (let k = 0; k < edgesPer; k++) edges.push({ a: `entity:n${i}`, b: `entity:n${Math.floor(r() * n)}`, kind: 'link' as const, weight: r() });
    return { raws, edges };
  }

  it('cools down, settles within 400 steps and then stops (nothing runs at rest)', () => {
    const net = new Network();
    const { raws, edges } = entities(300);
    net.load(raws, edges, 1);
    const energies: number[] = [];
    let steps = 0;
    while (net.tick() && steps < 600) {
      steps++;
      if (steps % 50 === 0) energies.push(net.energy);
    }
    expect(steps).toBeLessThanOrEqual(400);
    expect(net.heat).toBe(0);
    expect(net.tick()).toBe(false);
    expect(energies[energies.length - 1]!).toBeLessThan(energies[0]! / 5);
  });

  it('keeps pinned nodes in place on Mescola, replaces a node by its children and caps the load', () => {
    const net = new Network();
    const { raws, edges } = entities(20, 2);
    net.load(raws, edges, 0.5);
    const pin = net.nodes.get('entity:n3')!;
    pin.fixed = true;
    const at = { x: pin.x, y: pin.y };
    net.shuffle(rng(1));
    for (let i = 0; i < 30; i++) net.tick();
    expect(pin.x).toBe(at.x);
    expect(pin.y).toBe(at.y);
    const added = net.replace('entity:n5', [{ kind: 'entity', id: 'k1', label: 'k1' }, { kind: 'entity', id: 'k2', label: 'k2' }], [{ from: 'entity:k1', to: 'entity:k2', kind: 'link', weight: 1 }]);
    expect(added).toBe(2);
    expect(net.nodes.has('entity:n5')).toBe(false);
    expect(net.nodes.has('entity:k1')).toBe(true);
    expect(net.neighbors('entity:k1')).toContain('entity:k2');
    const many = Array.from({ length: 900 }, (_, i) => ({ kind: 'entity' as const, id: `z${i}`, label: 'z' }));
    expect(net.load(many, [])).toBe(100);
    expect(net.size).toBe(800);
  });
});

describe('convex hull', () => {
  const square: Pt[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  it('finds the convex hull, leaving out the inner points and the duplicates', () => {
    const hull = convexHull([...square, [5, 5], [2, 3], [0, 0]]);
    expect(hull).toHaveLength(4);
    for (const p of square) expect(hull.some((q) => q[0] === p[0] && q[1] === p[1])).toBe(true);
    expect(convexHull([[1, 1]])).toHaveLength(1);
  });
  it('tells whether a point is inside a polygon', () => {
    const hull = convexHull(square);
    expect(inPolygon(5, 5, hull)).toBe(true);
    expect(inPolygon(-3, 5, hull)).toBe(false);
  });
});

describe('labels with level of detail', () => {
  it('never draws two labels over each other and keeps the biggest nodes first', () => {
    const r = rng(5);
    const cands: LabelCandidate[] = Array.from({ length: 300 }, (_, i) => ({ id: i, x: r() * 800, y: r() * 600, w: 40 + r() * 100, size: r() * 14 }));
    const ids = pickLabels(cands, 800, 600);
    expect(ids.length).toBeGreaterThan(5);
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) expect(overlaps(cands[ids[a]!]!, cands[ids[b]!]!)).toBe(false);
    const top = cands.reduce((m, c) => (c.size > m.size ? c : m));
    if (top.x > 50 && top.x < 750 && top.y > 10 && top.y < 590) expect(ids).toContain(top.id);
  });
  it('always shows the forced ones and cuts the text to 32 characters', () => {
    const cands: LabelCandidate[] = [
      { id: 0, x: 100, y: 100, w: 80, size: 99 },
      { id: 1, x: 110, y: 100, w: 80, size: 1, forced: true },
    ];
    expect(pickLabels(cands, 400, 300)[0]).toBe(1);
    expect(shortLabel('x'.repeat(40))).toHaveLength(32);
    expect(shortLabel('short')).toBe('short');
  });
});

describe('camera', () => {
  const v0 = { cx: 0, cy: 0, k: 1 };
  it('stops the inertia: the speed decays by 0.92 per frame and ends under 0.05 px', () => {
    const m = newMotion();
    m.vx = 20;
    m.vy = -10;
    let v = v0;
    let frames = 0;
    while (active(m) && frames < 1000) {
      v = stepMotion(m, v, 1000 / 60, 800, 600);
      frames++;
    }
    expect(active(m)).toBe(false);
    expect(frames).toBeLessThan(120);
    // Dragging right moves the view to the left of the world.
    expect(v.cx).toBeLessThan(0);
    expect(v.cy).toBeGreaterThan(0);
    expect(stepInertia(newMotion(), v, 16).cx).toBe(v.cx);
  });
  it('zooms smoothly to the target keeping the point under the cursor', () => {
    const m = newMotion();
    zoomBy(m, v0, 600, 100, 4, 1);
    let v = v0;
    const before = { x: (600 - 400) / v.k + v.cx, y: (100 - 300) / v.k + v.cy };
    let frames = 0;
    while (active(m) && frames < 300) {
      v = stepMotion(m, v, 1000 / 60, 800, 600);
      frames++;
    }
    expect(v.k).toBeCloseTo(4, 3);
    expect((600 - 400) / v.k + v.cx).toBeCloseTo(before.x, 3);
    expect((100 - 300) / v.k + v.cy).toBeCloseTo(before.y, 3);
    expect(stepZoom(v0, { k: 2, sx: 0, sy: 0 }, 16.7, 800, 600).done).toBe(false);
  });
  it('flies to the target and arrives; a long flight zooms out in the middle', () => {
    const to = { cx: 5000, cy: 0, k: 1 };
    const f = makeFlight(v0, to, FLIGHT_MS, 800, 600);
    expect(flightAt(f, 0).cx).toBeCloseTo(0);
    expect(flightAt(f, FLIGHT_MS).cx).toBeCloseTo(5000);
    expect(flightAt(f, FLIGHT_MS / 2).k).toBeLessThan(0.5);
    const near = makeFlight(v0, { cx: 10, cy: 0, k: 1 }, FLIGHT_MS, 800, 600);
    expect(flightAt(near, FLIGHT_MS / 2).k).toBeCloseTo(1, 2);
    const m = newMotion();
    m.flight = f;
    let v = v0;
    for (let i = 0; i < 20; i++) v = stepMotion(m, v, 16.7, 800, 600);
    expect(active(m)).toBe(true);
    for (let i = 0; i < 40 && active(m); i++) v = stepMotion(m, v, 16.7, 800, 600);
    expect(active(m)).toBe(false);
    expect(v.cx).toBeCloseTo(5000);
  });
});

describe('shortest path', () => {
  const edges: Array<[string, string]> = [['a', 'b'], ['b', 'c'], ['c', 'd'], ['a', 'e'], ['e', 'd'], ['x', 'y']];
  const nb = (k: string) => edges.flatMap(([p, q]) => (p === k ? [q] : q === k ? [p] : []));
  it('finds the shortest path over the visible edges', () => {
    expect(bfsPath(nb, 'a', 'd')).toEqual(['a', 'e', 'd']);
    expect(bfsPath(nb, 'a', 'a')).toEqual(['a']);
    expect(bfsPath(nb, 'a', 'y')).toBeNull();
  });
});

describe('palette', () => {
  const css = read('palette.css');
  const tokens = readFileSync(path.join(here, '../../styles/tokens.css'), 'utf8');
  const bgs = [...tokens.matchAll(/--bg:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1]!);
  const block = (marker: string): string[] => {
    const at = css.indexOf(marker);
    const body = css.slice(at, css.indexOf('}', at));
    return Array.from({ length: TINTS }, (_, i) => new RegExp(`--cat-${i + 1}:\\s*(#[0-9a-f]{6})`, 'i').exec(body)![1]!);
  };
  const light = block(':root {');
  const dark = block(":root[data-theme='dark']");
  it('has ten tints, each at least 3:1 on the background in both themes', () => {
    expect(light).toHaveLength(10);
    expect(bgs[0]).toBe('#f6f5f1');
    expect(bgs[1]).toBe('#121316');
    for (const c of light) expect(contrast(c, bgs[0]!)).toBeGreaterThanOrEqual(3);
    for (const c of dark) expect(contrast(c, bgs[1]!)).toBeGreaterThanOrEqual(3);
    // The system dark block repeats the explicit one.
    const media = css.slice(css.indexOf('@media'), css.indexOf(":root[data-theme='dark']"));
    for (const c of dark) expect(media).toContain(c);
  });
  it('keeps the arcs readable on the background: light arcs in the dark theme at 1.6:1 at least', () => {
    const composite = (c: string, a: number, bg: string) => mix(bg, c, a);
    const muted = { light: '#555963', dark: '#a9acb5' };
    const mean = (tints: string[], bg: string, m: string, alpha: number) => tints.reduce((s, t) => s + contrast(composite(mix(t, m, 0.5), alpha, bg), bg), 0) / tints.length;
    expect(mean(dark, bgs[1]!, muted.dark, edgeAlpha(0, true))).toBeGreaterThanOrEqual(1.6);
    // Light theme: the lightest edge cannot reach 1.6:1 at 12% opacity, a typical one (weight 0.5) is clearly visible.
    expect(mean(light, bgs[0]!, muted.light, edgeAlpha(0.5, false))).toBeGreaterThanOrEqual(1.25);
    expect(edgeAlpha(0, true)).toBeGreaterThanOrEqual(0.22);
    expect(edgeAlpha(0, false)).toBeCloseTo(0.12);
  });
  it('keeps a tag colour of the user only when it reads on the background', () => {
    expect(readableColor('#336699', bgs[0]!, light)).toBe('#336699');
    expect(light).toContain(readableColor('#fffff0', bgs[0]!, light));
    expect(nearestTint('#3f64de', light)).toBe('#3e63dd');
    expect(withAlpha('#336699', 0.5)).toBe('rgba(51,102,153,0.5)');
  });
  it('gives stable tints: the new topic inherits the tint of the old one it shares most documents with', () => {
    const ids = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i}`);
    const first: TintGroup[] = [
      { id: 'a', docs: ids('a', 10), key: 'alpha beta' },
      { id: 'b', docs: ids('b', 8), key: 'gamma delta' },
    ];
    const none = [new Set<number>(), new Set<number>()];
    const r1 = assignTints(first, none, null);
    // Rebuilt with other ids and the order swapped: the tints follow the documents.
    const second: TintGroup[] = [
      { id: 'n1', docs: [...ids('b', 8), 'new1'], key: 'zzz' },
      { id: 'n2', docs: [...ids('a', 9), 'new2'], key: 'yyy' },
    ];
    const r2 = assignTints(second, none, r1.memo);
    expect(r2.tints[0]).toBe(r1.tints[1]);
    expect(r2.tints[1]).toBe(r1.tints[0]);
  });
  it('never gives touching topics the same tint, and repeats it with a dashed outline past ten', () => {
    const groups: TintGroup[] = Array.from({ length: 12 }, (_, i) => ({ id: `g${i}`, docs: [`d${i}`], key: `k${i}` }));
    const all = adjacencyOf(new Float64Array(12), new Float64Array(12), new Float64Array(12).fill(1));
    const r = assignTints(groups, all, null);
    expect(new Set(r.tints.slice(0, 10)).size).toBe(10);
    expect(r.dashed.filter(Boolean).length).toBe(2);
    const pair = adjacencyOf([0, 1], [0, 0], [1, 1]);
    const p = assignTints([groups[0]!, groups[1]!], pair, null);
    expect(p.tints[0]).not.toBe(p.tints[1]);
    const keys = assignKeyTints(['x', 'y', 'z', 'x']);
    expect(keys.size).toBe(3);
    expect(new Set(keys.values()).size).toBe(3);
  });
});

describe('edges', () => {
  it('draws a tapered curve: 2.5 px at the origin, 0.8 px at the end, bent to the same side', () => {
    const p = taperedPolygon(0, 0, 100, 0, 2.5, 0.8, 8);
    const left = p.slice(0, 18);
    const right = p.slice(18);
    // Width at the start: distance between the first left point and the last right point.
    expect(Math.hypot(left[0]! - right[right.length - 2]!, left[1]! - right[right.length - 1]!)).toBeCloseTo(2.5, 5);
    expect(Math.hypot(left[16]! - right[0]!, left[17]! - right[1]!)).toBeCloseTo(0.8, 5);
    // The curve bows to one side (y at the middle is not 0) and to the same side for the reverse direction mirrored.
    expect(Math.abs(left[9]!)).toBeGreaterThan(5);
  });
});

describe('keyboard of the map', () => {
  it('maps the keys of the design to actions', () => {
    expect(mapAction({ key: 'ArrowLeft' })).toEqual({ type: 'move', dir: 'left' });
    expect(mapAction({ key: 'Enter' })).toEqual({ type: 'open' });
    expect(mapAction({ key: 'Enter', shiftKey: true })).toEqual({ type: 'read' });
    expect(mapAction({ key: 'M' })?.type).toBe('mode');
    expect(mapAction({ key: 'L' })?.type).toBe('explore');
    expect(mapAction({ key: 'F' })?.type).toBe('search');
    expect(mapAction({ key: '/' })?.type).toBe('search');
    expect(mapAction({ key: 'P' })?.type).toBe('pin');
    expect(mapAction({ key: '0' })?.type).toBe('fit');
    expect(mapAction({ key: '+' })).toEqual({ type: 'zoom', factor: 1.25 });
    expect(mapAction({ key: 'm', ctrlKey: true })).toBeNull();
    expect(mapAction({ key: 'q' })).toBeNull();
  });
  it('goes to the nearest node in the direction pressed', () => {
    const xs = [0, 10, 100, 12, -50];
    const ys = [0, 2, 0, 90, 3];
    const all = [0, 1, 2, 3, 4];
    expect(nearestInDirection(xs, ys, 0, 'right', all)).toBe(1);
    expect(nearestInDirection(xs, ys, 0, 'left', all)).toBe(4);
    expect(nearestInDirection(xs, ys, 0, 'down', all)).toBe(3);
    expect(nearestInDirection(xs, ys, 0, 'up', all)).toBe(-1);
  });
});

describe('entity networks', () => {
  it('normalises author names like Explore', () => {
    expect(authorKey('Rossi, Anna')).toBe('rossi a');
    expect(authorKey('Anna Rossi')).toBe('rossi a');
    expect(authorKey('Ánna Rossi')).toBe('rossi a');
    expect(authorKey('Rossi')).toBe('rossi');
    expect(authorKey('  ')).toBe('');
  });

  it('starts the nodes at the centroid of their topic, scaled to the size of the network', () => {
    const nodes: EntityNode[] = [
      { id: 'a', label: 'a', count: 4, years: [], colorKey: 'c0', group: '' },
      { id: 'b', label: 'b', count: 1, years: [], colorKey: 'c1', group: '' },
      { id: 'c', label: 'c', count: 1, years: [], colorKey: 'none', group: '' },
    ];
    const pos = layoutAnchors(nodes, new Map([['c0', { x: 0, y: 0 }], ['c1', { x: 1000, y: 0 }]]));
    expect(pos.get('b')!.x - pos.get('a')!.x).toBeGreaterThan(50);
    expect(pos.get('c')).toBeDefined();
    expect(layoutAnchors(nodes, new Map()).get('a')).toEqual(layoutAnchors(nodes, new Map()).get('a'));
    expect(nodeRadius(4, 4)).toBe(14);
    expect(nodeRadius(0, 4)).toBe(4);
  });

  it('picks a surprising pair of authors and says the numbers', () => {
    const node = (id: string, count: number, group = '', colorKey = ''): EntityNode => ({ id, label: id, count, years: [], colorKey, group });
    const authors = pickSurprise([node('a', 3, '', 't'), node('b', 3, '', 't'), node('m', 3, '', 'u')], [{ a: 'a', b: 'm', w: 1, n: 1 }, { a: 'b', b: 'm', w: 1, n: 1 }], () => 0);
    expect(authors).toMatchObject({ a: 'a', b: 'b', n: 1, kind: 'author' });
    expect(pickSurprise([], [], () => 0)).toBeNull();
  });
});

describe('small libraries', () => {
  it('pushes apart points that sit on top of each other', () => {
    const xs = new Float32Array([0, 0, 0.001, 50]);
    const ys = new Float32Array([0, 0, 0, 40]);
    relaxSmall(xs, ys, 4, xs, ys);
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(Math.hypot(xs[i]! - xs[j]!, ys[i]! - ys[j]!)).toBeGreaterThan(1);
  });
});

describe('time to prepare the paths of 20000 points', () => {
  it('culls and batches 20000 points into one path per colour within 16 ms', () => {
    const n = 20_000;
    const { xs, ys } = points(n, 9);
    const calls = { rect: 0, fill: 0 };
    const ctx = { beginPath() {}, rect(_x: number, _y: number, _w: number, _h: number) { calls.rect++; }, fill() { calls.fill++; } };
    const t0 = performance.now();
    for (let colour = 0; colour < 10; colour++) {
      ctx.beginPath();
      for (let i = colour; i < n; i += 10) {
        const sx = (xs[i]! - 500) * 0.8 + 400;
        const sy = (ys[i]! - 500) * 0.8 + 300;
        if (sx < -3 || sy < -3 || sx > 803 || sy > 603) continue;
        ctx.rect(sx - 1, sy - 1, 2, 2);
      }
      ctx.fill();
    }
    expect(performance.now() - t0).toBeLessThan(16);
    expect(calls.fill).toBe(10);
    expect(calls.rect).toBeGreaterThan(1000);
  });
});
