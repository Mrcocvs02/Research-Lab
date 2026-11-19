import { GRAPH_LIMITS } from '@rl/core';
import type { GraphModel } from '@rl/graph';
import type { MainServices } from '../ipc/handlers/services.js';
import { withMapAreas } from './areas-run.js';
import { readLabels } from './labels-store.js';
import { drift, loadModel, modelId, noModel, placePending } from './service.js';
import { loadView, scopeIds } from './view.js';

const clusterId = (m: GraphModel, c: number): string => (m.clusters[c] as { id: string }).id;

/** `graph:map` (loaded on first use): one point per document of the scope with its clusters, the clusters, and the macro-areas of the points. */
export async function map(s: MainServices, scope: { folder?: string | undefined; projectId?: string | undefined; tagId?: string | undefined } | undefined) {
  const rt = await s.runtime.require();
  const view = await loadView(rt);
  const lm = await loadModel(s, rt);
  if (!lm) throw noModel();
  const m = lm.model;
  const wanted = await scopeIds(rt, view, scope);
  const points: Array<{ docId: string; x: number; y: number; clusters: string[]; ar?: number[][] | undefined; az?: number | undefined }> = [];
  const stale = new Set<string>();
  const { pending } = drift(view, m, lm.index);
  for (const r of pending) stale.add(r.id);
  for (let i = 0; i < m.ids.length; i++) {
    const id = m.ids[i] as string;
    if (stale.has(id) || !view.byId.has(id) || (wanted && !wanted.has(id))) continue;
    points.push({ docId: id, x: m.x[i] as number, y: m.y[i] as number, clusters: (m.cl[i] as number[]).map((c) => clusterId(m, c)) });
  }
  const placed = await placePending(s, rt, view, lm, wanted ? pending.filter((r) => wanted.has(r.id)) : pending);
  for (const [id, p] of placed) points.push({ docId: id, x: p.x, y: p.y, clusters: p.clusters.map((c) => clusterId(m, c)) });
  // More documents than the reply may carry (60,000 can be built, 50,000 shown): the rest are counted so the view can say so.
  const omitted = Math.max(0, points.length - GRAPH_LIMITS.mapPoints);
  if (omitted > 0) points.length = GRAPH_LIMITS.mapPoints;

  // Clusters: sizes and centroids from the points that are on the map (a scope or a placement changes them).
  const acc = new Map<string, { n: number; sx: number; sy: number }>();
  for (const p of points) {
    for (const c of p.clusters) {
      const a = acc.get(c) ?? { n: 0, sx: 0, sy: 0 };
      a.n++;
      a.sx += p.x;
      a.sy += p.y;
      acc.set(c, a);
    }
  }
  const labels = await readLabels(s, rt, modelId(m));
  const clusters = m.clusters.flatMap((c) => {
    const a = acc.get(c.id);
    if (!a) return [];
    const label = labels[c.id];
    return [
      {
        id: c.id,
        parent: c.parent >= 0 ? clusterId(m, c.parent) : null,
        level: c.level,
        size: a.n,
        topTerms: c.terms.slice(0, 12),
        aiLabel: label ? { text: label.text, meta: label.meta } : null,
        centroid: { x: Math.round((a.sx / a.n) * 1e4) / 1e4, y: Math.round((a.sy / a.n) * 1e4) / 1e4 },
      },
    ];
  });
  return withMapAreas(s, view, scope, { points, clusters, seed: m.seed, builtAt: m.builtAt, omitted });
}
