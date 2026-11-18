import type { Channels, ResponseOf } from '@rl/core';
import { rl } from '../../lib/rl';
import { RlError } from '../../lib/rl-error';
import { CONSORTIUM, ENTITY_LIMIT, TOP_EDGES_PER_NODE, type EntityEdge, type EntityNetwork, type EntityNode, type EntityRequest } from './entityTypes';

/**
 * Data of the entity networks. The real source is `graph:entityNetwork` (N4, main process); until that channel has a handler
 * the same answer is derived here from `documents:list`, the taxonomy and the Panorama (`graph:map`), with the same rules
 * (§4.21.3): at most 800 nodes, 8 edges per node, 30 tags and 25 authors per document. `deriveEntityNetwork` is pure.
 */
type Summary = ResponseOf<Channels, 'documents:list'>['items'][number];
type TaxNode = ResponseOf<Channels, 'taxonomy:get'>['nodes'][number];
type MapResp = ResponseOf<Channels, 'graph:map'>;

export interface DeriveInput {
  docs: ReadonlyArray<Pick<Summary, 'docId' | 'authors' | 'year' | 'tags' | 'path'>>;
  tax: ReadonlyArray<Pick<TaxNode, 'id' | 'label' | 'parents' | 'implies' | 'status'> & { color?: string | undefined }>;
  clusters: ReadonlyArray<MapResp['clusters'][number]>;
  /** `docId -> cluster ids per level`. */
  docClusters: ReadonlyMap<string, readonly string[]>;
}

/** The user's corrections to the authors (D-386): merged keys and keys split into one node per written form. */
export interface AuthorAliases {
  merge: Record<string, string>;
  split: string[];
}
export const NO_ALIASES: AuthorAliases = { merge: {}, split: [] };

const PAIR_TAGS = 30;

export const fold = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Key of an author as in Explore: family name plus first initial, "Surname, Given" and "Given Surname" alike. */
export function authorKey(name: string): string {
  const comma = name.indexOf(',');
  const parts = (comma >= 0 ? `${name.slice(comma + 1)} ${name.slice(0, comma)}` : name)
    .split(/\s+/)
    .map(fold)
    .filter((p) => p !== '');
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  const family = comma >= 0 ? fold(name.slice(0, comma)) : parts[parts.length - 1]!;
  return `${family} ${parts[0]!.charAt(0)}`;
}

/** The key after the user's corrections: merged into another, or split by the full written form. */
export function resolveAuthor(name: string, a: AuthorAliases): string {
  const k = authorKey(name);
  if (k === '') return '';
  const split = a.split.includes(k) ? `${k}|${fold(name)}` : k;
  return a.merge[split] ?? split;
}

const best = (counts: Map<string, number>): string => {
  let out = '';
  let c = -1;
  for (const [k, n] of counts) if (n > c || (n === c && (k.length > out.length || (k.length === out.length && k < out)))) [out, c] = [k, n];
  return out;
};

const bump = <K>(m: Map<K, number>, k: K, by = 1): void => void m.set(k, (m.get(k) ?? 0) + by);

/** Keeps the 8 heaviest edges of each node (an edge survives if either end wants it) and drops the ones under `minWeight`. */
export function topEdges(edges: readonly EntityEdge[], minWeight: number, per = TOP_EDGES_PER_NODE): EntityEdge[] {
  const by = new Map<string, EntityEdge[]>();
  for (const e of edges) {
    if (e.w < minWeight) continue;
    for (const k of [e.a, e.b]) (by.get(k) ?? by.set(k, []).get(k)!).push(e);
  }
  const keep = new Set<EntityEdge>();
  for (const list of by.values()) for (const e of list.sort((x, y) => y.w - x.w || (x.a + x.b < y.a + y.b ? -1 : 1)).slice(0, per)) keep.add(e);
  return [...keep];
}

/** Label propagation (10 passes, ties to the smallest label): the communities of the authors. Returns node id -> community label (an id of a member). */
export function communities(ids: readonly string[], edges: readonly EntityEdge[], passes = 10): Map<string, string> {
  const nb = new Map<string, Array<[string, number]>>();
  for (const e of edges) {
    (nb.get(e.a) ?? nb.set(e.a, []).get(e.a)!).push([e.b, e.w]);
    (nb.get(e.b) ?? nb.set(e.b, []).get(e.b)!).push([e.a, e.w]);
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

export function deriveEntityNetwork(input: DeriveInput, req: EntityRequest, aliases: AuthorAliases = NO_ALIASES): EntityNetwork {
  const [y0, y1] = req.years ?? [-Infinity, Infinity];
  const docs = input.docs.filter((d) => (req.years === undefined || (d.year !== null && d.year >= y0 && d.year <= y1)) && (req.scope?.tagId === undefined || d.tags.includes(req.scope.tagId)) && (req.scope?.folder === undefined || d.path === req.scope.folder || d.path.startsWith(`${req.scope.folder}/`)));
  const years = docs.map((d) => d.year).filter((y): y is number => y !== null);
  const lo = years.length > 0 ? Math.min(...years) : 0;
  const hi = years.length > 0 ? Math.max(...years) : 0;
  const yearRange: [number, number] | undefined = years.length > 0 ? [lo, hi] : undefined;
  const bins = (ds: Iterable<{ year: number | null }>): number[] => {
    const out = new Array<number>(10).fill(0);
    for (const d of ds) if (d.year !== null && yearRange) out[Math.min(9, Math.floor(((d.year - lo) / (hi - lo + 1)) * 10))]!++;
    return out;
  };
  const docById = new Map(docs.map((d) => [d.docId, d]));
  const finish = (nodes: EntityNode[], edges: EntityEdge[]): EntityNetwork => {
    const kept = nodes.filter((n) => n.count >= req.minDocs).sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : 1));
    const top = kept.slice(0, Math.min(req.limit, ENTITY_LIMIT));
    const ids = new Set(top.map((n) => n.id));
    return { nodes: top, edges: topEdges(edges.filter((e) => ids.has(e.a) && ids.has(e.b)), req.minWeight), total: kept.length, truncated: kept.length > top.length, yearRange, documents: docs.length };
  };

  if (req.mode === 'tag') {
    const tax = new Map(input.tax.filter((t) => t.status !== 'deprecated').map((t) => [t.id, t]));
    const parent = new Map([...tax].map(([id, t]) => [id, t.parents.find((p) => tax.has(p))] as [string, string | undefined]));
    const members = new Map<string, typeof docs>();
    const co = new Map<string, number>();
    for (const d of docs) {
      const tags = [...new Set(d.tags)].filter((t) => tax.has(t)).sort();
      for (const t of tags) (members.get(t) ?? members.set(t, []).get(t)!).push(d);
      const some = tags.slice(0, PAIR_TAGS);
      for (let i = 0; i < some.length; i++) for (let j = i + 1; j < some.length; j++) bump(co, `${some[i]}\u0000${some[j]}`);
    }
    const nodes: EntityNode[] = [];
    for (const [id, ds] of members) {
      const t = tax.get(id)!;
      const root = rootOf(id, parent);
      nodes.push({ id, label: t.label, count: ds.length, years: bins(ds), colorKey: t.color ?? tax.get(root)?.color ?? root, group: root === id && !input.tax.some((x) => x.parents.includes(id)) ? '' : root, groupLabel: tax.get(root)?.label ?? '' });
    }
    const edges: EntityEdge[] = [];
    for (const [k, n] of co) {
      const [a, b] = k.split('\u0000') as [string, string];
      edges.push({ a, b, w: n / Math.sqrt(members.get(a)!.length * members.get(b)!.length), n });
    }
    const have = new Set(members.keys());
    for (const t of tax.values()) for (const m of t.implies) if (have.has(t.id) && have.has(m)) edges.push({ a: t.id, b: m, w: 0.25, n: 0, implies: true });
    return finish(nodes, edges);
  }

  if (req.mode === 'topic') {
    const level = req.level ?? 0;
    const level0 = input.clusters.filter((c) => c.level === level);
    const members = new Map<string, typeof docs>();
    for (const d of docs) {
      const id = input.docClusters.get(d.docId)?.[level];
      if (id !== undefined) (members.get(id) ?? members.set(id, []).get(id)!).push(d);
    }
    const vec = new Map<string, Map<string, number>>();
    for (const [id, ds] of members) {
      const v = new Map<string, number>();
      for (const d of ds) for (const t of new Set(d.tags)) bump(v, t);
      vec.set(id, v);
    }
    const nodes: EntityNode[] = level0.filter((c) => members.has(c.id)).map((c) => ({ id: c.id, label: c.aiLabel?.text ?? c.topTerms.slice(0, 3).join(', '), count: members.get(c.id)!.length, years: bins(members.get(c.id)!), colorKey: c.id, group: level > 0 ? (c.parent ?? '') : '' }));
    const edges: EntityEdge[] = [];
    const norm = (v: Map<string, number>) => Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0));
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = vec.get(nodes[i]!.id)!;
        const b = vec.get(nodes[j]!.id)!;
        let dot = 0;
        let shared = 0;
        for (const [t, x] of a) {
          const y = b.get(t);
          if (y !== undefined) {
            dot += x * y;
            shared += Math.min(x, y);
          }
        }
        if (dot > 0) edges.push({ a: nodes[i]!.id, b: nodes[j]!.id, w: dot / (norm(a) * norm(b)), n: shared });
      }
    }
    if (edges.length === 0) {
      // No tags to compare: the closest topics in the Panorama are the related ones.
      const at = new Map(level0.map((c) => [c.id, c.centroid]));
      for (const a of nodes) {
        const near = nodes.filter((b) => b.id !== a.id).map((b) => ({ b, d: Math.hypot(at.get(a.id)!.x - at.get(b.id)!.x, at.get(a.id)!.y - at.get(b.id)!.y) })).sort((x, y) => x.d - y.d).slice(0, 3);
        for (const { b } of near) if (a.id < b.id || !near.some((x) => x.b.id === a.id)) edges.push({ a: a.id, b: b.id, w: 0.3, n: 0 });
      }
    }
    return finish(nodes, edges);
  }

  // Authors.
  const names = new Map<string, Map<string, number>>();
  const mine = new Map<string, typeof docs>();
  const co = new Map<string, number>();
  for (const d of docs) {
    const keys = new Set<string>();
    for (const name of d.authors) {
      const k = resolveAuthor(name, aliases);
      if (k === '') continue;
      keys.add(k);
      bump(names.get(k) ?? names.set(k, new Map()).get(k)!, name);
    }
    for (const k of keys) (mine.get(k) ?? mine.set(k, []).get(k)!).push(d);
    if (keys.size >= 2 && keys.size <= CONSORTIUM) {
      const list = [...keys].sort();
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) bump(co, `${list[i]}\u0000${list[j]}`);
    }
  }
  const maxCo = Math.max(1, ...co.values());
  const nodes: EntityNode[] = [];
  for (const [k, ds] of mine) {
    const forms = names.get(k)!;
    const topics = new Map<string, number>();
    for (const d of ds) {
      const c = input.docClusters.get(d.docId)?.[0];
      if (c !== undefined) bump(topics, c);
    }
    const variants = [...forms].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([n]) => n);
    nodes.push({ id: `author:${k}`, label: best(new Map([...forms].map(([n, c]) => [n, c * 1000 + n.length] as [string, number]))), count: ds.length, years: bins(ds), colorKey: best(topics), group: '', ...(variants.length > 1 ? { variants } : {}) });
  }
  const edges: EntityEdge[] = [];
  for (const [k, n] of co) {
    const [a, b] = k.split('\u0000') as [string, string];
    edges.push({ a: `author:${a}`, b: `author:${b}`, w: Math.log(1 + n) / Math.log(1 + maxCo), n });
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

/** Everything the derivation needs, loaded from the channels that exist. */
export async function loadDeriveInput(cap = 5000): Promise<DeriveInput> {
  const docs: Summary[] = [];
  for (let offset = 0; offset < cap; offset += 200) {
    const r = await rl.invoke('documents:list', { limit: 200, offset });
    docs.push(...r.items);
    if (docs.length >= r.total || r.items.length === 0) break;
  }
  const [tax, map] = await Promise.all([rl.invoke('taxonomy:get', {}), rl.invoke('graph:map', {}).catch(() => null)]);
  return { docs, tax: tax.nodes.map((n) => ({ id: n.id, label: n.label, parents: n.parents, implies: n.implies, status: n.status, color: n.color })), clusters: map?.clusters ?? [], docClusters: new Map((map?.points ?? []).map((p) => [p.docId, p.clusters])) };
}

const NO_CHANNEL = new Set(['UNKNOWN_CHANNEL', 'NOT_IMPLEMENTED']);

/**
 * The entity network of a mode. Asks the main process; while it does not know the channel, derives the same answer here.
 * `input` is loaded once by the caller and reused across requests (a change of the library drops it).
 */
export async function fetchEntityNetwork(req: EntityRequest, input: () => Promise<DeriveInput>, aliases: AuthorAliases): Promise<EntityNetwork> {
  try {
    const r = (await (rl.invoke as unknown as (c: string, p: unknown) => Promise<unknown>)('graph:entityNetwork', req)) as EntityNetwork;
    if (Array.isArray(r?.nodes) && Array.isArray(r?.edges)) return r;
  } catch (e) {
    if (!NO_CHANNEL.has(RlError.from(e).code)) throw e;
  }
  return deriveEntityNetwork(await input(), req, aliases);
}
