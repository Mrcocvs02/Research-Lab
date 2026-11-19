/** What the Map keeps of hulls (D-482): the convex hull, the core of a group and the separation of groups. Nothing is outlined any more. */
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
