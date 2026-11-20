import { type DocumentRecord } from '@rl/core';
import { computeAreas, resolveAuthor, topicNodes, withoutKeywords, type AreaModel, type AreaShare, type AreaSummary, type AuthorAliases } from '@rl/graph';
import type { MainServices } from '../ipc/handlers/services.js';
import type { LibraryRuntime } from '../library/library-runtime.js';
import { scopeIds, type LibraryView } from './view.js';

/**
 * Macro-areas of the Map (D-483, §18.3.4), loaded on first use as their own chunk. The model is computed from the taxonomy
 * and the weighted tags of the documents of a scope and cached per library state; nothing here writes anything.
 */
type Scope = { folder?: string | undefined; projectId?: string | undefined; tagId?: string | undefined } | undefined;
interface Annotated {
  ar?: number[][] | undefined;
  az?: number | undefined;
}

let last: { key: string; model: AreaModel } | null = null;

/** Weight of each tag of a record: the accepted score (D-447), else 1 for a tag set by hand. */
export function weightsOf(rec: DocumentRecord): Array<{ id: string; w: number }> {
  const scores = new Map((rec.ai.suggestedTagScores?.value ?? []).map((t) => [t.id, t.weight]));
  return rec.tags.map((id) => ({ id, w: scores.get(id) ?? 1 }));
}

export { topicNodes, withoutKeywords };

export async function areaModel(rt: LibraryRuntime, view: LibraryView, scope: Scope): Promise<AreaModel> {
  const key = `${view.key}|${JSON.stringify(scope ?? null)}`;
  const wanted = await scopeIds(rt, view, scope);
  // A project's membership is not part of the library state: that scope is never reused.
  if (last && last.key === key && scope?.projectId === undefined) return last.model;
  const docs = view.records.filter((r) => !wanted || wanted.has(r.id)).map((r) => ({ id: r.id, tags: weightsOf(r) }));
  const model = computeAreas(topicNodes(view.tax?.nodes ?? []), docs);
  last = { key, model };
  return model;
}

const put = (node: Annotated, s: AreaShare | null | undefined): void => {
  if (!s || s.ar.length === 0) return;
  node.ar = s.ar;
  node.az = s.az;
};

/** `graph:map` with the areas of its points. */
export async function withMapAreas<T extends { points: Array<Annotated & { docId: string }> }>(s: MainServices, view: LibraryView, scope: Scope, out: T): Promise<T & { areas?: AreaSummary[] }> {
  const areas = await annotateMap(s, view, scope, out.points);
  return areas ? { ...out, areas } : out;
}

/** `graph:neighbors` with the areas of its nodes. */
export async function withNeighborAreas<T extends { nodes: Array<Annotated & { kind: string; id: string }> }>(s: MainServices, view: LibraryView, out: T): Promise<T & { areas?: AreaSummary[] }> {
  const areas = await annotateNeighbors(s, view, out.nodes);
  return areas ? { ...out, areas } : out;
}

async function annotateMap(s: MainServices, view: LibraryView, scope: Scope, points: Array<Annotated & { docId: string }>): Promise<AreaSummary[] | undefined> {
  const m = await areaModel(await s.runtime.require(), view, scope);
  if (m.areas.length === 0) return undefined;
  for (const p of points) put(p, m.docs.get(p.docId));
  return m.areas;
}

/** Areas of the nodes of `graph:neighbors` (documents, tags, folders: a folder takes the mean of the documents under it). */
async function annotateNeighbors(s: MainServices, view: LibraryView, nodes: Array<Annotated & { kind: string; id: string }>): Promise<AreaSummary[] | undefined> {
  const m = await areaModel(await s.runtime.require(), view, undefined);
  if (m.areas.length === 0) return undefined;
  for (const n of nodes) {
    if (n.kind === 'doc') put(n, m.docs.get(n.id));
    else if (n.kind === 'tag') put(n, m.tagShare(n.id));
    else {
      const under = n.id === '' ? '' : `${n.id}/`;
      put(n, m.groupShare(view.records.filter((r) => r.path.startsWith(under)).map((r) => r.id)));
    }
  }
  return m.areas;
}

/** Areas of the nodes of an entity network: a tag by its areas, a topic or an author by the mean of its documents. */
export async function annotateEntities(
  s: MainServices,
  view: LibraryView,
  req: { mode: 'tag' | 'topic' | 'author'; level?: number | undefined; scope?: Scope },
  nodes: Array<Annotated & { id: string }>,
  docs: ReadonlyArray<{ id: string; authors: readonly string[] }>,
  docClusters: ReadonlyMap<string, readonly string[]>,
  aliases: AuthorAliases,
): Promise<AreaSummary[] | undefined> {
  const m = await areaModel(await s.runtime.require(), view, req.scope);
  if (m.areas.length === 0) return undefined;
  if (req.mode === 'tag') {
    for (const n of nodes) put(n, m.tagShare(n.id));
    return m.areas;
  }
  const members = new Map<string, string[]>();
  const add = (k: string, id: string) => (members.get(k) ?? members.set(k, []).get(k)!).push(id);
  for (const d of docs) {
    if (req.mode === 'topic') {
      const c = docClusters.get(d.id)?.[req.level ?? 0];
      if (c !== undefined) add(c, d.id);
    } else {
      for (const k of new Set(d.authors.map((a) => resolveAuthor(a, aliases)))) if (k !== '') add(`author:${k}`, d.id);
    }
  }
  for (const n of nodes) put(n, m.groupShare(members.get(n.id) ?? []));
  return m.areas;
}
