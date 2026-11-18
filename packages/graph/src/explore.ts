import { louvain, symmetrize } from './cluster.js';
import type { Edge } from './types.js';

/** What exploration needs of a document (tags: implied tags included). */
export interface ExploreDoc {
  id: string;
  title: string;
  year: number | null;
  authors: string[];
  venue?: string | undefined;
  venueId?: string | undefined;
  tags: string[];
}

export interface ExploreTaxonomy {
  nodes: Array<{ id: string; label: string; parents: string[]; status?: string | undefined }>;
  venues: Array<{ id: string; name: string }>;
}

export type ExploreDimension = 'topic' | 'author' | 'venue';
export type ExploreKind = 'topic' | 'author-group' | 'author' | 'venue-area' | 'venue';

export interface ExploreNode {
  id: string;
  label: string;
  kind: ExploreKind;
  count: number;
  hasChildren: boolean;
}

export interface PathStep {
  id: string;
  label: string;
}

export interface ExploreIndex {
  /** Children of a node (null: the top level) and the path to it; null for an unknown node. */
  level(dimension: ExploreDimension, parentId: string | null): { nodes: ExploreNode[]; path: PathStep[] } | null;
  /** Documents under a node, most relevant first; null for an unknown node. */
  documents(dimension: ExploreDimension, id: string, limit: number, offset: number): { docIds: string[]; total: number } | null;
  /** Nodes of another dimension that share documents with a node, strongest first (Jaccard of the document sets). */
  related(from: { dimension: ExploreDimension; id: string }, to: ExploreDimension, limit: number): Array<ExploreNode & { score: number; path: PathStep[] }> | null;
}

export const MAX_EXPLORE_NODES = 500;
const MAX_AUTHORS_FOR_PAIRS = 30;
/** Distinct co-author pairs kept for grouping (memory and time of the main process on a huge or crafted library); past it known pairs still count up. */
const MAX_AUTHOR_EDGES = 300_000;

/** Everything one dimension offers; documents are indexes into the document list. */
interface Dim {
  node(id: string): ExploreNode | undefined;
  children(id: string | null): ExploreNode[] | undefined;
  docs(id: string): number[] | undefined;
  path(id: string): PathStep[];
  /** Nodes that `related` may return. */
  candidates(): ExploreNode[];
}

const byCount = (a: ExploreNode, b: ExploreNode) => b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0) || (a.id < b.id ? -1 : 1);

/** Lower case, no accents, letters and digits only. */
export const fold = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Key of an author: the family name plus the first initial ("Surname, Given" and "Given Surname" are the same person,
 * "J. Smith" and "John Smith" too). Empty for a name with nothing in it.
 */
export function authorKey(name: string): string {
  const comma = name.indexOf(',');
  const parts = (comma >= 0 ? `${name.slice(comma + 1)} ${name.slice(0, comma)}` : name)
    .split(/\s+/)
    .map(fold)
    .filter((p) => p !== '');
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0] as string;
  const family = comma >= 0 ? fold(name.slice(0, comma)) : (parts[parts.length - 1] as string);
  const given = comma >= 0 ? (parts[0] as string) : (parts[0] as string);
  return `${family} ${given.charAt(0)}`;
}

/** The user's corrections to the authors (D-386, D-454): keys merged into another, and keys split into one node per written form. */
export interface AuthorAliases {
  merge: Readonly<Record<string, string>>;
  split: readonly string[];
}
export const NO_ALIASES: AuthorAliases = { merge: {}, split: [] };

/** The key of an author after the user's corrections: merged into another, or split by the full written form. */
export function resolveAuthor(name: string, aliases: AuthorAliases = NO_ALIASES): string {
  const k = authorKey(name);
  if (k === '') return '';
  const split = aliases.split.includes(k) ? `${k}|${fold(name)}` : k;
  return Object.hasOwn(aliases.merge, split) ? (aliases.merge[split] as string) : split;
}

function mostCommon(counts: Map<string, number>): string {
  let best = '';
  let bc = -1;
  for (const [k, c] of counts) if (c > bc || (c === bc && k < best)) [best, bc] = [k, c];
  return best;
}

function topicDim(docs: readonly ExploreDoc[], tax: ExploreTaxonomy): Dim {
  const recent = recency(docs);
  const nodes = new Map(tax.nodes.filter((n) => n.status !== 'deprecated').map((n) => [n.id, n]));
  const parentsOf = (id: string) => (nodes.get(id)?.parents ?? []).filter((p) => nodes.has(p));
  const members = new Map<string, Set<number>>();
  const direct = new Map<string, Set<number>>();
  const upCache = new Map<string, string[]>();
  const up = (id: string): string[] => {
    let r = upCache.get(id);
    if (r) return r;
    const seen = new Set<string>([id]);
    const stack = [id];
    while (stack.length > 0) for (const p of parentsOf(stack.pop() as string)) if (!seen.has(p)) (seen.add(p), stack.push(p));
    upCache.set(id, (r = [...seen]));
    return r;
  };
  docs.forEach((d, i) => {
    for (const t of d.tags) {
      if (!nodes.has(t)) continue;
      (direct.get(t) ?? direct.set(t, new Set()).get(t))!.add(i);
      for (const a of up(t)) (members.get(a) ?? members.set(a, new Set()).get(a))!.add(i);
    }
  });
  const kids = new Map<string, string[]>();
  const roots: string[] = [];
  for (const id of [...members.keys()].sort()) {
    const ps = parentsOf(id).filter((p) => members.has(p));
    if (ps.length === 0) roots.push(id);
    for (const p of ps) (kids.get(p) ?? kids.set(p, []).get(p))!.push(id);
  }
  const make = (id: string): ExploreNode => ({ id, label: (nodes.get(id) as { label: string }).label, kind: 'topic', count: (members.get(id) as Set<number>).size, hasChildren: (kids.get(id)?.length ?? 0) > 0 });
  const depthCache = new Map<string, number>();
  const depth = (id: string, guard = new Set<string>()): number => {
    const c = depthCache.get(id);
    if (c !== undefined) return c;
    if (guard.has(id)) return 0;
    guard.add(id);
    const ps = parentsOf(id).filter((p) => members.has(p));
    const d = ps.length === 0 ? 0 : 1 + Math.min(...ps.map((p) => depth(p, guard)));
    depthCache.set(id, d);
    return d;
  };
  return {
    node: (id) => (members.has(id) ? make(id) : undefined),
    children: (id) => (id === null ? roots : members.has(id) ? (kids.get(id) ?? []) : undefined)?.map(make),
    docs(id) {
      const m = members.get(id);
      if (!m) return undefined;
      const d = direct.get(id);
      // The documents tagged with the node itself first, then those of its descendants.
      return [...m].sort((p, q) => Number(d?.has(q) ?? false) - Number(d?.has(p) ?? false) || recent(p, q));
    },
    path(id) {
      const out: PathStep[] = [];
      let cur: string | undefined = id;
      for (let guard = 0; cur !== undefined && guard < 64; guard++) {
        out.unshift({ id: cur, label: (nodes.get(cur) as { label: string }).label });
        const ps: string[] = parentsOf(cur).filter((p) => members.has(p));
        cur = ps.sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : 1))[0];
      }
      return out;
    },
    candidates: () => [...members.keys()].sort().map(make),
  };
}

/**
 * Louvain groups of keys (nodes in `keys` order, `edges` by index): groups of two or more are named from their most used
 * member (`idOf`); the keys left alone go together to `otherId`.
 */
function groupKeys(keys: string[], edges: Edge[], countOf: (k: string) => number, idOf: (top: string) => string, otherId: string): { members: Map<string, string[]>; of: Map<string, string> } {
  const groups = new Map<number, string[]>();
  louvain(keys.length, symmetrize(edges), 1).forEach((c, i) => (groups.get(c) ?? groups.set(c, []).get(c)!).push(keys[i] as string));
  const members = new Map<string, string[]>();
  const of = new Map<string, string>();
  const other: string[] = [];
  for (const list of [...groups.values()].sort((p, q) => (p[0] as string).localeCompare(q[0] as string))) {
    if (list.length < 2) {
      other.push(...list);
      continue;
    }
    list.sort((p, q) => countOf(q) - countOf(p) || (p < q ? -1 : 1));
    const id = idOf(list[0] as string);
    members.set(id, list);
    for (const m of list) of.set(m, id);
  }
  if (other.length > 0) {
    members.set(otherId, other.sort());
    for (const m of other) of.set(m, otherId);
  }
  return { members, of };
}

function authorDim(docs: readonly ExploreDoc[], aliases: AuthorAliases): Dim {
  const authorKey = (name: string) => resolveAuthor(name, aliases);
  const byAuthor = new Map<string, Set<number>>();
  const names = new Map<string, Map<string, number>>();
  docs.forEach((d, i) => {
    for (const a of d.authors) {
      const key = authorKey(a);
      if (key === '') continue;
      (byAuthor.get(key) ?? byAuthor.set(key, new Set()).get(key))!.add(i);
      const nm = names.get(key) ?? names.set(key, new Map()).get(key)!;
      nm.set(a.trim(), (nm.get(a.trim()) ?? 0) + 1);
    }
  });
  const keys = [...byAuthor.keys()].sort();
  const at = new Map(keys.map((k, i) => [k, i]));
  // Repeated co-authorship weighs more: parallel edges are summed as they are met.
  const weight = new Map<number, Edge>();
  docs.forEach((d) => {
    const ks = [...new Set(d.authors.map(authorKey).filter((k) => k !== ''))];
    if (ks.length > MAX_AUTHORS_FOR_PAIRS) return;
    for (let p = 0; p < ks.length; p++) {
      for (let q = p + 1; q < ks.length; q++) {
        const x = at.get(ks[p] as string) as number;
        const y = at.get(ks[q] as string) as number;
        const a = Math.min(x, y);
        const b = Math.max(x, y);
        const key = a * 4_294_967_296 + b;
        const cur = weight.get(key);
        if (cur) cur.w += 1;
        else if (weight.size < MAX_AUTHOR_EDGES) weight.set(key, { a, b, w: 1 });
      }
    }
  });
  const countOf = (k: string) => (byAuthor.get(k) as Set<number>).size;
  const { members: groupMembers, of: groupOf } = groupKeys(keys, [...weight.values()], countOf, (top) => `group:${top}`, 'group:other');
  const display = (k: string) => mostCommon(names.get(k) as Map<string, number>);
  const groupDocs = (id: string) => {
    const s = new Set<number>();
    for (const m of groupMembers.get(id) ?? []) for (const d of byAuthor.get(m) as Set<number>) s.add(d);
    return s;
  };
  const makeGroup = (id: string): ExploreNode => {
    const m = groupMembers.get(id) as string[];
    return { id, label: id === 'group:other' ? 'Other authors' : `${display(m[0] as string).slice(0, 280)} +${m.length - 1}`, kind: 'author-group', count: groupDocs(id).size, hasChildren: true };
  };
  const makeAuthor = (key: string): ExploreNode => ({ id: `author:${key}`, label: display(key), kind: 'author', count: countOf(key), hasChildren: false });
  const keyOf = (id: string) => (id.startsWith('author:') && byAuthor.has(id.slice(7)) ? id.slice(7) : undefined);
  return {
    node: (id) => (groupMembers.has(id) ? makeGroup(id) : keyOf(id) !== undefined ? makeAuthor(keyOf(id) as string) : undefined),
    children(id) {
      if (id === null) return [...groupMembers.keys()].map(makeGroup);
      const m = groupMembers.get(id);
      return m ? m.map(makeAuthor) : keyOf(id) !== undefined ? [] : undefined;
    },
    docs(id) {
      const k = keyOf(id);
      const set = k !== undefined ? (byAuthor.get(k) as Set<number>) : groupMembers.has(id) ? groupDocs(id) : undefined;
      return set ? [...set] : undefined;
    },
    path(id) {
      const k = keyOf(id);
      if (k === undefined) return [{ id, label: makeGroup(id).label }];
      const g = groupOf.get(k) as string;
      return [{ id: g, label: makeGroup(g).label }, { id, label: display(k) }];
    },
    candidates: () => keys.map(makeAuthor),
  };
}

function venueDim(docs: readonly ExploreDoc[], tax: ExploreTaxonomy): Dim {
  const venueNames = new Map(tax.venues.map((v) => [v.id, v.name]));
  const tagLabels = new Map(tax.nodes.map((n) => [n.id, n.label]));
  const byVenue = new Map<string, Set<number>>();
  const names = new Map<string, Map<string, number>>();
  const tagCount = new Map<string, Map<string, number>>();
  docs.forEach((d, i) => {
    let key: string | undefined;
    let label: string | undefined;
    if (d.venueId && venueNames.has(d.venueId)) [key, label] = [`venue:${d.venueId}`, venueNames.get(d.venueId)];
    else if (d.venue && fold(d.venue) !== '') [key, label] = [`venue:${fold(d.venue).slice(0, 400)}`, d.venue.trim().slice(0, 290)];
    if (key === undefined || label === undefined) return;
    (byVenue.get(key) ?? byVenue.set(key, new Set()).get(key))!.add(i);
    const nm = names.get(key) ?? names.set(key, new Map()).get(key)!;
    nm.set(label, (nm.get(label) ?? 0) + 1);
    const tc = tagCount.get(key) ?? tagCount.set(key, new Map()).get(key)!;
    for (const t of d.tags) tc.set(t, (tc.get(t) ?? 0) + 1);
  });
  const keys = [...byVenue.keys()].sort();
  const at = new Map(keys.map((k, i) => [k, i]));
  // Venues are linked by the cosine of their tag profiles (the tags of the documents they published).
  const norm = keys.map((k) => Math.sqrt([...(tagCount.get(k) as Map<string, number>).values()].reduce((s, c) => s + c * c, 0)));
  const byTag = new Map<string, number[]>();
  keys.forEach((k, i) => {
    for (const t of (tagCount.get(k) as Map<string, number>).keys()) (byTag.get(t) ?? byTag.set(t, []).get(t))!.push(i);
  });
  const edges: Edge[] = [];
  keys.forEach((k, i) => {
    const dot = new Map<number, number>();
    for (const [t, c] of tagCount.get(k) as Map<string, number>) for (const j of byTag.get(t) as number[]) if (j !== i) dot.set(j, (dot.get(j) ?? 0) + c * ((tagCount.get(keys[j] as string) as Map<string, number>).get(t) as number));
    const near = [...dot.entries()]
      .map(([j, d]) => ({ j, s: d / ((norm[i] as number) * (norm[j] as number)) }))
      .filter((h) => h.s >= 0.3)
      .sort((p, q) => q.s - p.s || p.j - q.j)
      .slice(0, 5);
    for (const h of near) edges.push({ a: i, b: h.j, w: h.s });
  });
  const countOf = (k: string) => (byVenue.get(k) as Set<number>).size;
  const { members: areaMembers, of: areaOf } = groupKeys(keys, edges, countOf, (top) => `area:${top.slice(6)}`, 'area:other');
  const display = (k: string) => mostCommon(names.get(k) as Map<string, number>);
  const areaDocs = (id: string) => {
    const s = new Set<number>();
    for (const m of areaMembers.get(id) ?? []) for (const d of byVenue.get(m) as Set<number>) s.add(d);
    return s;
  };
  const areaLabel = (id: string): string => {
    if (id === 'area:other') return 'Other venues';
    const tags = new Map<string, number>();
    for (const m of areaMembers.get(id) as string[]) for (const [t, c] of tagCount.get(m) as Map<string, number>) tags.set(t, (tags.get(t) ?? 0) + c);
    const top = [...tags.entries()].filter(([t]) => tagLabels.has(t)).sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1)).slice(0, 2);
    return top.length > 0 ? top.map(([t]) => tagLabels.get(t)).join(' / ').slice(0, 290) : display((areaMembers.get(id) as string[])[0] as string);
  };
  const makeArea = (id: string): ExploreNode => ({ id, label: areaLabel(id), kind: 'venue-area', count: areaDocs(id).size, hasChildren: true });
  const makeVenue = (k: string): ExploreNode => ({ id: k, label: display(k), kind: 'venue', count: countOf(k), hasChildren: false });
  return {
    node: (id) => (areaMembers.has(id) ? makeArea(id) : byVenue.has(id) ? makeVenue(id) : undefined),
    children(id) {
      if (id === null) return [...areaMembers.keys()].map(makeArea);
      const m = areaMembers.get(id);
      return m ? m.map(makeVenue) : byVenue.has(id) ? [] : undefined;
    },
    docs(id) {
      const set = byVenue.get(id) ?? (areaMembers.has(id) ? areaDocs(id) : undefined);
      return set ? [...set] : undefined;
    },
    path(id) {
      if (!byVenue.has(id)) return [{ id, label: areaLabel(id) }];
      const a = areaOf.get(id) as string;
      return [{ id: a, label: areaLabel(a) }, { id, label: display(id) }];
    },
    candidates: () => keys.map(makeVenue),
  };
}

/** Orders document indexes most recent first, ties by title and id. */
const recency = (docs: readonly ExploreDoc[]) => (p: number, q: number): number => {
  const a = docs[p] as ExploreDoc;
  const b = docs[q] as ExploreDoc;
  return (b.year ?? 0) - (a.year ?? 0) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0) || a.id.localeCompare(b.id);
};

/** Lazily built indexes of the three dimensions over a list of documents. */
export function createExploreIndex(docs: readonly ExploreDoc[], taxonomy: ExploreTaxonomy, aliases: AuthorAliases = NO_ALIASES): ExploreIndex {
  const built: Partial<Record<ExploreDimension, Dim>> = {};
  const dim = (d: ExploreDimension): Dim => (built[d] ??= d === 'topic' ? topicDim(docs, taxonomy) : d === 'author' ? authorDim(docs, aliases) : venueDim(docs, taxonomy));
  const recent = recency(docs);
  const docsOf = (d: ExploreDimension, id: string): number[] | undefined => {
    const idx = dim(d).docs(id);
    // A topic lists the documents tagged with the node itself first (already ordered by the dimension), the rest by recency.
    return idx && (d === 'topic' ? idx : [...idx].sort(recent));
  };
  return {
    level(dimension, parentId) {
      const dm = dim(dimension);
      const nodes = dm.children(parentId);
      if (!nodes) return null;
      return { nodes: [...nodes].sort(byCount).slice(0, MAX_EXPLORE_NODES), path: parentId === null ? [] : dm.path(parentId) };
    },
    documents(dimension, id, limit, offset) {
      const idx = docsOf(dimension, id);
      if (!idx) return null;
      return { docIds: idx.slice(offset, offset + limit).map((i) => (docs[i] as ExploreDoc).id), total: idx.length };
    },
    related(from, to, limit) {
      const src = dim(from.dimension).docs(from.id);
      if (!src) return null;
      const set = new Set(src);
      const target = dim(to);
      const out: Array<ExploreNode & { score: number; path: PathStep[] }> = [];
      for (const c of target.candidates()) {
        if (to === from.dimension && c.id === from.id) continue;
        const members = target.docs(c.id) as number[];
        let inter = 0;
        for (const d of members) if (set.has(d)) inter++;
        if (inter === 0) continue;
        out.push({ ...c, score: inter / (set.size + members.length - inter), path: target.path(c.id) });
      }
      out.sort((p, q) => q.score - p.score || q.count - p.count || (p.id < q.id ? -1 : 1));
      return out.slice(0, limit);
    },
  };
}
