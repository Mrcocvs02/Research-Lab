import type { TagHealthItem } from '@rl/core';

export type HealthKind = TagHealthItem['kind'];
export type ReviewFilter = 'merge' | 'twins' | 'parent' | 'name' | 'metadata';

/** The order of the chips of the health strip (D-494). */
export const HEALTH_ORDER: readonly HealthKind[] = ['dupes', 'twins', 'singletons', 'generic', 'orphans', 'multiparent', 'onevalue', 'styles', 'metadata', 'unused', 'depth'];

/** Where a click on a chip goes: the review list (filtered), the tree (filtered to the tags behind the count) or a step of the cleanup. */
export type HealthTarget = { to: 'review'; filter: ReviewFilter } | { to: 'tree'; ids: string[] } | { to: 'cleanup'; step: 1 | 2 | 3 | 4 | 5 };

export function healthTarget(item: TagHealthItem): HealthTarget {
  switch (item.kind) {
    case 'dupes':
      return { to: 'review', filter: 'merge' };
    case 'twins':
      return { to: 'review', filter: 'twins' };
    case 'metadata':
      return { to: 'review', filter: 'metadata' };
    case 'styles':
      return { to: 'review', filter: 'name' };
    case 'onevalue':
    case 'depth':
      return { to: 'cleanup', step: 4 };
    default:
      return { to: 'tree', ids: item.ids };
  }
}

/** The chips in the fixed order; a check the main side did not report is left out. */
export function healthChips(health: readonly TagHealthItem[]): TagHealthItem[] {
  const by = new Map(health.map((h) => [h.kind, h]));
  return HEALTH_ORDER.flatMap((k) => {
    const h = by.get(k);
    return h ? [h] : [];
  });
}

/** How many checks are past their threshold (the dot of "Manage tags" and the strip's summary). */
export const flaggedCount = (health: readonly TagHealthItem[]): number => health.filter((h) => h.flagged && h.count > 0).length;

/** A signature of the set of problems: a new import changes it, the same problems do not (the dot shows once per set). */
export const healthSignature = (health: readonly TagHealthItem[]): string =>
  health
    .filter((h) => h.flagged && h.count > 0)
    .map((h) => h.kind)
    .sort()
    .join(',');
