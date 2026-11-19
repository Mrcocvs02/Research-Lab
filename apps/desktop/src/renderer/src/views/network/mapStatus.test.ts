import { describe, expect, it } from 'vitest';
import { staleLine } from './mapStatus';

const t = (key: string, o: Record<string, unknown> = {}) => `${key}:${String(o['count'])}`;

describe('staleLine (W17)', () => {
  it('new and changed documents are told apart', () => {
    expect(staleLine({ pending: 20, changed: 20, removed: 0 }, t)).toBe('network.head.changed:20');
    expect(staleLine({ pending: 5, changed: 2, removed: 0 }, t)).toBe('network.head.stale:3 · network.head.changed:2');
    expect(staleLine({ pending: 3, removed: 0 }, t)).toBe('network.head.stale:3');
  });
  it('removed documents come last, or alone', () => {
    expect(staleLine({ pending: 0, removed: 2 }, t)).toBe('network.head.removed:2');
    expect(staleLine({ pending: 1, changed: 1, removed: 2 }, t)).toBe('network.head.changed:1 · network.status.alsoRemoved:2');
  });
});
