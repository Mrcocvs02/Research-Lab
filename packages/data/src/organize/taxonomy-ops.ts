import { AppError, itemIdSchema, type TaxonomyFile, type TaxonomyNode, type TaxonomyOp } from '@rl/core';
import { normalizeName, slugify } from '../normalize.js';

export interface OpsResult {
  taxonomy: TaxonomyFile;
  /** Id given to each `create` / `addType` / `addVenue` (`index` = position in the batch). */
  created: Array<{ index: number; id: string }>;
  /** Merged-away node -> the node that replaced it (already followed to the end of any chain). */
  redirects: Map<string, string>;
}

const bad = (index: number, message: string, details?: Record<string, unknown>) => new AppError('INVALID_REQUEST', `Operation ${index + 1}: ${message}`, { index, ...details });
const missing = (index: number, id: string) => new AppError('NOT_FOUND', `Operation ${index + 1}: unknown node`, { index, id });

const uniq = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** An id for a new item: the slug of its name, made valid (reserved names) and unique. */
function freshId(name: string, taken: Set<string>): string {
  let base = slugify(name);
  if (!itemIdSchema.safeParse(base).success) base = `n-${base}`;
  let id = base;
  for (let i = 2; taken.has(id) || !itemIdSchema.safeParse(id).success; i++) id = `${base.slice(0, 120)}-${i}`;
  return id;
}

/** Ids of the nodes reachable from `start` through `field`, `start` excluded; iterative (hostile depth). */
function reach(byId: Map<string, TaxonomyNode>, start: string, field: 'parents' | 'implies'): Set<string> {
  const seen = new Set<string>();
  const stack = [...(byId.get(start)?.[field] ?? [])];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of byId.get(id)?.[field] ?? []) if (!seen.has(next)) stack.push(next);
  }
  return seen;
}

/** Throws when `field` links form a cycle (including a node pointing at itself). */
export function assertAcyclic(nodes: TaxonomyNode[], field: 'parents' | 'implies', index = 0): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const state = new Map<string, 1 | 2>(); // 1 = on the current path, 2 = done
  for (const root of nodes) {
    if (state.get(root.id) === 2) continue;
    const stack: Array<{ id: string; next: number }> = [{ id: root.id, next: 0 }];
    state.set(root.id, 1);
    while (stack.length > 0) {
      const top = stack[stack.length - 1] as { id: string; next: number };
      const links = byId.get(top.id)?.[field] ?? [];
      if (top.next >= links.length) {
        state.set(top.id, 2);
        stack.pop();
        continue;
      }
      const to = links[top.next++] as string;
      if (!byId.has(to)) continue;
      const st = state.get(to);
      if (st === 1) throw bad(index, field === 'parents' ? 'this would make a node its own ancestor' : 'this would make implications circular', { cycle: field, id: to });
      if (st === undefined) {
        state.set(to, 1);
        stack.push({ id: to, next: 0 });
      }
    }
  }
}

/**
 * Tags a document effectively has: its own plus everything they imply (transitively). Computed, never stored.
 * Unknown ids are kept as they are.
 */
export function expandTags(nodes: ReadonlyArray<Pick<TaxonomyNode, 'id' | 'implies'>>, tags: readonly string[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Set<string>(tags);
  const stack = [...tags];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const next of byId.get(id)?.implies ?? []) {
      if (!out.has(next)) {
        out.add(next);
        stack.push(next);
      }
    }
  }
  return [...out];
}

/** Adds `extra` to `aliases` unless it equals the label or an alias already there (compared by normalised name). */
function withAliases(label: string, aliases: readonly string[], extra: readonly string[]): string[] {
  const seen = new Set<string>([normalizeName(label)]);
  const out: string[] = [];
  for (const a of [...aliases, ...extra]) {
    const key = normalizeName(a);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/**
 * Applies a batch of taxonomy operations to a copy of the taxonomy, in order. Pure: nothing is read or written;
 * any invalid operation throws and the caller keeps the original. `usage` = documents that carry each node directly
 * (needed by `delete`, "only when unused").
 */
export function applyTaxonomyOps(input: TaxonomyFile, ops: readonly TaxonomyOp[], usage: ReadonlyMap<string, number>, now: string): OpsResult {
  const tax: TaxonomyFile = structuredClone(input);
  const used = new Map(usage);
  const created: OpsResult['created'] = [];
  const redirects = new Map<string, string>();
  const byId = () => new Map(tax.nodes.map((n) => [n.id, n]));

  const node = (i: number, id: string): TaxonomyNode => {
    const n = byId().get(id);
    if (!n) throw missing(i, id);
    return n;
  };
  const existing = (i: number, ids: readonly string[], self?: string): string[] => {
    const map = byId();
    const out = uniq(ids);
    for (const id of out) {
      if (id === self) throw bad(i, 'a node cannot refer to itself', { id });
      if (!map.has(id)) throw missing(i, id);
    }
    return out;
  };

  ops.forEach((op, i) => {
    switch (op.op) {
      case 'create': {
        const taken = new Set(tax.nodes.map((n) => n.id));
        if (op.id !== undefined && taken.has(op.id)) throw new AppError('ALREADY_EXISTS', `Operation ${i + 1}: a node with this id exists`, { index: i, id: op.id });
        const id = op.id ?? freshId(op.label, taken);
        const parents = existing(i, op.parents ?? []);
        const implies = existing(i, op.implies ?? []);
        tax.nodes.push({
          id,
          label: op.label,
          parents,
          aliases: withAliases(op.label, [], op.aliases ?? []),
          implies,
          status: 'active',
          origin: 'user',
          ...(op.group ? { group: op.group } : {}),
          ...(op.color ? { color: op.color } : {}),
          createdAt: now,
        });
        created.push({ index: i, id });
        // A new node has no children yet, so only implications can close a cycle through the ones it names.
        break;
      }
      case 'rename': {
        const n = node(i, op.id);
        n.label = op.label;
        n.aliases = withAliases(op.label, n.aliases, []);
        break;
      }
      case 'move': {
        const n = node(i, op.id);
        n.parents = existing(i, op.parents, op.id);
        assertAcyclic(tax.nodes, 'parents', i);
        break;
      }
      case 'setAliases': {
        const n = node(i, op.id);
        n.aliases = withAliases(n.label, [], op.aliases);
        break;
      }
      case 'setImplies': {
        const n = node(i, op.id);
        n.implies = existing(i, op.implies, op.id);
        assertAcyclic(tax.nodes, 'implies', i);
        break;
      }
      case 'setColor': {
        const n = node(i, op.id);
        if (op.color === null) delete n.color;
        else n.color = op.color;
        break;
      }
      case 'setGroup': {
        const n = node(i, op.id);
        if (op.group === null) delete n.group;
        else n.group = op.group;
        break;
      }
      case 'merge': {
        if (op.from === op.into) throw bad(i, 'cannot merge a node into itself', { id: op.from });
        const from = node(i, op.from);
        const into = node(i, op.into);
        if (into.status === 'deprecated') throw bad(i, 'cannot merge into a deprecated node', { id: op.into });
        into.aliases = withAliases(into.label, into.aliases, [from.label, ...from.aliases]);
        into.implies = uniq([...into.implies, ...from.implies]).filter((x) => x !== into.id && x !== from.id);
        into.mergedFrom = uniq([...(into.mergedFrom ?? []), from.id, ...(from.mergedFrom ?? [])]);
        tax.nodes = tax.nodes.filter((n) => n.id !== from.id);
        for (const n of tax.nodes) {
          if (n.parents.includes(from.id)) n.parents = uniq(n.parents.map((p) => (p === from.id ? into.id : p))).filter((p) => p !== n.id);
          if (n.implies.includes(from.id)) n.implies = uniq(n.implies.map((p) => (p === from.id ? into.id : p))).filter((p) => p !== n.id);
        }
        used.set(into.id, (used.get(into.id) ?? 0) + (used.get(from.id) ?? 0));
        used.delete(from.id);
        for (const [k, v] of redirects) if (v === from.id) redirects.set(k, into.id);
        redirects.set(from.id, into.id);
        // Re-pointing links can close a cycle that was not there before (e.g. merging a node into its own descendant's implication).
        assertAcyclic(tax.nodes, 'parents', i);
        assertAcyclic(tax.nodes, 'implies', i);
        break;
      }
      case 'deprecate': {
        node(i, op.id).status = 'deprecated';
        break;
      }
      case 'restore': {
        node(i, op.id).status = 'active';
        break;
      }
      case 'delete': {
        const n = node(i, op.id);
        const documents = used.get(n.id) ?? 0;
        const referencedBy = tax.nodes.filter((m) => m.parents.includes(n.id) || m.implies.includes(n.id)).map((m) => m.id);
        if (documents > 0 || referencedBy.length > 0) {
          throw new AppError('CONFLICT', `Operation ${i + 1}: the node is in use`, { conflict: 'in-use', index: i, id: n.id, documents, referencedBy: referencedBy.slice(0, 20) });
        }
        tax.nodes = tax.nodes.filter((m) => m.id !== n.id);
        break;
      }
      case 'addType': {
        const taken = new Set(tax.documentTypes.map((t) => t.id));
        if (op.id !== undefined && taken.has(op.id)) throw new AppError('ALREADY_EXISTS', `Operation ${i + 1}: a type with this id exists`, { index: i, id: op.id });
        const id = op.id ?? freshId(op.label, taken);
        tax.documentTypes.push({ id, label: op.label, aliases: withAliases(op.label, [], op.aliases ?? []) });
        created.push({ index: i, id });
        break;
      }
      case 'addVenue': {
        const taken = new Set(tax.venues.map((v) => v.id));
        if (op.id !== undefined && taken.has(op.id)) throw new AppError('ALREADY_EXISTS', `Operation ${i + 1}: a venue with this id exists`, { index: i, id: op.id });
        const id = op.id ?? freshId(op.name, taken);
        tax.venues.push({ id, name: op.name, aliases: withAliases(op.name, [], op.aliases ?? []) });
        created.push({ index: i, id });
        break;
      }
    }
  });
  return { taxonomy: tax, created, redirects };
}

export { reach as reachableIds };
