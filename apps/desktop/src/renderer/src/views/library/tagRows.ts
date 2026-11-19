import type { TaxonomyModel } from './taxonomyModel';

/** The tags of a document laid out in rows by family (D-493, §19.1.8). */
export interface TagRow {
  key: string;
  /** Label of the family; null for the loose tags (no family) and for a library without families. */
  family: string | null;
  /** The keywords family: shown folded behind "+N keywords". */
  keywords: boolean;
  ids: string[];
}

/** Root of a tag on its first-parent chain (bounded), and the family it belongs to when that root is a family. */
function familyOf(model: TaxonomyModel, id: string): { root: string; kind: 'one' | 'many' | 'keywords' | null; label: string } {
  let cur = id;
  for (let i = 0; i < 20; i++) {
    const p = model.byId.get(cur)?.parents.find((x) => model.byId.has(x) && x !== cur);
    if (p === undefined) break;
    cur = p;
  }
  const n = model.byId.get(cur);
  return { root: cur, kind: n?.family ?? null, label: n?.label ?? '' };
}

/** Families first (by name), then the loose tags, then the keywords; each tag keeps the order of the document. Pure. */
export function tagRowsOf(model: TaxonomyModel, ids: readonly string[]): TagRow[] {
  const rows = new Map<string, TagRow>();
  for (const id of ids) {
    const f = familyOf(model, id);
    const key = f.kind === null ? '' : f.root;
    const row = rows.get(key) ?? { key: key || '_loose', family: f.kind === null ? null : f.label, keywords: f.kind === 'keywords', ids: [] };
    row.ids.push(id);
    rows.set(key, row);
  }
  const rank = (r: TagRow) => (r.keywords ? 2 : r.family === null ? 1 : 0);
  return [...rows.values()].sort((a, b) => rank(a) - rank(b) || (a.family ?? '').localeCompare(b.family ?? ''));
}

/** Adding a value to a family that takes one value replaces the value it has: the tags to remove along with the added one. */
export function oneFamilyRemoval(model: TaxonomyModel, current: readonly string[], add: string): { remove?: string[] } {
  const f = familyOf(model, add);
  if (f.kind !== 'one') return {};
  const remove = current.filter((t) => t !== add && familyOf(model, t).root === f.root && model.byId.get(t)?.family === undefined);
  return remove.length > 0 ? { remove } : {};
}
