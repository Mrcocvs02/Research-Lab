import type { TaxonomyNodeView } from '@rl/core';

/** Folds case and accents so "Réseau" is found by "reseau". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().trim();
}

export interface TaxonomyModel {
  nodes: TaxonomyNodeView[];
  byId: Map<string, TaxonomyNodeView>;
  /** Children by parent id; a node with several parents is listed under each. */
  children: Map<string, string[]>;
  /** Nodes without a (known) parent. */
  roots: string[];
}

const byLabel = (byId: Map<string, TaxonomyNodeView>) => (a: string, b: string) =>
  (byId.get(a)?.label ?? a).localeCompare(byId.get(b)?.label ?? b, undefined, { sensitivity: 'base', numeric: true });

export function buildModel(nodes: TaxonomyNodeView[]): TaxonomyModel {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const n of nodes) {
    const parents = n.parents.filter((p) => byId.has(p) && p !== n.id);
    if (parents.length === 0) roots.push(n.id);
    for (const p of parents) children.set(p, [...(children.get(p) ?? []), n.id]);
  }
  const cmp = byLabel(byId);
  roots.sort(cmp);
  for (const list of children.values()) list.sort(cmp);
  return { nodes, byId, children, roots };
}

export interface TreeRow {
  /** Unique even when a node shows up under several parents: the ids from the root, joined. */
  key: string;
  id: string;
  /** The parent this row hangs under (null for a root). */
  parentId: string | null;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

/** The visible rows of the tree for the given expanded keys. `hide` leaves nodes (and their subtrees) out. */
export function flattenTree(model: TaxonomyModel, expanded: ReadonlySet<string> | 'all', hide: (n: TaxonomyNodeView) => boolean = () => false): TreeRow[] {
  const out: TreeRow[] = [];
  const walk = (id: string, parentId: string | null, depth: number, prefix: string, trail: string[]) => {
    const node = model.byId.get(id);
    if (!node || hide(node) || trail.includes(id)) return;
    const key = prefix ? `${prefix}/${id}` : id;
    const kids = (model.children.get(id) ?? []).filter((c) => {
      const n = model.byId.get(c);
      return n && !hide(n) && !trail.includes(c) && c !== id;
    });
    const open = expanded === 'all' || expanded.has(key);
    out.push({ key, id, parentId, depth, hasChildren: kids.length > 0, expanded: open });
    if (open) for (const c of kids) walk(c, id, depth + 1, key, [...trail, id]);
  };
  for (const r of model.roots) walk(r, null, 0, '', []);
  return out;
}

/** The node and everything below it (by `parents`). */
export function descendants(model: TaxonomyModel, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    for (const c of model.children.get(cur) ?? []) stack.push(c);
  }
  return out;
}

/** True when giving `id` these parents would make a cycle (a parent is the node itself or one of its descendants). */
export function wouldCycle(model: TaxonomyModel, id: string, parents: string[]): boolean {
  const below = descendants(model, id);
  return parents.some((p) => below.has(p));
}

/** The same check for implications (`implies` edges), which are separate from the tree edges. */
export function impliesCycle(model: TaxonomyModel, id: string, implies: string[]): boolean {
  const seen = new Set<string>();
  const stack = [...implies];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === id) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const n of model.byId.get(cur)?.implies ?? []) stack.push(n);
  }
  return false;
}

/** Ancestors path labels, first parent only: "Methods › Statistics". */
export function pathLabel(model: TaxonomyModel, id: string): string {
  const parts: string[] = [];
  const seen = new Set<string>([id]);
  let cur = model.byId.get(id);
  while (cur) {
    const parent: string | undefined = cur.parents.find((p) => model.byId.has(p) && !seen.has(p));
    if (!parent) break;
    seen.add(parent);
    parts.unshift(model.byId.get(parent)!.label);
    cur = model.byId.get(parent);
  }
  return parts.join(' › ');
}

/** The tags a document really has: its own plus whatever they imply, transitively. */
export function impliedClosure(model: TaxonomyModel, tags: readonly string[]): Set<string> {
  const out = new Set<string>();
  const stack = [...tags];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    for (const n of model.byId.get(cur)?.implies ?? []) stack.push(n);
  }
  return out;
}

/** Does a document with these tags match the tag `id`? It does when it has it or a descendant of it (implications counted). */
export function docMatchesTag(model: TaxonomyModel, docTags: readonly string[], id: string): boolean {
  const closure = impliedClosure(model, docTags);
  if (closure.has(id)) return true;
  for (const d of descendants(model, id)) if (closure.has(d)) return true;
  return false;
}

/** Is `node` the target of a stale reference (merged away)? Resolves it to the surviving node. */
export function resolveId(model: TaxonomyModel, id: string): string {
  if (model.byId.has(id)) return id;
  for (const n of model.nodes) if (n.mergedFrom?.includes(id)) return n.id;
  return id;
}

/** Can the node be deleted right now (the backend refuses used nodes and nodes other nodes refer to)? */
export function canDelete(model: TaxonomyModel, node: TaxonomyNodeView): boolean {
  if (node.counts.direct > 0) return false;
  if ((model.children.get(node.id) ?? []).length > 0) return false;
  return !model.nodes.some((n) => n.implies.includes(node.id));
}

/** New parents for a node dropped on `target` (null = the empty area, i.e. out of the parent it was dragged from). */
export function parentsAfterDrop(node: Pick<TaxonomyNodeView, 'parents'>, fromParent: string | null, target: string | null): string[] {
  const rest = node.parents.filter((p) => p !== fromParent);
  if (target === null) return rest;
  return rest.includes(target) ? rest : [...rest, target];
}
