import type { TaxonomyFile } from '@rl/core';

type Keyed = { id: string };
type Snap = Record<string, unknown>;

function diffList<T extends Keyed>(before: T[], after: T[], before_: Snap, after_: Snap): boolean {
  const b = new Map(before.map((x) => [x.id, x]));
  const a = new Map(after.map((x) => [x.id, x]));
  let changed = false;
  for (const [id, item] of a) {
    const old = b.get(id);
    if (old === undefined || JSON.stringify(old) !== JSON.stringify(item)) {
      before_[id] = old ?? null;
      after_[id] = item;
      changed = true;
    }
  }
  for (const [id, item] of b) {
    if (!a.has(id)) {
      before_[id] = item;
      after_[id] = null;
      changed = true;
    }
  }
  return changed;
}

/**
 * Item-level difference between two taxonomy files, shaped for the change log:
 * for every added, changed or removed node / type / venue the item before (null if new)
 * and after (null if removed), so that a change can be undone. Null when nothing changed.
 */
export function diffTaxonomy(before: TaxonomyFile, after: TaxonomyFile): { before: Snap; after: Snap } | null {
  const out = { before: {} as Snap, after: {} as Snap };
  let changed = false;
  for (const key of ['nodes', 'documentTypes', 'venues'] as const) {
    const b: Snap = {};
    const a: Snap = {};
    if (diffList(before[key] as Keyed[], after[key] as Keyed[], b, a)) {
      out.before[key] = b;
      out.after[key] = a;
      changed = true;
    }
  }
  if (JSON.stringify(before.legacy ?? null) !== JSON.stringify(after.legacy ?? null)) {
    out.before['legacy'] = before.legacy ?? null;
    out.after['legacy'] = after.legacy ?? null;
    changed = true;
  }
  return changed ? out : null;
}
