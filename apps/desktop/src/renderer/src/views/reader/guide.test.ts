import { describe, expect, it } from 'vitest';
import { barSpan, noteRects } from './guide';

describe('guide margin helpers', () => {
  it('spans from the first line to the last, never under a line', () => {
    const s = barSpan([{ x: 0, y: 0.2, w: 1, h: 0.02 }, { x: 0, y: 0.3, w: 1, h: 0.02 }]);
    expect(s.top).toBe(0.2);
    expect(s.height).toBeCloseTo(0.12, 5);
    expect(barSpan([{ x: 0, y: 0.5, w: 1, h: 0.001 }]).height).toBe(0.012);
  });
  it('gives a note passage a short bar at the top', () => {
    expect(noteRects()).toHaveLength(1);
  });
});
