/** Hulls of the topics (§4.20): convex hull, widened with rounded corners by two Chaikin passes; a lone point is a circle and two points a capsule (D-379). */
export type Pt = readonly [number, number];

const cross = (o: Pt, a: Pt, b: Pt): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Convex hull of the points (Andrew's monotone chain), counter-clockwise in a y-up system (clockwise on screen); fewer than 3 points come back as they are. */
export function convexHull(points: ReadonlyArray<Pt>): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const uniq = p.filter((q, i) => i === 0 || q[0] !== p[i - 1]![0] || q[1] !== p[i - 1]![1]);
  if (uniq.length < 3) return uniq;
  const lower: Pt[] = [];
  for (const q of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const q = uniq[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/** The hull of a flat `[x, y, x, y...]` list taken at the given point indices (world units, once per map). */
export function hullOfIndices(xs: ArrayLike<number>, ys: ArrayLike<number>, idx: ArrayLike<number>, from = 0, to = idx.length): Pt[] {
  const pts: Pt[] = [];
  for (let j = from; j < to; j++) pts.push([xs[idx[j]!]!, ys[idx[j]!]!]);
  return convexHull(pts);
}

/** The polygon grown outward by `r` (each vertex moves along the bisector of its two edge normals). */
export function growPolygon(poly: ReadonlyArray<Pt>, r: number): Pt[] {
  const n = poly.length;
  if (n < 3) return [...poly];
  // Orientation: positive area = counter-clockwise in the maths sense; the outward normal flips with it.
  let area = 0;
  for (let i = 0; i < n; i++) area += poly[i]![0] * poly[(i + 1) % n]![1] - poly[(i + 1) % n]![0] * poly[i]![1];
  const s = area >= 0 ? 1 : -1;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n]!;
    const b = poly[i]!;
    const c = poly[(i + 1) % n]!;
    const n1 = norm(b[1] - a[1], -(b[0] - a[0]));
    const n2 = norm(c[1] - b[1], -(c[0] - b[0]));
    let nx = (n1[0] + n2[0]) * s;
    let ny = (n1[1] + n2[1]) * s;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    // Miter, limited so that a sharp corner does not shoot out.
    const cosHalf = Math.max((n1[0] * s * nx + n1[1] * s * ny) || 1, 0.5);
    out.push([b[0] + (nx * r) / cosHalf, b[1] + (ny * r) / cosHalf]);
  }
  return out;
}

function norm(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

/** Chaikin corner cutting of a closed polygon: each pass replaces every edge by points at 1/4 and 3/4. */
export function chaikin(poly: ReadonlyArray<Pt>, passes = 2): Pt[] {
  let p: Pt[] = [...poly];
  if (p.length < 3) return p;
  for (let k = 0; k < passes; k++) {
    const q: Pt[] = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i]!;
      const b = p[(i + 1) % p.length]!;
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = q;
  }
  return p;
}

const arc = (cx: number, cy: number, r: number, from: number, to: number, steps: number): Pt[] => Array.from({ length: steps + 1 }, (_, i) => [cx + Math.cos(from + ((to - from) * i) / steps) * r, cy + Math.sin(from + ((to - from) * i) / steps) * r] as Pt);

/** A circle of 24 px (radius 12) around a lone point. */
export const circleAt = (x: number, y: number, r = 12, steps = 20): Pt[] => arc(x, y, r, 0, Math.PI * 2, steps).slice(0, -1);

/** A capsule around two points (a stadium of radius 12 px). */
export function capsule(a: Pt, b: Pt, r = 12): Pt[] {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  return [...arc(b[0], b[1], r, ang - Math.PI / 2, ang + Math.PI / 2, 8), ...arc(a[0], a[1], r, ang + Math.PI / 2, ang + (Math.PI * 3) / 2, 8)];
}

/**
 * The outline to draw for the hull (screen points) of a group: 1 point = circle, 2 = capsule, more = the hull grown by `pad`
 * (16 px) and rounded with two Chaikin passes.
 */
export function hullShape(hull: ReadonlyArray<Pt>, pad = 16): Pt[] {
  if (hull.length === 0) return [];
  if (hull.length === 1) return circleAt(hull[0]![0], hull[0]![1]);
  if (hull.length === 2) return capsule(hull[0]!, hull[1]!);
  return chaikin(growPolygon(hull, pad), 2);
}

export const centroidOf = (poly: ReadonlyArray<Pt>): Pt => {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p[0];
    y += p[1];
  }
  return [x / Math.max(poly.length, 1), y / Math.max(poly.length, 1)];
};

/** Point in polygon (ray casting): the double click on a hull. */
export function inPolygon(x: number, y: number, poly: ReadonlyArray<Pt>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** The 80th percentile of the distances of the points to their centroid: the radius of the core of a group (the far ones do not count). */
export function coreRadius(xs: ArrayLike<number>, ys: ArrayLike<number>, idx: ArrayLike<number>, from: number, to: number): { cx: number; cy: number; r: number } {
  const m = to - from;
  if (m <= 0) return { cx: 0, cy: 0, r: 0 };
  let cx = 0;
  let cy = 0;
  for (let j = from; j < to; j++) {
    cx += xs[idx[j]!]!;
    cy += ys[idx[j]!]!;
  }
  cx /= m;
  cy /= m;
  const d = new Float64Array(m);
  for (let j = from; j < to; j++) d[j - from] = Math.hypot(xs[idx[j]!]! - cx, ys[idx[j]!]! - cy);
  d.sort();
  return { cx, cy, r: d[Math.min(m - 1, Math.floor(0.8 * (m - 1)))]! };
}

/** The hull of the core of a group (points within the 80th percentile distance): the far points never inflate it. */
export function coreHull(xs: ArrayLike<number>, ys: ArrayLike<number>, idx: ArrayLike<number>, from: number, to: number): Pt[] {
  if (to - from <= 4) return hullOfIndices(xs, ys, idx, from, to);
  const { cx, cy, r } = coreRadius(xs, ys, idx, from, to);
  const pts: Pt[] = [];
  for (let j = from; j < to; j++) {
    const x = xs[idx[j]!]!;
    const y = ys[idx[j]!]!;
    if (Math.hypot(x - cx, y - cy) <= r + 1e-9) pts.push([x, y]);
  }
  return convexHull(pts);
}

/**
 * Pushes the groups apart (§4.22): every group is a circle (centroid, core radius); 60 steps of repulsion keep a gap between
 * circles and move the points of a group rigidly. `gap` in world units. Done once per layout; the arrays are changed in place.
 */
export function separateClusters(xs: Float32Array, ys: Float32Array, order: ArrayLike<number>, starts: ArrayLike<number>, groups: number, gap: number, steps = 60): void {
  if (groups < 2 || groups > 600) return;
  const c = Array.from({ length: groups }, (_, s) => coreRadius(xs, ys, order, starts[s]!, starts[s + 1]!));
  const ox = new Float64Array(groups);
  const oy = new Float64Array(groups);
  const live = c.map((g, s) => starts[s + 1]! > starts[s]! && g.r >= 0);
  for (let step = 0; step < steps; step++) {
    let moved = false;
    for (let a = 0; a < groups; a++) {
      if (!live[a]) continue;
      for (let b = a + 1; b < groups; b++) {
        if (!live[b]) continue;
        let dx = c[b]!.cx + ox[b]! - (c[a]!.cx + ox[a]!);
        let dy = c[b]!.cy + oy[b]! - (c[a]!.cy + oy[a]!);
        let d = Math.hypot(dx, dy);
        const need = c[a]!.r + c[b]!.r + gap;
        if (d >= need) continue;
        if (d < 1e-9) {
          dx = Math.cos(a * 2.4 + b);
          dy = Math.sin(a * 2.4 + b);
          d = 1;
        }
        // The smaller group moves more: the big ones keep the layout.
        const wa = c[b]!.r + 1;
        const wb = c[a]!.r + 1;
        const push = (need - d) / d / (wa + wb);
        ox[a]! -= dx * push * wa;
        oy[a]! -= dy * push * wa;
        ox[b]! += dx * push * wb;
        oy[b]! += dy * push * wb;
        moved = true;
      }
    }
    if (!moved) break;
  }
  for (let s = 0; s < groups; s++) {
    if (ox[s] === 0 && oy[s] === 0) continue;
    for (let j = starts[s]!; j < starts[s + 1]!; j++) {
      xs[order[j]!]! += ox[s]!;
      ys[order[j]!]! += oy[s]!;
    }
  }
}

/** Which groups are filled at rest (§4.22): not touching another core and among the `max` biggest. `circles` are the cores in world units. */
export function restingFill(circles: ReadonlyArray<{ cx: number; cy: number; r: number }>, sizes: ReadonlyArray<number>, max = 8): boolean[] {
  const ok = circles.map((a, i) => circles.every((b, j) => i === j || Math.hypot(a.cx - b.cx, a.cy - b.cy) >= a.r + b.r));
  const top = [...sizes.keys()].sort((a, b) => sizes[b]! - sizes[a]! || a - b).slice(0, max);
  const set = new Set(top);
  return ok.map((v, i) => v && set.has(i));
}
