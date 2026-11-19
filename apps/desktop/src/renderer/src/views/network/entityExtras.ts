import { nodeRadius } from './entityLayout';
import type { EntityEdge, EntityNode } from './entityTypes';

/** "Size by" (⋯ in the networks of tags, topics and authors): the documents of the entity, its links, or all the same. */
export type SizeBy = 'docs' | 'links' | 'equal';
export const SIZE_BY: readonly SizeBy[] = ['docs', 'links', 'equal'];

/** The radius in pixels of a node for the chosen measure (`max*` are the largest values in the network). */
export function sizedRadius(by: SizeBy, count: number, links: number, maxCount: number, maxLinks: number): number {
  if (by === 'equal') return 8;
  return by === 'links' ? nodeRadius(links, maxLinks) : nodeRadius(count, maxCount);
}

/** Links of each entity (the edges it is on), by id. */
export function degrees(edges: ReadonlyArray<Pick<EntityEdge, 'a' | 'b'>>): Map<string, number> {
  const d = new Map<string, number>();
  for (const e of edges) {
    d.set(e.a, (d.get(e.a) ?? 0) + 1);
    d.set(e.b, (d.get(e.b) ?? 0) + 1);
  }
  return d;
}

/**
 * "Show shared themes" (authors): light edges between authors with the same main topic that never wrote together. To keep it
 * cheap and readable each author is joined to the next two of its topic (by documents), so at most two edges per author.
 */
export function themeEdges(nodes: readonly EntityNode[], edges: ReadonlyArray<Pick<EntityEdge, 'a' | 'b'>>): Array<{ a: string; b: string; w: number }> {
  const linked = new Set<string>();
  for (const e of edges) linked.add(e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`);
  const byTopic = new Map<string, EntityNode[]>();
  for (const n of nodes) if (n.colorKey !== '' && !n.colorKey.startsWith('#')) (byTopic.get(n.colorKey) ?? byTopic.set(n.colorKey, []).get(n.colorKey)!).push(n);
  const out: Array<{ a: string; b: string; w: number }> = [];
  for (const list of byTopic.values()) {
    list.sort((x, y) => y.count - x.count || (x.id < y.id ? -1 : 1));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j <= i + 2 && j < list.length; j++) {
        const a = list[i]!.id;
        const b = list[j]!.id;
        if (!linked.has(a < b ? `${a}|${b}` : `${b}|${a}`)) out.push({ a, b, w: 0.15 });
      }
    }
  }
  return out;
}

/** Entities that did not make the cap of the network and match the text: the "Go to" field still finds them (shown alone, without links). */
export function missingMatches<T extends { id: string; label: string }>(all: readonly T[], present: ReadonlySet<string>, text: string, limit = 8): T[] {
  const f = text.toLowerCase();
  return all.filter((x) => !present.has(x.id) && x.label.toLowerCase().includes(f)).slice(0, limit);
}
