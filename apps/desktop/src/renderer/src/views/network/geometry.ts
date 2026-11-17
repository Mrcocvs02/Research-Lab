/** Pure helpers of the canvas views: view transform, spatial grid, colours. No DOM, so they are unit-tested. */

/** World to screen: `sx = (x - cx) * k + width / 2`. */
export interface View {
  cx: number;
  cy: number;
  k: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const K_MIN = 1e-6;
export const K_MAX = 1e6;

export function boundsOf(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return n === 0 ? { minX: -1, minY: -1, maxX: 1, maxY: 1 } : { minX, minY, maxX, maxY };
}

export const clampK = (k: number, base: number): number => Math.min(Math.max(k, Math.max(base / 4, K_MIN)), Math.min(base * 4000, K_MAX));

/** The view that shows `b` entirely with a margin in pixels. */
export function fitView(b: Bounds, width: number, height: number, margin = 32): View {
  const w = Math.max(b.maxX - b.minX, 1e-9);
  const h = Math.max(b.maxY - b.minY, 1e-9);
  const k = Math.min(Math.max(width - 2 * margin, 10) / w, Math.max(height - 2 * margin, 10) / h);
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, k: Math.min(Math.max(k, K_MIN), K_MAX) };
}

/** Zooms by `factor` keeping the world point under the screen point (sx, sy) in place. `base` is the fitted scale (limits). */
export function zoomAt(v: View, sx: number, sy: number, factor: number, width: number, height: number, base: number): View {
  const k = clampK(v.k * factor, base);
  const wx = v.cx + (sx - width / 2) / v.k;
  const wy = v.cy + (sy - height / 2) / v.k;
  return { k, cx: wx - (sx - width / 2) / k, cy: wy - (sy - height / 2) / k };
}

export const toScreenX = (v: View, x: number, width: number): number => (x - v.cx) * v.k + width / 2;
export const toScreenY = (v: View, y: number, height: number): number => (y - v.cy) * v.k + height / 2;
export const toWorldX = (v: View, sx: number, width: number): number => v.cx + (sx - width / 2) / v.k;
export const toWorldY = (v: View, sy: number, height: number): number => v.cy + (sy - height / 2) / v.k;

/**
 * Uniform grid over the points (counting sort into flat arrays: no object per point), for hit testing and culling
 * of up to tens of thousands of points.
 */
export class PointGrid {
  private readonly start: Int32Array;
  private readonly items: Int32Array;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cell: number;
  private readonly minX: number;
  private readonly minY: number;

  constructor(
    private readonly xs: ArrayLike<number>,
    private readonly ys: ArrayLike<number>,
    n: number,
    b: Bounds,
  ) {
    const w = Math.max(b.maxX - b.minX, 1e-9);
    const h = Math.max(b.maxY - b.minY, 1e-9);
    // About 4 points per cell on average; the grid is capped so that a degenerate layout cannot allocate a lot.
    const cells = Math.min(Math.max(n / 4, 1), 250_000);
    let cell = Math.sqrt((w * h) / cells) || Math.max(w, h);
    cell = Math.max(cell, Math.max(w, h) / 1500);
    this.cell = cell;
    this.cols = Math.floor(w / cell) + 1;
    this.rows = Math.floor(h / cell) + 1;
    this.minX = b.minX;
    this.minY = b.minY;
    const total = this.cols * this.rows;
    const start = new Int32Array(total + 1);
    const cellOf = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const c = this.cellIndex(xs[i]!, ys[i]!);
      cellOf[i] = c;
      start[c + 1]!++;
    }
    for (let c = 0; c < total; c++) start[c + 1]! += start[c]!;
    this.start = start;
    const fill = start.slice(0, total);
    this.items = new Int32Array(n);
    for (let i = 0; i < n; i++) this.items[fill[cellOf[i]!]!++] = i;
  }

  private cellIndex(x: number, y: number): number {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / this.cell)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.minY) / this.cell)));
    return cy * this.cols + cx;
  }

  /** Index of the point nearest to (x, y) within `radius` (world units), or -1. */
  nearest(x: number, y: number, radius: number): number {
    const c0 = Math.max(0, Math.floor((x - radius - this.minX) / this.cell));
    const c1 = Math.min(this.cols - 1, Math.floor((x + radius - this.minX) / this.cell));
    const r0 = Math.max(0, Math.floor((y - radius - this.minY) / this.cell));
    const r1 = Math.min(this.rows - 1, Math.floor((y + radius - this.minY) / this.cell));
    let best = -1;
    let bestD = radius * radius;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = r * this.cols + c;
        for (let j = this.start[cell]!; j < this.start[cell + 1]!; j++) {
          const i = this.items[j]!;
          const dx = this.xs[i]! - x;
          const dy = this.ys[i]! - y;
          const d = dx * dx + dy * dy;
          if (d <= bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    }
    return best;
  }

  /** Calls `fn(i)` for every point in the cells that touch the rectangle (world units): culling. */
  forEachIn(x0: number, y0: number, x1: number, y1: number, fn: (i: number) => void): void {
    const c0 = Math.max(0, Math.floor((x0 - this.minX) / this.cell));
    const c1 = Math.min(this.cols - 1, Math.floor((x1 - this.minX) / this.cell));
    const r0 = Math.max(0, Math.floor((y0 - this.minY) / this.cell));
    const r1 = Math.min(this.rows - 1, Math.floor((y1 - this.minY) / this.cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = r * this.cols + c;
        for (let j = this.start[cell]!; j < this.start[cell + 1]!; j++) fn(this.items[j]!);
      }
    }
  }
}

/** A stable colour for the i-th group: golden-angle hue steps, readable on both themes. */
export function groupColor(i: number, dark: boolean): string {
  const hue = (i * 137.508) % 360;
  return `hsl(${hue.toFixed(0)} ${dark ? 65 : 60}% ${dark ? 62 : 45}%)`;
}

/**
 * Greedy label placement: the order given first (larger groups), a label is skipped when it overlaps one already
 * placed. Returns the indices of the labels to draw.
 */
export function placeLabels(boxes: ReadonlyArray<{ x: number; y: number; w: number; h: number }>, order: readonly number[]): number[] {
  const placed: number[] = [];
  for (const i of order) {
    const a = boxes[i]!;
    let free = true;
    for (const j of placed) {
      const b = boxes[j]!;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        free = false;
        break;
      }
    }
    if (free) placed.push(i);
  }
  return placed;
}

/** Deterministic 0..1 from a string (angles for new nodes, so the same expansion always looks the same). */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}
