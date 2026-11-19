/** Curved, tapered edges (§4.20): a quadratic curve bent by 0.15 of its length, always to the same side, thick at the origin and thin at the end. */
export const BEND = 0.15;
export const W_START = 2.5;
export const W_END = 0.8;
/** More visible edges than this: straight 1 px lines with a fixed opacity. */
export const MAX_CURVED = 3000;

/** The control point of the curve from (ax, ay) to (bx, by): the middle, pushed to the left of the direction of travel. */
export function controlPoint(ax: number, ay: number, bx: number, by: number, bend = BEND): { x: number; y: number; len: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  return { x: (ax + bx) / 2 + dy * bend, y: (ay + by) / 2 - dx * bend, len };
}

export const quadAt = (a: number, c: number, b: number, t: number): number => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * c + t * t * b;

/**
 * The filled polygon of a tapered curve as a flat array `[x0, y0, x1, y1, ...]`: the left side from origin to end, then the
 * right side back. Width goes linearly from `w0` to `w1`. `steps` segments per side.
 */
export function taperedPolygon(ax: number, ay: number, bx: number, by: number, w0 = W_START, w1 = W_END, steps = 8, bend = BEND): number[] {
  const c = controlPoint(ax, ay, bx, by, bend);
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = quadAt(ax, c.x, bx, t);
    const y = quadAt(ay, c.y, by, t);
    // Tangent of the curve at t.
    const tx = 2 * (1 - t) * (c.x - ax) + 2 * t * (bx - c.x);
    const ty = 2 * (1 - t) * (c.y - ay) + 2 * t * (by - c.y);
    const tl = Math.hypot(tx, ty) || 1;
    const hw = (w0 + (w1 - w0) * t) / 2;
    left.push(x - (ty / tl) * hw, y + (tx / tl) * hw);
    right.push(x + (ty / tl) * hw, y - (tx / tl) * hw);
  }
  const out = left.slice();
  for (let i = steps; i >= 0; i--) out.push(right[i * 2]!, right[i * 2 + 1]!);
  return out;
}

/** Fills one tapered edge. */
export function fillTapered(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, w0 = W_START, w1 = W_END): void {
  const p = taperedPolygon(ax, ay, bx, by, w0, w1);
  ctx.beginPath();
  ctx.moveTo(p[0]!, p[1]!);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!);
  ctx.closePath();
  ctx.fill();
}

/**
 * Opacity of an edge by weight: `0.12 + 0.5 w`; in the dark theme at least 0.3 (D-379 asks for >= 0.22 and a mean contrast of
 * 1.6:1 of the light arcs on the background; at 0.22 the measured contrast is 1.47:1, at 0.3 it is 1.76:1).
 */
export const DARK_FLOOR = 0.3;
export function edgeAlpha(weight: number, dark: boolean): number {
  const a = 0.12 + 0.5 * Math.min(Math.max(weight, 0), 1);
  return dark ? Math.max(a, DARK_FLOOR) : a;
}

/**
 * Widths by weight (section 18.3.2): a curved edge starts at `1.0 + 2.5 w` and ends at `0.4 + 0.6 w` (a citation 0.3 wider at
 * the start); a straight one (past `MAX_CURVED`) is `0.6 + 1.4 w` px with its opacity times 0.8.
 */
export const edgeWidths = (weight: number, cites = false): { w0: number; w1: number } => {
  const w = Math.min(Math.max(weight, 0), 1);
  return { w0: 1.0 + 2.5 * w + (cites ? 0.3 : 0), w1: 0.4 + 0.6 * w };
};
export const straightWidth = (weight: number): number => 0.6 + 1.4 * Math.min(Math.max(weight, 0), 1);
export const STRAIGHT_ALPHA = 0.8;
