import type { Channels, ResponseOf } from '@rl/core';
import { boundsOf, PointGrid, toScreenX, toScreenY, type Bounds, type View } from './geometry';

export type MapResponse = ResponseOf<Channels, 'graph:map'>;
export type ClusterView = MapResponse['clusters'][number];

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
}

export function prepareMap(r: MapResponse): PreparedMap {
  const n = r.points.length;
  const ids = new Array<string>(n);
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const indexOf = new Map<string, number>();
  r.points.forEach((p, i) => {
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
  const bounds = boundsOf(xs, ys, n);
  return { n, ids, xs, ys, bounds, grid: new PointGrid(xs, ys, n, bounds), indexOf, levels, clusterById, groups, seed: r.seed, builtAt: r.builtAt, omitted: r.omitted };
}

/** The text a cluster is shown with: Claude's label when there is one, else its most characteristic terms. */
export function clusterText(c: ClusterView, terms = 3): { text: string; ai: boolean } {
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
