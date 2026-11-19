import type { Channels, ResponseOf } from '@rl/core';
import { NONE, colorCache, type AreaDef, type AreaTriples } from './areaColors';
import { parseColor, type TintGroup } from './colors';
import { boundsOf, PointGrid, toScreenX, toScreenY, type Bounds, type View } from './geometry';
import { separateClusters } from './hulls';
import { collidePoints } from './quadtree';

export type MapResponse = ResponseOf<Channels, 'graph:map'>;
export type ClusterView = MapResponse['clusters'][number] & {
  /** Name of the grouping family's area that holds most of the cluster (D-491): the one name used on the canvas while a family is on. */
  famLabel?: string | undefined;
};

/** The map in flat typed arrays (no object per point) with a spatial grid and, per level, the points grouped by cluster. */
export interface PreparedMap {
  n: number;
  ids: string[];
  xs: Float32Array;
  ys: Float32Array;
  bounds: Bounds;
  grid: PointGrid;
  indexOf: Map<string, number>;
  /** Clusters of each level (index = level), by id. */
  levels: ClusterView[][];
  clusterById: Map<string, ClusterView>;
  /** `groups[level]`: points sorted by cluster; `starts[g]..starts[g+1]` is the group of `clusters[level][g]`, the last group holds the points without a cluster. */
  groups: Array<{ order: Uint32Array; starts: Uint32Array }>;
  seed: number;
  builtAt: string;
  /** Documents left off because the library has more than the map can carry. */
  omitted: number;
  /** Macro-areas (D-483): the areas of the library, and per point its shares and centrality (undefined: no area). */
  areas: AreaDef[];
  ar: Array<AreaTriples | undefined>;
  az: Uint8Array;
  /** Points with an area. */
  withArea: number;
}

/**
 * Small libraries (< 30 documents, D-379): points that sit on top of each other are pushed apart (60 passes) and pulled a little
 * towards the centroid of their topic, so each one can be seen and picked. Done once on the arrays before the grid is built.
 */
export function relaxSmall(xs: Float32Array, ys: Float32Array, n: number, cx: ArrayLike<number>, cy: ArrayLike<number>): void {
  if (n < 2) return;
  const b = boundsOf(xs, ys, n);
  const min = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-6) * 0.06;
  for (let pass = 0; pass < 60; pass++) {
    for (let i = 0; i < n; i++) {
      xs[i]! += (cx[i]! - xs[i]!) * 0.02;
      ys[i]! += (cy[i]! - ys[i]!) * 0.02;
      for (let j = i + 1; j < n; j++) {
        let dx = xs[j]! - xs[i]!;
        let dy = ys[j]! - ys[i]!;
        let d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 1e-9) {
          dx = Math.cos(i * 2.4 + j);
          dy = Math.sin(i * 2.4 + j);
          d = 1;
        }
        const push = ((min - Math.min(d, min)) / 2) / d;
        xs[i]! -= dx * push;
        ys[i]! -= dy * push;
        xs[j]! += dx * push;
        ys[j]! += dy * push;
      }
    }
  }
}

export function prepareMap(r: MapResponse): PreparedMap {
  const n = r.points.length;
  const ids = new Array<string>(n);
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const indexOf = new Map<string, number>();
  const ar = new Array<AreaTriples | undefined>(n);
  const az = new Uint8Array(n);
  let withArea = 0;
  r.points.forEach((p, i) => {
    if (p.ar && p.ar.length > 0) {
      ar[i] = p.ar;
      az[i] = p.az ?? 0;
      withArea++;
    }
    ids[i] = p.docId;
    xs[i] = p.x;
    ys[i] = p.y;
    indexOf.set(p.docId, i);
  });
  const depth = r.clusters.reduce((m, c) => Math.max(m, c.level + 1), 0);
  const levels: ClusterView[][] = Array.from({ length: depth }, () => []);
  const clusterById = new Map<string, ClusterView>();
  for (const c of r.clusters) {
    levels[c.level]!.push(c);
    clusterById.set(c.id, c);
  }
  for (const l of levels) l.sort((a, b) => b.size - a.size || (a.id < b.id ? -1 : 1));
  const groups = levels.map((clusters, level) => {
    const slot = new Map<string, number>();
    clusters.forEach((c, g) => slot.set(c.id, g));
    const g = clusters.length;
    const of = new Int32Array(n);
    const starts = new Uint32Array(g + 2);
    for (let i = 0; i < n; i++) {
      const id = r.points[i]!.clusters[level];
      const s = (id !== undefined ? slot.get(id) : undefined) ?? g;
      of[i] = s;
      starts[s + 1]!++;
    }
    for (let s = 0; s <= g; s++) starts[s + 1]! += starts[s]!;
    const fill = starts.slice(0, g + 1);
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[fill[of[i]!]!++] = i;
    return { order, starts };
  });
  if (n < 30 && n > 1) {
    // Each point is pulled towards the centroid of its coarsest topic.
    const top = new Map(r.clusters.map((c) => [c.id, c.centroid]));
    const cx = new Float32Array(n);
    const cy = new Float32Array(n);
    r.points.forEach((p, i) => {
      const c = top.get(p.clusters[0] ?? '');
      cx[i] = c?.x ?? xs[i]!;
      cy[i] = c?.y ?? ys[i]!;
    });
    relaxSmall(xs, ys, n, cx, cy);
  }
  // Groups that do not overlap (§4.22): once per layout, in the coarsest level; then a light collision pass between points.
  const g0 = groups[0];
  if (g0 && n > 3) {
    const b0 = boundsOf(xs, ys, n);
    const unit = Math.max(b0.maxX - b0.minX, b0.maxY - b0.minY, 1e-6) / 800;
    separateClusters(xs, ys, g0.order, g0.starts, levels[0]!.length, 24 * unit);
    if (n <= 5000) collidePoints(xs, ys, n, (n <= 300 ? 14 : n <= 1500 ? 9 : 6) * unit);
  }
  const bounds = boundsOf(xs, ys, n);
  return { n, ids, xs, ys, bounds, grid: new PointGrid(xs, ys, n, bounds), indexOf, levels, clusterById, groups, seed: r.seed, builtAt: r.builtAt, omitted: r.omitted, areas: r.areas ?? [], ar, az, withArea };
}

/** The text a cluster is shown with: Claude's label when there is one, else its most characteristic terms. */
export function clusterText(c: ClusterView, terms = 3): { text: string; ai: boolean } {
  if (c.famLabel) return { text: c.famLabel, ai: false };
  if (c.aiLabel) return { text: c.aiLabel.text, ai: true };
  return { text: c.topTerms.slice(0, terms).join(', '), ai: false };
}

/** Points inside the view, in drawing order (cluster by cluster at `level`): what the keyboard walks through. */
export function pointsInView(map: PreparedMap, level: number, v: View, w: number, h: number): number[] {
  const g = map.groups[level];
  const out: number[] = [];
  for (let j = 0; j < map.n; j++) {
    const i = g ? g.order[j]! : j;
    const sx = toScreenX(v, map.xs[i]!, w);
    const sy = toScreenY(v, map.ys[i]!, h);
    if (sx >= 0 && sy >= 0 && sx <= w && sy <= h) out.push(i);
  }
  return out;
}

/** The point after (or before) `current` in `list`, wrapping; with no current point (or one out of view) the first (or the last). */
export function stepPoint(list: readonly number[], current: number, forward: boolean): number {
  if (list.length === 0) return -1;
  const at = list.indexOf(current);
  if (at < 0) return list[forward ? 0 : list.length - 1]!;
  return list[(at + (forward ? 1 : list.length - 1)) % list.length]!;
}

/** Centre and radius (the farthest point) of every cluster of a level: what the adjacency of the hulls is computed from. */
export function clusterCircles(map: PreparedMap, level: number): { cx: Float64Array; cy: Float64Array; r: Float64Array } {
  const g = map.groups[level];
  const clusters = map.levels[level] ?? [];
  const cx = new Float64Array(clusters.length);
  const cy = new Float64Array(clusters.length);
  const r = new Float64Array(clusters.length);
  if (!g) return { cx, cy, r };
  clusters.forEach((c, s) => {
    cx[s] = c.centroid.x;
    cy[s] = c.centroid.y;
    let far = 0;
    for (let j = g.starts[s]!; j < g.starts[s + 1]!; j++) {
      const i = g.order[j]!;
      far = Math.max(far, Math.hypot(map.xs[i]! - c.centroid.x, map.ys[i]! - c.centroid.y));
    }
    r[s] = far;
  });
  return { cx, cy, r };
}

/** The groups the stable tints are assigned for (documents of each cluster and its top terms). */
export function tintGroups(map: PreparedMap, level: number): TintGroup[] {
  const g = map.groups[level];
  const clusters = map.levels[level] ?? [];
  return clusters.map((c, s) => {
    const docs: string[] = [];
    if (g) for (let j = g.starts[s]!; j < g.starts[s + 1]!; j++) docs.push(map.ids[g.order[j]!]!);
    return { id: c.id, docs, key: c.topTerms.slice(0, 3).join(' ') };
  });
}

/** Radius (screen px, 3 to 6) of a node by its weight `c` against the biggest `cmax` (§4.22). */
export const nodeRadius = (c: number, cmax: number): number => 3 + 3 * Math.sqrt(Math.max(c, 0) / Math.max(cmax, 1));

/** The colours of the points by macro-area, grouped so that one path is drawn per colour (5 bits per channel: a few hundred at most). */
export interface PointPaint {
  /** Colour of each point (`--area-none` for a point without area). */
  colors: string[];
  buckets: Array<{ color: string; idx: Uint32Array; none: boolean }>;
}
export function paintPoints(map: PreparedMap, slots: readonly number[], tokens: readonly string[]): PointPaint {
  const of = colorCache(slots, tokens);
  const none = tokens[NONE]!;
  const colors = new Array<string>(map.n);
  const groups = new Map<number, { color: string; idx: number[]; none: boolean }>();
  for (let i = 0; i < map.n; i++) {
    const c = of(map.ar[i], map.az[i]);
    colors[i] = c ?? none;
    const [r, g, b] = c ? parseColor(c) : [0, 0, 0];
    const key = c ? ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3) : -1;
    let e = groups.get(key);
    if (!e) groups.set(key, (e = { color: c ?? none, idx: [], none: c === null }));
    e.idx.push(i);
  }
  return { colors, buckets: [...groups.values()].map((e) => ({ color: e.color, idx: Uint32Array.from(e.idx), none: e.none })) };
}
