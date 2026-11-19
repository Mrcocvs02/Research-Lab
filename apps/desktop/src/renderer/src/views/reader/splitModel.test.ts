import { describe, expect, it } from 'vitest';
import { clampRatio, isNarrow, linkedTop, moveFocus, pairTitle } from './splitModel';

describe('split reader model', () => {
  it('turns into tabs below 1280 px', () => {
    expect(isNarrow(1279)).toBe(true);
    expect(isNarrow(1280)).toBe(false);
  });
  it('keeps a quarter of the width on each side', () => {
    expect(clampRatio(0.1)).toBe(0.25);
    expect(clampRatio(0.9)).toBe(0.75);
    expect(clampRatio(0.4)).toBe(0.4);
    expect(clampRatio(Number.NaN)).toBe(0.5);
  });
  it('moves the focus by the layout order', () => {
    expect(moveFocus([0, 1], 'left')).toBe(0);
    expect(moveFocus([1, 0], 'left')).toBe(1);
    expect(moveFocus([1, 0], 'right')).toBe(0);
  });
  it('links the scroll by fraction of the length', () => {
    expect(linkedTop({ scrollTop: 500, scrollHeight: 2000, clientHeight: 1000 }, { scrollHeight: 5000, clientHeight: 1000 })).toBe(2000);
    expect(linkedTop({ scrollTop: 0, scrollHeight: 500, clientHeight: 1000 }, { scrollHeight: 5000, clientHeight: 1000 })).toBe(0);
  });
  it('cuts long titles', () => {
    expect(pairTitle('A', 'B')).toBe('A ⇄ B');
    expect(pairTitle('x'.repeat(100), 'B').length).toBeLessThan(60);
  });
});
