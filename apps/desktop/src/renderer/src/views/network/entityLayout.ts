import { hash01 } from './geometry';
import type { EntityNode } from './entityTypes';

/**
 * Where the nodes of an entity network start (§4.21.1): a topic at the centroid of its documents in the Panorama, an author at
 * the centroid of its main topic, a tag on a ring by branch; then the simulation settles from there. Positions are scaled so
 * the whole network spans about `REST * sqrt(n)` world units, whatever the scale of the Panorama is.
 */
export function layoutAnchors(nodes: readonly EntityNode[], centroids: ReadonlyMap<string, { x: number; y: number }>, rest = 70): Map<string, { x: number; y: number }> {
  const raw = new Map<string, { x: number; y: number }>();
  const groups = [...new Set(nodes.map((n) => n.group || n.colorKey))].sort();
  for (const n of nodes) {
    const c = centroids.get(n.id) ?? centroids.get(n.colorKey);
    if (c) raw.set(n.id, { x: c.x, y: c.y });
    else {
      // A ring: each branch has its own sector.
      const sector = groups.indexOf(n.group || n.colorKey) / Math.max(groups.length, 1);
      const a = (sector + hash01(n.id) * 0.8 / Math.max(groups.length, 1)) * Math.PI * 2;
      raw.set(n.id, { x: Math.cos(a), y: Math.sin(a) });
    }
  }
  const pts = [...raw.values()];
  if (pts.length === 0) return raw;
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const span = Math.max(maxX - minX, maxY - minY, 1e-9);
  const size = rest * Math.sqrt(nodes.length) * 1.4;
  const out = new Map<string, { x: number; y: number }>();
  for (const [id, p] of raw) {
    // A little deterministic jitter keeps the nodes of one centroid from stacking exactly.
    out.set(id, { x: ((p.x - (minX + maxX) / 2) / span) * size + (hash01(`x${id}`) - 0.5) * rest, y: ((p.y - (minY + maxY) / 2) / span) * size + (hash01(`y${id}`) - 0.5) * rest });
  }
  return out;
}

/** Radius in pixels of a node of `count` documents among a largest of `max`: `4 + 10 sqrt(c / max)`. */
export const nodeRadius = (count: number, max: number): number => 4 + 10 * Math.sqrt(Math.max(count, 0) / Math.max(max, 1));
