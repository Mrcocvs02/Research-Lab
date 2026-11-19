import { describe, expect, it } from 'vitest';
import type { TagHealthItem } from '@rl/core';
import { flaggedCount, healthChips, healthSignature, healthTarget } from './tagHealthModel';

const item = (kind: TagHealthItem['kind'], count: number, flagged = count > 0, ids: string[] = []): TagHealthItem => ({ kind, count, flagged, ids });

describe('tag health strip', () => {
  it('orders the chips and leaves out unreported checks', () => {
    expect(healthChips([item('unused', 1), item('dupes', 2), item('zzz' as never, 1)]).map((h) => h.kind)).toEqual(['dupes', 'unused']);
  });
  it('sends each chip to the list, the tree or the cleanup', () => {
    expect(healthTarget(item('dupes', 3))).toEqual({ to: 'review', filter: 'merge' });
    expect(healthTarget(item('styles', 2))).toEqual({ to: 'review', filter: 'name' });
    expect(healthTarget(item('orphans', 2, true, ['a', 'b']))).toEqual({ to: 'tree', ids: ['a', 'b'] });
    expect(healthTarget(item('onevalue', 2))).toEqual({ to: 'cleanup', step: 4 });
  });
  it('counts only the flagged checks and signs the set', () => {
    const h = [item('dupes', 2), item('unused', 1, false), item('orphans', 4)];
    expect(flaggedCount(h)).toBe(2);
    expect(healthSignature(h)).toBe('dupes,orphans');
    expect(healthSignature([item('orphans', 4), item('dupes', 1)])).toBe('dupes,orphans');
  });
});
