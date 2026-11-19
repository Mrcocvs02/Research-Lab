import { visibleGroupTags, type DocumentRecord } from '@rl/core';
import { autoMemberships, familyModel, neighborsOf, parseFamily, tagMemberships, type AreaModel, type AreaSummary, type FamilyNode, type Memberships } from '@rl/graph';
import type { MainServices } from '../ipc/handlers/services.js';
import { areaModel, weightsOf } from './areas-run.js';
import { readNames } from './family-names-store.js';
import { drift, loadModel, modelId } from './service.js';
import { loadView, scopeIds, type LibraryView } from './view.js';

/**
 * Grouping families of the Map (D-489, section 18.3.7), loaded on first use as their own chunk. A family is a set of tags of one kind or
 * the communities of the network itself; the answer has the shape of the macro-areas (`areas`, `ar`, `az`) so the renderer colours, labels
 * and pulls the nodes with the code it already has. Nothing here writes anything.
 */
type Scope = { folder?: string | undefined; projectId?: string | undefined; tagId?: string | undefined } | undefined;
interface Item {
  id: string;
  ar?: number[][] | undefined;
  az?: number | undefined;
}

const GROUP_HINT = 'extra:';
let last: { key: string; model: AreaModel } | null = null;
export const scopeKey = (scope: Scope): string => JSON.stringify(scope ?? null);

const docTags = (rec: DocumentRecord, withGroups: boolean): Array<{ id: string; w: number }> => (withGroups ? [...weightsOf(rec), ...visibleGroupTags(rec).map((id) => ({ id, w: 1 }))] : weightsOf(rec));

/** The families this library offers, with how many documents each covers (0 when not worth computing: `auto`). */
async function listFamilies(s: MainServices, view: LibraryView, scope: Scope): Promise<Array<{ id: string; label: string; count: number }>> {
  const out: Array<{ id: string; label: string; count: number }> = [];
  const topic = await areaModel(await s.runtime.require(), view, scope);
  out.push({ id: 'topic', label: 'Topic', count: topic.tagged });
  const nodes = (view.tax?.nodes ?? []) as FamilyNode[];
  const docs = view.records.map((r) => ({ id: r.id, tags: docTags(r, true) }));
  const offers: Array<{ id: string; label: string }> = [];
  if (nodes.some((n) => n.level === 'method' && n.status !== 'deprecated')) offers.push({ id: 'level:method', label: 'Method' });
  for (const g of new Set(nodes.map((n) => n.group).filter((g): g is string => !!g && g.startsWith(GROUP_HINT) && g.length > GROUP_HINT.length))) offers.push({ id: `group:${g}`, label: g.slice(GROUP_HINT.length) });
  offers.push({ id: 'prefix:grp:', label: 'Group' });
  for (const o of offers) {
    const count = tagMemberships(parseFamily(o.id), nodes, docs).docs.size;
    if (count > 0) out.push({ ...o, count });
  }
  out.push({ id: 'auto', label: 'Automatic', count: 0 });
  return out;
}

/** The memberships of the community family: Louvain on the weighted neighbours of the model, labelled by the recurring tags. */
export async function autoModel(s: MainServices, view: LibraryView, scope: Scope): Promise<Memberships | null> {
  const rt = await s.runtime.require();
  const lm = await loadModel(s, rt);
  if (!lm) return null;
  const m = lm.model;
  const wanted = await scopeIds(rt, view, scope);
  const stale = new Set(drift(view, m, lm.index).pending.map((r) => r.id));
  const at = new Map<number, number>();
  const ids: string[] = [];
  m.ids.forEach((id, i) => {
    if (stale.has(id) || !view.byId.has(id) || (wanted && !wanted.has(id))) return;
    at.set(i, ids.length);
    ids.push(id);
  });
  const edges: Array<{ a: number; b: number; w: number }> = [];
  for (const [i, a] of at) for (const nb of neighborsOf(m, i)) {
    const b = at.get(nb.j);
    if (b !== undefined && a < b) edges.push({ a, b, w: nb.score });
  }
  const tags = ids.map((id) => view.tagsOf(view.byId.get(id)!));
  return autoMemberships(ids, edges, (i) => tags[i]!, (t) => view.lookup.tagLabel(t) ?? (t.startsWith('grp:') ? t.slice(4) : t), 'Cluster', m.seed);
}

async function familyAreas(s: MainServices, view: LibraryView, scope: Scope, family: string): Promise<AreaModel> {
  const ref = parseFamily(family);
  if (ref.kind === 'topic') return areaModel(await s.runtime.require(), view, scope);
  const rt = await s.runtime.require();
  const lm = ref.kind === 'auto' ? await loadModel(s, rt) : null;
  const names = lm ? await readNames(s, rt, modelId(lm.model)) : {};
  const key = `${view.key}|${family}|${scopeKey(scope)}|${lm ? modelId(lm.model) : ''}|${JSON.stringify(names)}`;
  // A project's membership is not part of the library state: that scope is never reused.
  if (last && last.key === key && scope?.projectId === undefined) return last.model;
  const wanted = await scopeIds(rt, view, scope);
  const recs = view.records.filter((r) => !wanted || wanted.has(r.id));
  const mem = ref.kind === 'auto' ? await autoModel(s, view, scope) : tagMemberships(ref, (view.tax?.nodes ?? []) as FamilyNode[], recs.map((r) => ({ id: r.id, tags: docTags(r, ref.kind === 'prefix') })));
  if (ref.kind === 'auto' && mem) for (const id of [...mem.labels.keys()]) mem.labels.set(id, names[`${scopeKey(scope)}|${id}`] ?? mem.labels.get(id)!);
  const colors = new Map<string, string>();
  if (ref.kind !== 'auto' && ref.kind !== 'prefix') for (const n of view.tax?.nodes ?? []) if (n.color) colors.set(n.id, n.color);
  const model = familyModel(mem ?? { labels: new Map(), docs: new Map() }, recs.length, 'Other', colors);
  last = { key, model };
  return model;
}

/** `graph:family`: the list of families and, when one is asked for, its clusters and the shares of the documents. */
export async function runFamily(s: MainServices, req: { family?: string | undefined; scope?: Scope; docIds?: string[] | undefined }): Promise<{ families: Array<{ id: string; label: string; count: number }>; areas?: AreaSummary[]; items: Item[] }> {
  const view = await loadView(await s.runtime.require());
  const families = await listFamilies(s, view, req.scope);
  if (!req.family) return { families, items: [] };
  const m = await familyAreas(s, view, req.scope, req.family);
  const ids = req.docIds ?? [...m.docs.keys()];
  const items: Item[] = [];
  for (const id of ids) {
    const sh = m.docs.get(id);
    if (sh && sh.ar.length > 0) items.push({ id, ar: sh.ar, az: sh.az });
  }
  return { families, ...(m.areas.length > 0 ? { areas: m.areas } : {}), items };
}
