import { describe, expect, it } from 'vitest';
import { topTags } from './tag-top.js';

describe('topTags (D-491)', () => {
  const tags = Array.from({ length: 50 }, (_, i) => ({ id: `t${String(i).padStart(2, '0')}`, w: 1 }));
  it('caps 50 tags to the top few and counts the rest', () => {
    const r = topTags(tags, () => 1, 8);
    expect(r.shown).toHaveLength(8);
    expect(r.hidden).toBe(42);
  });
  it('orders by weight, then by how many papers share the tag, then by id', () => {
    const r = topTags([{ id: 'a', w: 1 }, { id: 'b', w: 0.9 }, { id: 'c', w: 1 }, { id: 'd', w: 1 }], (id) => (id === 'c' ? 5 : id === 'd' ? 5 : 1), 3);
    expect(r.shown).toEqual(['c', 'd', 'a']);
    expect(r.hidden).toBe(1);
  });
  it('keeps everything when under the cap', () => {
    expect(topTags([{ id: 'x', w: 1 }], () => 0)).toEqual({ shown: ['x'], hidden: 0 });
  });
});
