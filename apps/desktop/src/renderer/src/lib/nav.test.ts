import { describe, expect, it } from 'vitest';
import { NAV_SIDEBAR_IDS, NAV_VIEW_OF } from '@rl/core';
import { NAV_ORDER, sameLocation } from './nav';

describe('navigation', () => {
  it('follows the sidebar order of the contracts (Alt+1..5)', () => {
    expect(NAV_ORDER.map((n) => n.id)).toEqual([...NAV_SIDEBAR_IDS]);
    expect(NAV_ORDER.map((n) => n.view)).toEqual(NAV_SIDEBAR_IDS.map((id) => NAV_VIEW_OF[id]));
  });
  it('compares places', () => {
    expect(sameLocation({ view: 'review', tab: 'files' }, { view: 'review', tab: 'files' })).toBe(true);
    expect(sameLocation({ view: 'review', tab: 'files' }, { view: 'review', tab: 'proposals' })).toBe(false);
  });
});
