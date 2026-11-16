import type { TaxonomyFile, TaxonomyView } from '@rl/core';
import type { DocInfo } from './common.js';
import { canonical } from '../store.js';
import { expandTags } from './taxonomy-ops.js';

/**
 * The taxonomy as the interface sees it, with how many documents carry each node:
 * `direct` (tagged with it), `implied` (directly or through implications), `subtree` (it or any descendant).
 * Missing documents (file gone) are not counted.
 */
export function buildTaxonomyView(tax: TaxonomyFile, docs: readonly DocInfo[]): TaxonomyView {
  const nodes = tax.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const closure = new Map<string, string[]>();
  const closureOf = (id: string): string[] => {
    let c = closure.get(id);
    if (!c) closure.set(id, (c = expandTags(nodes, [id])));
    return c;
  };
  const ancestors = new Map<string, string[]>();
  const ancestorsOf = (id: string): string[] => {
    let a = ancestors.get(id);
    if (a) return a;
    const seen = new Set<string>();
    const stack = [...(byId.get(id)?.parents ?? [])];
    while (stack.length > 0) {
      const p = stack.pop() as string;
      if (seen.has(p)) continue;
      seen.add(p);
      stack.push(...(byId.get(p)?.parents ?? []));
    }
    ancestors.set(id, (a = [...seen]));
    return a;
  };

  const direct = new Map<string, number>();
  const implied = new Map<string, number>();
  const subtree = new Map<string, number>();
  const bump = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) ?? 0) + 1);
  for (const d of docs) {
    if (d.missing) continue;
    const own = [...new Set(d.tags)];
    for (const t of own) bump(direct, t);
    const all = new Set<string>();
    for (const t of own) for (const x of closureOf(t)) all.add(x);
    for (const t of all) bump(implied, t);
    const up = new Set<string>(all);
    for (const t of all) for (const a of ancestorsOf(t)) up.add(a);
    for (const t of up) bump(subtree, t);
  }

  return {
    revision: tax.revision,
    nodes: nodes.map(({ legacy: _legacy, ...n }) => ({
      ...n,
      counts: { direct: direct.get(n.id) ?? 0, implied: implied.get(n.id) ?? 0, subtree: subtree.get(n.id) ?? 0 },
    })),
    documentTypes: tax.documentTypes,
    venues: tax.venues,
  };
}

/**
 * Nodes whose search terms or implications changed between two taxonomies: the changed nodes themselves and
 * every node that implies one of them (directly or not), seen in either version.
 */
export function affectedNodeIds(before: TaxonomyFile, after: TaxonomyFile): Set<string> {
  // Only what the index reads: the label and aliases (search terms) and the implications (indexed tags).
  const key = (n: TaxonomyFile['nodes'][number]) => canonical({ label: n.label, aliases: n.aliases, implies: n.implies });
  const b = new Map(before.nodes.map((n) => [n.id, key(n)]));
  const a = new Map(after.nodes.map((n) => [n.id, key(n)]));
  const changed = new Set<string>();
  for (const [id, c] of a) if (b.get(id) !== c) changed.add(id);
  for (const id of b.keys()) if (!a.has(id)) changed.add(id);
  if (changed.size === 0) return changed;
  const out = new Set(changed);
  for (const tax of [before, after]) {
    for (const n of tax.nodes) {
      if (expandTags(tax.nodes, [n.id]).some((x) => changed.has(x))) out.add(n.id);
    }
  }
  return out;
}

/** Documents (ids) that carry one of `nodes` directly: those whose index entry must be refreshed. */
export function docsWithAnyTag(docs: readonly DocInfo[], nodes: ReadonlySet<string>): string[] {
  if (nodes.size === 0) return [];
  return docs.filter((d) => d.tags.some((t) => nodes.has(t))).map((d) => d.id);
}
