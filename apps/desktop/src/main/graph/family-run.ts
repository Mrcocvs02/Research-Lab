import { visibleGroupTags, type DocumentRecord } from '@rl/core';
import { areaValues, autoMemberships, familyEligibility, familyModel, layoutBlocks, mainValue, neighborsOf, parseFamily, tagMemberships, vocabLinks, type AreaModel, type AreaSummary, type Block, type Eligibility, type FamilyNode, type Memberships, type PaperValue, type PaperValues, type VocabLink } from '@rl/graph';
import type { MainServices } from '../ipc/handlers/services.js';
import { areaModel, weightsOf, withoutKeywords } from './areas-run.js';
import { isSourceFamily } from './family-offer.js';
import { readNames } from './family-names-store.js';
import { loadModel, modelId } from './service.js';
import { loadView, scopeIds, type LibraryView } from './view.js';

/**
 * Grouping families of the Map (D-489, section 18.3.7), loaded on first use as their own chunk. A family is a set of tags of one kind or
 * the communities of the network itself; the answer has the shape of the macro-areas (`areas`, `ar`, `az`) so the renderer colours, labels
 * and pulls the nodes with the code it already has. Nothing here writes anything.
 */
export type Scope = { folder?: string | undefined; projectId?: string | undefined; tagId?: string | undefined } | undefined;
interface Item {
  id: string;
  cell?: [number, number] | undefined;
  block?: string | undefined;
  others?: string[] | undefined;
  ar?: number[][] | undefined;
  az?: number | undefined;
  /** Reading state: 1 = in studio, 2 = read; absent = to read (D-525). */
  st?: 1 | 2 | undefined;
}

const GROUP_HINT = 'extra:';
let last: { key: string; model: AreaModel } | null = null;
export const scopeKey = (scope: Scope): string => JSON.stringify(scope ?? null);

const docTags = (rec: DocumentRecord, withGroups: boolean): Array<{ id: string; w: number }> => (withGroups ? [...weightsOf(rec), ...visibleGroupTags(rec).map((id) => ({ id, w: 1 }))] : weightsOf(rec));

export interface Values {
  /** Weighted values of level 1 of each paper that has any; `pin` is the value the user fixed as the paper's main one (D-521). */
  docs: Map<string, PaperValue[] & PaperValues>;
  labels: Map<string, string>;
  /** Level 2 value of a paper inside its main value. */
  sub: (docId: string, value: string) => string | null;
  /** Every top value is of kind `one` / of the keywords kind (D-493). */
  one: boolean;
  keywords: boolean;
}
type Reason = Pick<Eligibility, 'coverage' | 'clarity' | 'values'>;
interface Offer {
  id: string;
  label: string;
  count: number;
  eligible?: boolean;
  reason?: Reason;
  /** The family was judged with the field vocabulary (D-570): the clarity is not its measure (D-574). */
  pack?: boolean;
}
const reasonOf = (e: Eligibility): Reason => ({ coverage: e.coverage, clarity: e.clarity, values: e.values });

/** Hand-fixed main values (`mainTags`, D-521): a paper whose fixed tag is still on it and sits under one of its values gets `pin` = that value, which wins over the choice by weight. */
function pinValues(docs: Values['docs'], recs: readonly DocumentRecord[], key: string, valuesOfTag: (tag: string) => string[]): void {
  for (const r of recs) {
    const tag = r.mainTags?.[key];
    const list = docs.get(r.id);
    if (!tag || !list || !r.tags.includes(tag)) continue;
    const v = valuesOfTag(tag).find((o) => list.some((e) => e.v === o));
    if (v !== undefined) list.pin = v;
  }
}

/** The values of level 1 and 2 of a tag family or of the topic (the macro-areas and their branches), as the blocks and the test read them. */
export async function valuesOf(s: MainServices, view: LibraryView, scope: Scope, family: string, recs: DocumentRecord[]): Promise<Values> {
  const ref = parseFamily(family);
  const nodes = (view.tax?.nodes ?? []) as Array<FamilyNode & { family?: string }>;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (ref.kind === 'topic') {
    const m = await areaModel(await s.runtime.require(), view, scope);
    const docs: Values['docs'] = new Map();
    const branch = new Map<string, string>();
    for (const [id, sh] of m.docs) {
      const list = areaValues(m, id);
      if (!list) continue;
      docs.set(id, list);
      const [a, b] = sh.ar[0]!;
      if (b >= 0) branch.set(id, m.areas[a]!.branches[b]!.id);
    }
    const labels = new Map(m.areas.map((a) => [a.id, a.label]));
    for (const a of m.areas) for (const b of a.branches) labels.set(b.id, view.lookup.tagLabel(b.id) ?? b.id);
    pinValues(docs, recs, 'topic', (t) => (m.tagShare(t)?.ar ?? []).map(([a]) => m.areas[a]!.id));
    return { docs, labels, sub: (id) => branch.get(id) ?? null, one: false, keywords: false };
  }
  if (ref.kind === 'auto') {
    const mem = await autoModel(s, view, scope);
    return { docs: new Map([...(mem?.docs ?? [])].map(([id, l]) => [id, l.map((e) => ({ v: e.cluster, w: e.w }))])), labels: mem?.labels ?? new Map(), sub: () => null, one: true, keywords: false };
  }
  const prefix = ref.kind === 'prefix';
  const tagged = recs.map((r) => ({ id: r.id, tags: docTags(r, prefix) }));
  const mem = tagMemberships(ref, nodes, tagged);
  const labels = new Map(mem.labels);
  const kids = new Map<string, string[]>();
  if (!prefix) for (const n of nodes) for (const p of n.parents) if (mem.labels.has(p)) (kids.get(p) ?? kids.set(p, []).get(p)!).push(n.id);
  const tagsById = new Map(tagged.map((d) => [d.id, d.tags]));
  const tops = [...mem.labels.keys()];
  const docs: Values['docs'] = new Map([...mem.docs].map(([id, l]) => [id, l.map((e) => ({ v: e.cluster, w: e.w, mw: e.mw, d: e.d, n: e.n }))]));
  if (ref.kind === 'root') {
    // The level 1 value above a tag: the first ancestor (itself included) that hangs directly under the family root.
    const above = (t: string): string[] => {
      const seen = new Set<string>();
      const stack = [t];
      const out: string[] = [];
      while (stack.length > 0) {
        const x = stack.pop() as string;
        if (seen.has(x)) continue;
        seen.add(x);
        if (byId.get(x)?.parents.includes(ref.value)) out.push(x);
        else stack.push(...(byId.get(x)?.parents ?? []));
      }
      return out.sort();
    };
    pinValues(docs, recs, ref.value, above);
  }
  return {
    docs,
    labels,
    sub(id, value) {
      const kid = new Set(kids.get(value) ?? []);
      let best: { id: string; w: number } | null = null;
      for (const t of tagsById.get(id) ?? []) if (kid.has(t.id) && (!best || t.w > best.w || (t.w === best.w && t.id < best.id))) best = t;
      if (best && !labels.has(best.id)) labels.set(best.id, view.lookup.tagLabel(best.id) ?? best.id);
      return best?.id ?? null;
    },
    one: ref.kind === 'root' ? byId.get(ref.value)?.family === 'one' : tops.length > 0 && tops.every((t) => byId.get(t)?.family === 'one'),
    keywords: ref.kind === 'root' ? byId.get(ref.value)?.family === 'keywords' : tops.length > 0 && tops.every((t) => byId.get(t)?.family === 'keywords'),
  };
}

/** Whether a field vocabulary is in use in this library (a failure of the vocabulary counts as none). */
async function packActive(s: MainServices): Promise<boolean> {
  try {
    const rt = await s.runtime.require();
    const { activeState } = await import('../features/vocab-pack/state.js');
    return (await activeState(rt.store.dataDir)) !== null;
  } catch {
    return false;
  }
}

/** The families this library offers, with how many documents each covers (0 when not worth computing: `auto`) and whether each passes the test of the blocks. */
async function listFamilies(s: MainServices, view: LibraryView, scope: Scope, recs: DocumentRecord[]): Promise<Offer[]> {
  const out: Offer[] = [];
  const topic = await areaModel(await s.runtime.require(), view, scope);
  const nodes = (view.tax?.nodes ?? []) as Array<FamilyNode & { family?: string }>;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  /** The family root above a node (a root with `family`), if any. */
  const familyRoot = (id: string): string | undefined => {
    let cur = byId.get(id);
    for (let i = 0; cur && i < 50; i++) {
      if (cur.parents.length === 0) return cur.family ? cur.id : undefined;
      cur = byId.get(cur.parents[0]!);
    }
    return undefined;
  };
  const fieldPack = await packActive(s);
  const check = async (o: { id: string; label: string }, count: number): Promise<void> => {
    const v = await valuesOf(s, view, scope, o.id, recs);
    // The Topic (and the families of several values under a root) of a library with a field vocabulary: the macro-areas are the field's (D-570).
    const topicLike = o.id === 'topic' || o.id.startsWith('root:');
    const packed = fieldPack && topicLike && !v.one;
    const e = familyEligibility(v.docs.values(), recs.length, { one: v.one, keywords: v.keywords, fieldPack: packed });
    out.push({ ...o, count, eligible: e.eligible, reason: reasonOf(e), ...(packed ? { pack: true } : {}) });
  };
  await check({ id: 'topic', label: 'Topic' }, topic.tagged);
  const docs = view.records.map((r) => ({ id: r.id, tags: docTags(r, true) }));
  const offers: Array<{ id: string; label: string }> = [];
  // The families of the controlled vocabulary (D-493): every root with `family` one / many, but the one the Topic areas already show (D-505).
  const areaIds = new Set(topic.areas.map((a) => a.id));
  for (const r of nodes.filter((n) => n.parents.length === 0 && n.status !== 'deprecated' && (n.family === 'one' || n.family === 'many'))) {
    // The Topic areas are this root's subtree (its values, or deeper when a generic value gave way to its children): already offered.
    if (areaIds.size > 0 && [...areaIds].every((a) => a === r.id || familyRoot(a) === r.id)) continue;
    if (!isSourceFamily(r.label)) offers.push({ id: `root:${r.id}`, label: r.label });
  }
  if (nodes.some((n) => n.level === 'method' && n.status !== 'deprecated')) offers.push({ id: 'level:method', label: 'Method' });
  // A group hint of the old index whose tags all sit in a family now (moved by the cleanup) is no longer a family of its own (D-505).
  const groups = new Set(nodes.map((n) => n.group).filter((g): g is string => !!g && g.startsWith(GROUP_HINT) && g.length > GROUP_HINT.length));
  for (const g of groups) if (nodes.some((n) => n.group === g && n.status !== 'deprecated' && familyRoot(n.id) === undefined) && !isSourceFamily(g.slice(GROUP_HINT.length))) offers.push({ id: `group:${g}`, label: g.slice(GROUP_HINT.length) });
  offers.push({ id: 'prefix:grp:', label: 'Group' });
  for (const o of offers) {
    const count = tagMemberships(parseFamily(o.id), nodes, docs).docs.size;
    if (count > 0) await check(o, count);
  }
  out.push({ id: 'auto', label: 'Automatic', count: 0, eligible: true });
  return out;
}

/** The memberships of the community family: Louvain on the weighted neighbours of the model, labelled by the recurring tags. */
export async function autoModel(s: MainServices, view: LibraryView, scope: Scope): Promise<Memberships | null> {
  const rt = await s.runtime.require();
  const lm = await loadModel(s, rt);
  if (!lm) return null;
  const m = lm.model;
  const wanted = await scopeIds(rt, view, scope);
  // A paper changed since the build (new tags after a vocabulary cleanup, say) keeps its neighbours of the last build: leaving it out put
  // 21 of 25 papers in "No value" right after the cleanup (D-505). The Map already offers to update itself.
  const at = new Map<number, number>();
  const ids: string[] = [];
  m.ids.forEach((id, i) => {
    if (!view.byId.has(id) || (wanted && !wanted.has(id))) return;
    at.set(i, ids.length);
    ids.push(id);
  });
  const edges: Array<{ a: number; b: number; w: number }> = [];
  for (const [i, a] of at) for (const nb of neighborsOf(m, i)) {
    const b = at.get(nb.j);
    if (b !== undefined && a < b) edges.push({ a, b, w: nb.score });
  }
  // The communities are named by their recurring tags, never by keywords (§19.1.1, D-505).
  const all = (view.tax?.nodes ?? []) as Array<{ id: string; parents: string[]; family?: string }>;
  const kept = new Set(withoutKeywords(all).map((n) => n.id));
  const known = new Set(all.map((n) => n.id));
  const keyword = (t: string): boolean => known.has(t) && !kept.has(t);
  const tags = ids.map((id) => view.tagsOf(view.byId.get(id)!).filter((t) => !keyword(t)));
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

/** The blocks of a family: its values as blocks, every paper of the scope in a cell (papers with no value in the last block). */
async function blocksOf(s: MainServices, v: Values, recs: DocumentRecord[], aspect: number, minBlock?: number): Promise<ReturnType<typeof layoutBlocks>> {
  const lm = await loadModel(s, await s.runtime.require());
  const pos = (id: string): { x?: number; y?: number } => {
    const i = lm?.index.get(id);
    return i === undefined || !lm ? {} : { x: lm.model.x[i] as number, y: lm.model.y[i] as number };
  };
  const docs = recs
    .map((r) => {
      const list = v.docs.get(r.id) ?? [];
      const main = mainValue(list);
      return { id: r.id, value: main, sub: main === null ? null : v.sub(r.id, main), others: list.filter((e) => e.v !== main).sort((a, b) => b.w - a.w || (a.v < b.v ? -1 : 1)).map((e) => e.v), ...pos(r.id) };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return layoutBlocks({ docs, labels: v.labels, aspect, otherLabel: 'Other', noneLabel: 'No value', minBlock });
}

/** `graph:family`: the list of families and, when one is asked for, its clusters, the shares of the documents, and the blocks when it passes the test. */
export async function runFamily(s: MainServices, req: { family?: string | undefined; scope?: Scope; docIds?: string[] | undefined; aspect?: number | undefined }): Promise<{
  families: Offer[];
  areas?: AreaSummary[];
  items: Item[];
  eligible?: boolean;
  reason?: Reason;
  blocks?: Block[];
}> {
  const rt = await s.runtime.require();
  const view = await loadView(rt);
  const wanted = await scopeIds(rt, view, req.scope);
  const recs = view.records.filter((r) => !wanted || wanted.has(r.id));
  const families = await listFamilies(s, view, req.scope, recs);
  if (!req.family) return { families, items: [] };
  const m = await familyAreas(s, view, req.scope, req.family);
  const offer = families.find((f) => f.id === req.family);
  // The macro-areas of a field vocabulary are its fixed structure: one with a single paper keeps its block (Mathematics for one book).
  const laid = await blocksOf(s, await valuesOf(s, view, req.scope, req.family, recs), recs, req.aspect ?? 1.6, offer?.pack ? 1 : undefined);
  // In blocks every paper of the scope has its cell (one with no value, or added after the model was built, sits in the last block).
  const ids = req.docIds ?? (laid && m.docs.size > 0 ? recs.map((r) => r.id) : [...m.docs.keys()]);
  const items: Item[] = [];
  for (const id of ids) {
    const sh = m.docs.get(id);
    const c = laid?.cells.get(id);
    const b = laid?.blockOf.get(id);
    if ((sh && sh.ar.length > 0) || c) {
      const state = view.byId.get(id)?.study.state;
      items.push({ id, ...(sh && sh.ar.length > 0 ? { ar: sh.ar, az: sh.az } : {}), ...(c && b ? { cell: c, block: b.block, others: b.others } : {}), ...(state === 'reading' ? { st: 1 as const } : state === 'read' ? { st: 2 as const } : {}) });
    }
  }
  return {
    families,
    ...(m.areas.length > 0 ? { areas: m.areas } : {}),
    items,
    ...(offer?.eligible !== undefined ? { eligible: offer.eligible } : {}),
    ...(offer?.reason ? { reason: offer.reason } : {}),
    ...(laid ? { blocks: laid.blocks } : {}),
  };
}

/** `graph:vocabLinks`: nodes of levels 1 and 2 of a family that go together (nothing for the keywords family, nor for a family with no tree). */
export async function runVocabLinks(s: MainServices, req: { family: string }): Promise<{ links: VocabLink[] }> {
  const ref = parseFamily(req.family);
  if (ref.kind === 'auto' || ref.kind === 'prefix') return { links: [] };
  const rt = await s.runtime.require();
  const view = await loadView(rt);
  const nodes = (view.tax?.nodes ?? []) as Array<FamilyNode & { family?: string }>;
  const top = new Set<string>();
  if (ref.kind === 'topic') for (const a of (await areaModel(rt, view, undefined)).areas) top.add(a.id);
  else for (const id of tagMemberships(ref, nodes, view.records.map((r) => ({ id: r.id, tags: docTags(r, false) }))).labels.keys()) top.add(id);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if ([...top].some((t) => byId.get(t)?.family === 'keywords')) return { links: [] };
  const parentOf = new Map<string, string>();
  const shown = new Set(top);
  for (const n of nodes) {
    const p = n.parents.find((x) => top.has(x));
    if (p && n.status !== 'deprecated') {
      shown.add(n.id);
      parentOf.set(n.id, p);
    }
  }
  return { links: vocabLinks(view.records.map((r) => view.tagsOf(r).filter((t) => shown.has(t))), (a, b) => parentOf.get(a) === b || parentOf.get(b) === a) };
}
