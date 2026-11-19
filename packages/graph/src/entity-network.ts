import { NO_ALIASES, resolveAuthor, type AuthorAliases } from './explore.js';

/**
 * Entity networks of the Map (D-387, D-454, §4.21): tags, topics and authors as nodes, with the strength of their ties.
 * Pure: no files, no Electron. The caller gives the documents of the scope (non-excluded folders only) and, for topics, the
 * clusters of the model; the answer is capped (800 nodes, 8 edges per node) so it is cheap to ship and to draw.
 */

export const ENTITY_LIMIT = 800;
export const TOP_EDGES_PER_NODE = 8;
/** Works with more authors than this count for each author but create no co-authorship edges (consortia). */
export const CONSORTIUM = 25;
/** Tags of one document that make pairs (30 tags make 435 pairs). */
const PAIR_TAGS = 30;

export interface EntityDoc {
  id: string;
  authors: readonly string[];
  year: number | null;
  /** Tag ids, implied ones included. */
  tags: readonly string[];
}

export interface EntityInput {
  docs: readonly EntityDoc[];
  tax: ReadonlyArray<{ id: string; label: string; parents: readonly string[]; implies: readonly string[]; status?: string | undefined; color?: string | undefined }>;
  /** Clusters of the model (topics). `label` is the text of Claude's label, when there is one. */
  clusters: ReadonlyArray<{ id: string; level: number; parent: string | null; terms: readonly string[]; label?: string | undefined; centroid?: { x: number; y: number } | undefined }>;
  /** `docId -> cluster ids per level`. */
  docClusters: ReadonlyMap<string, readonly string[]>;
}

export interface EntityRequest {
  mode: 'tag' | 'topic' | 'author';
  level?: number | undefined;
  /** First and last year, in this order. */
  years?: readonly number[] | undefined;
  minDocs: number;
  minWeight: number;
  limit: number;
  /** An entity id: the result is this node and its heaviest neighbours (up to `limit`), not the biggest nodes. */
  focus?: string | undefined;
}

export interface EntityNode {
  id: string;
  label: string;
  count: number;
  years: number[];
  colorKey: string;
  group: string;
  groupLabel?: string;
  variants?: string[];
}

export interface EntityEdge {
  a: string;
  b: string;
  w: number;
  n: number;
  implies?: boolean;
}

export interface EntityNetwork {
  nodes: EntityNode[];
  edges: EntityEdge[];
  total: number;
  truncated: boolean;
  yearRange?: [number, number];
  documents: number;
}

const bump = <K>(m: Map<K, number>, k: K, by = 1): void => void m.set(k, (m.get(k) ?? 0) + by);
const listOf = <K, V>(m: Map<K, V[]>, k: K): V[] => m.get(k) ?? m.set(k, []).get(k)!;
const pairKey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

/** The form shown for an author: the most frequent written form, the longest on a tie, then alphabetical. */
const bestForm = (forms: ReadonlyMap<string, number>): string => {
  let out = '';
  let c = -1;
  for (const [k, n] of forms) if (n > c || (n === c && (k.length > out.length || (k.length === out.length && k < out)))) [out, c] = [k, n];
  return out;
};

const mostCommon = (counts: Map<string, number>): string => {
  let out = '';
  let c = -1;
  for (const [k, n] of counts) if (n > c || (n === c && k < out)) [out, c] = [k, n];
  return out;
};

/** Keeps the heaviest `per` edges of each node (an edge survives if either end wants it) and drops the ones under `minWeight`. */
export function topEdges(edges: readonly EntityEdge[], minWeight: number, per = TOP_EDGES_PER_NODE): EntityEdge[] {
  const by = new Map<string, EntityEdge[]>();
  for (const e of edges) {
    if (e.w < minWeight) continue;
    listOf(by, e.a).push(e);
    listOf(by, e.b).push(e);
  }
  const keep = new Set<EntityEdge>();
  const order = (x: EntityEdge, y: EntityEdge) => y.w - x.w || (x.a + x.b < y.a + y.b ? -1 : x.a + x.b > y.a + y.b ? 1 : 0);
  for (const list of by.values()) for (const e of (list.length > per ? list.sort(order) : list).slice(0, per)) keep.add(e);
  return [...keep];
}

/** Label propagation (10 passes, ties to the smallest label): the communities of the authors. Node id -> label (an id of a member). */
export function communities(ids: readonly string[], edges: readonly EntityEdge[], passes = 10): Map<string, string> {
  const nb = new Map<string, Array<[string, number]>>();
  for (const e of edges) {
    listOf(nb, e.a).push([e.b, e.w]);
    listOf(nb, e.b).push([e.a, e.w]);
  }
  const label = new Map(ids.map((i) => [i, i]));
  const order = [...ids].sort();
  for (let p = 0; p < passes; p++) {
    let changed = false;
    for (const id of order) {
      const votes = new Map<string, number>();
      for (const [o, w] of nb.get(id) ?? []) bump(votes, label.get(o)!, w);
      let pick = label.get(id)!;
      let top = votes.get(pick) ?? 0;
      for (const [l, v] of votes) if (v > top || (v === top && l < pick)) [pick, top] = [l, v];
      if (pick !== label.get(id)) {
        label.set(id, pick);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return label;
}

/** The root of a taxonomy node following the first parent (guarded against cycles). */
function rootOf(id: string, parent: Map<string, string | undefined>): string {
  const seen = new Set<string>();
  let cur = id;
  while (!seen.has(cur)) {
    seen.add(cur);
    const p = parent.get(cur);
    if (p === undefined || !parent.has(p)) break;
    cur = p;
  }
  return cur;
}

export function buildEntityNetwork(input: EntityInput, req: EntityRequest, aliases: AuthorAliases = NO_ALIASES): EntityNetwork {
  const [y0 = -Infinity, y1 = Infinity] = req.years ?? [];
  const docs = req.years === undefined ? input.docs : input.docs.filter((d) => d.year !== null && d.year >= y0 && d.year <= y1);
  let lo = Infinity;
  let hi = -Infinity;
  for (const d of docs) if (d.year !== null) (lo = Math.min(lo, d.year), (hi = Math.max(hi, d.year)));
  const yearRange: [number, number] | undefined = lo <= hi ? [lo, hi] : undefined;
  const bins = (ds: Iterable<{ year: number | null }>): number[] => {
    const out = new Array<number>(10).fill(0);
    if (yearRange) for (const d of ds) if (d.year !== null) out[Math.min(9, Math.floor(((d.year - lo) / (hi - lo + 1)) * 10))]!++;
    return out;
  };
  const finish = (nodes: EntityNode[], edges: EntityEdge[]): EntityNetwork => {
    const kept = nodes.filter((n) => n.count >= req.minDocs).sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const cap = Math.min(req.limit, ENTITY_LIMIT);
    let top = kept.slice(0, cap);
    const center = req.focus === undefined ? undefined : nodes.find((n) => n.id === req.focus);
    if (center) {
      const byId = new Map(kept.map((n) => [n.id, n]));
      const near = edges
        .filter((e) => (e.a === center.id || e.b === center.id) && e.w >= req.minWeight)
        .sort((x, y) => y.w - x.w || (x.a + x.b < y.a + y.b ? -1 : 1))
        .map((e) => (e.a === center.id ? e.b : e.a))
        .filter((id) => byId.has(id));
      top = [center, ...[...new Set(near)].slice(0, cap - 1).map((id) => byId.get(id)!)];
    }
    const ids = new Set(top.map((n) => n.id));
    return { nodes: top, edges: topEdges(edges.filter((e) => ids.has(e.a) && ids.has(e.b)), req.minWeight), total: kept.length, truncated: kept.length > top.length, ...(yearRange ? { yearRange } : {}), documents: docs.length };
  };

  if (req.mode === 'tag') return tagNetwork(input, docs, bins, finish);
  if (req.mode === 'topic') return topicNetwork(input, docs, req.level ?? 0, bins, finish);
  return authorNetwork(input, docs, aliases, bins, finish);
}

type Docs = readonly EntityDoc[];
type Bins = (ds: Iterable<{ year: number | null }>) => number[];
type Finish = (nodes: EntityNode[], edges: EntityEdge[]) => EntityNetwork;

/** Tags: co-occurrence (cosine of the document sets) plus the light "implies" edges of the taxonomy. */
function tagNetwork(input: EntityInput, docs: Docs, bins: Bins, finish: Finish): EntityNetwork {
  const tax = new Map(input.tax.filter((t) => t.status !== 'deprecated').map((t) => [t.id, t]));
  const parent = new Map([...tax].map(([id, t]) => [id, t.parents.find((p) => tax.has(p))] as [string, string | undefined]));
  const hasChild = new Set<string>();
  for (const t of tax.values()) for (const p of t.parents) hasChild.add(p);
  const members = new Map<string, EntityDoc[]>();
  const co = new Map<string, number>();
  for (const d of docs) {
    const tags = [...new Set(d.tags)].filter((t) => tax.has(t)).sort();
    for (const t of tags) listOf(members, t).push(d);
    const some = tags.slice(0, PAIR_TAGS);
    for (let i = 0; i < some.length; i++) for (let j = i + 1; j < some.length; j++) bump(co, `${some[i]}\u0000${some[j]}`);
  }
  const nodes: EntityNode[] = [];
  for (const [id, ds] of members) {
    const t = tax.get(id)!;
    const root = rootOf(id, parent);
    nodes.push({ id, label: t.label, count: ds.length, years: bins(ds), colorKey: t.color ?? tax.get(root)?.color ?? root, group: root === id && !hasChild.has(id) ? '' : root, groupLabel: tax.get(root)?.label ?? '' });
  }
  const edges: EntityEdge[] = [];
  for (const [k, n] of co) {
    const [a, b] = k.split('\u0000') as [string, string];
    edges.push({ a, b, w: Math.min(1, n / Math.sqrt(members.get(a)!.length * members.get(b)!.length)), n });
  }
  for (const t of tax.values()) for (const m of t.implies) if (members.has(t.id) && members.has(m) && t.id !== m) edges.push({ a: t.id, b: m, w: 0.25, n: 0, implies: true });
  return finish(nodes, edges);
}

/** Topics: the model's clusters at a level; affinity is the cosine of their tag profiles, or proximity in the map when there are no tags. */
function topicNetwork(input: EntityInput, docs: Docs, level: number, bins: Bins, finish: Finish): EntityNetwork {
  const here = input.clusters.filter((c) => c.level === level);
  const members = new Map<string, EntityDoc[]>();
  for (const d of docs) {
    const id = input.docClusters.get(d.id)?.[level];
    if (id !== undefined) listOf(members, id).push(d);
  }
  const profile = new Map<string, Map<string, number>>();
  const norm = new Map<string, number>();
  const byTag = new Map<string, string[]>();
  for (const [id, ds] of members) {
    const v = new Map<string, number>();
    for (const d of ds) for (const t of new Set(d.tags)) bump(v, t);
    profile.set(id, v);
    let sq = 0;
    for (const [t, x] of v) {
      sq += x * x;
      listOf(byTag, t).push(id);
    }
    norm.set(id, Math.sqrt(sq));
  }
  const nodes: EntityNode[] = here
    .filter((c) => members.has(c.id))
    .map((c) => ({ id: c.id, label: c.label ?? c.terms.slice(0, 3).join(', '), count: members.get(c.id)!.length, years: bins(members.get(c.id)!), colorKey: c.id, group: level > 0 ? (c.parent ?? '') : '' }));
  const edges: EntityEdge[] = [];
  // Inverted index over tags: only the pairs that share a tag are ever visited.
  const dots = new Map<string, { dot: number; shared: number }>();
  for (const [t, ids] of byTag) {
    if (ids.length > 400) continue;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const x = profile.get(ids[i]!)!.get(t)!;
        const y = profile.get(ids[j]!)!.get(t)!;
        const k = pairKey(ids[i]!, ids[j]!);
        const cur = dots.get(k) ?? { dot: 0, shared: 0 };
        cur.dot += x * y;
        cur.shared += Math.min(x, y);
        dots.set(k, cur);
      }
    }
  }
  for (const [k, { dot, shared }] of dots) {
    const [a, b] = k.split('\u0000') as [string, string];
    edges.push({ a, b, w: Math.min(1, dot / (norm.get(a)! * norm.get(b)!)), n: shared });
  }
  if (edges.length === 0) {
    // No tags to compare: the closest topics in the map are the related ones.
    const at = new Map(here.filter((c) => c.centroid).map((c) => [c.id, c.centroid!]));
    const placed = nodes.filter((n) => at.has(n.id));
    const seen = new Set<string>();
    for (const a of placed) {
      const near = placed
        .filter((b) => b.id !== a.id)
        .map((b) => ({ b, d: Math.hypot(at.get(a.id)!.x - at.get(b.id)!.x, at.get(a.id)!.y - at.get(b.id)!.y) }))
        .sort((x, y) => x.d - y.d || (x.b.id < y.b.id ? -1 : 1))
        .slice(0, 3);
      for (const { b } of near) {
        const k = pairKey(a.id, b.id);
        if (!seen.has(k)) (seen.add(k), edges.push({ a: a.id, b: b.id, w: 0.3, n: 0 }));
      }
    }
  }
  return finish(nodes, edges);
}

/** Authors: co-authorship (`log(1 + co)`, consortia excluded), communities of the ones that stay. */
function authorNetwork(input: EntityInput, docs: Docs, aliases: AuthorAliases, bins: Bins, finish: Finish): EntityNetwork {
  const names = new Map<string, Map<string, number>>();
  const mine = new Map<string, EntityDoc[]>();
  const co = new Map<string, number>();
  for (const d of docs) {
    const keys = new Set<string>();
    for (const name of d.authors) {
      const k = resolveAuthor(name, aliases);
      if (k === '') continue;
      keys.add(k);
      bump(names.get(k) ?? names.set(k, new Map()).get(k)!, name.trim());
    }
    for (const k of keys) listOf(mine, k).push(d);
    if (keys.size >= 2 && keys.size <= CONSORTIUM) {
      const list = [...keys].sort();
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) bump(co, `${list[i]}\u0000${list[j]}`);
    }
  }
  let maxCo = 1;
  for (const n of co.values()) if (n > maxCo) maxCo = n;
  const nodes: EntityNode[] = [];
  for (const [k, ds] of mine) {
    const forms = names.get(k)!;
    const topics = new Map<string, number>();
    for (const d of ds) {
      const c = input.docClusters.get(d.id)?.[0];
      if (c !== undefined) bump(topics, c);
    }
    const variants = [...forms].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([n]) => n);
    nodes.push({ id: `author:${k}`, label: bestForm(forms), count: ds.length, years: bins(ds), colorKey: mostCommon(topics), group: '', ...(variants.length > 1 ? { variants: variants.slice(0, 50) } : {}) });
  }
  const edges: EntityEdge[] = [];
  const norm = Math.log(1 + maxCo);
  for (const [k, n] of co) {
    const [a, b] = k.split('\u0000') as [string, string];
    edges.push({ a: `author:${a}`, b: `author:${b}`, w: Math.log(1 + n) / norm, n });
  }
  const out = finish(nodes, edges);
  // Communities of the authors that stay: the hull is named after the most connected one.
  const lab = communities(out.nodes.map((n) => n.id), out.edges);
  const size = new Map<string, number>();
  for (const l of lab.values()) bump(size, l);
  const degree = new Map<string, number>();
  for (const e of out.edges) (bump(degree, e.a, e.w), bump(degree, e.b, e.w));
  const centre = new Map<string, string>();
  for (const n of out.nodes) {
    const l = lab.get(n.id)!;
    const c = centre.get(l);
    if (c === undefined || (degree.get(n.id) ?? 0) > (degree.get(c) ?? 0)) centre.set(l, n.id);
  }
  const byId = new Map(out.nodes.map((n) => [n.id, n]));
  for (const n of out.nodes) {
    const l = lab.get(n.id)!;
    if ((size.get(l) ?? 0) > 2) {
      n.group = l;
      n.groupLabel = byId.get(centre.get(l)!)?.label ?? '';
    }
  }
  return out;
}
