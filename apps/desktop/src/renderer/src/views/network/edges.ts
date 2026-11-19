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

/** Evidence between two papers (D-499): `e` is 1 for a citation or a link of the user, the similarity weight otherwise. */
export interface EvEdge {
  a: string;
  b: string;
  e: number;
  kinds: Array<'cites' | 'linked' | 'similar'>;
  w?: number | undefined;
}
export type EdgeMode = 'selected' | 'strong' | 'none';
export type EvFilter = Record<'cites' | 'linked' | 'similar', boolean>;
/** Edges of the selected or hovered paper, and the degree allowed to each paper in the "strong" mode. */
export const K_SELECTED = 5;
export const K_STRONG = 2;

/** The edges whose kinds are not all switched off (the chips of the evidence), with the kinds left. */
export function filterKinds(edges: readonly EvEdge[], on: EvFilter): EvEdge[] {
  const out: EvEdge[] = [];
  for (const e of edges) {
    const kinds = e.kinds.filter((k) => on[k]);
    if (kinds.length > 0) out.push(kinds.length === e.kinds.length ? e : { ...e, kinds });
  }
  return out;
}

/** Edges of each paper, the strongest first (ties: the explicit ones, then by the other end's id). */
export function adjacency(edges: readonly EvEdge[]): Map<string, EvEdge[]> {
  const adj = new Map<string, EvEdge[]>();
  for (const e of edges) for (const id of [e.a, e.b]) (adj.get(id) ?? adj.set(id, []).get(id)!).push(e);
  const other = (e: EvEdge, id: string) => (e.a === id ? e.b : e.a);
  for (const [id, list] of adj) list.sort((x, y) => y.e - x.e || (y.kinds.includes('similar') ? 0 : 1) - (x.kinds.includes('similar') ? 0 : 1) || (other(x, id) < other(y, id) ? -1 : 1));
  return adj;
}

/**
 * What to draw (section 19.2.3): `selected` the k = 5 strongest edges of the selected and of the hovered paper; `strong` an edge only when it is among
 * the first k = 2 of both its ends (degree at most 2); `none` nothing.
 */
export function selectEdges(mode: EdgeMode, adj: ReadonlyMap<string, readonly EvEdge[]>, focus: ReadonlyArray<string | null>): EvEdge[] {
  if (mode === 'none') return [];
  if (mode === 'selected') {
    const out = new Set<EvEdge>();
    for (const id of focus) if (id) for (const e of (adj.get(id) ?? []).slice(0, K_SELECTED)) out.add(e);
    return [...out];
  }
  const top = new Map<string, Set<EvEdge>>();
  for (const [id, list] of adj) top.set(id, new Set(list.slice(0, K_STRONG)));
  const out = new Set<EvEdge>();
  for (const [id, set] of top) for (const e of set) if (top.get(e.a === id ? e.b : e.a)?.has(e)) out.add(e);
  return [...out];
}

export interface Bundle {
  /** Block indices, a < b. */
  a: number;
  b: number;
  pairs: EvEdge[];
}
/** Pairs between two blocks become one bundle when there are at least two; the rest stay single edges. */
export function bundleEdges(edges: readonly EvEdge[], blockOf: (id: string) => number): { single: EvEdge[]; bundles: Bundle[] } {
  const groups = new Map<string, Bundle>();
  const single: EvEdge[] = [];
  for (const e of edges) {
    const x = blockOf(e.a);
    const y = blockOf(e.b);
    if (x < 0 || y < 0 || x === y) {
      single.push(e);
      continue;
    }
    const key = x < y ? `${x}:${y}` : `${y}:${x}`;
    (groups.get(key) ?? groups.set(key, { a: Math.min(x, y), b: Math.max(x, y), pairs: [] }).get(key)!).pairs.push(e);
  }
  const bundles: Bundle[] = [];
  for (const g of groups.values()) (g.pairs.length >= 2 ? bundles.push(g) : single.push(...g.pairs));
  return { single, bundles };
}
/** Thickness of a bundle (1 to 6 px) from its number of pairs. */
export const bundleWidth = (pairs: number): number => Math.min(6, 1 + pairs * 0.5);
