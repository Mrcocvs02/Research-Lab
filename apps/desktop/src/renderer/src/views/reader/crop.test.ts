import { describe, expect, it } from 'vitest';
import { contextAround, cropTooSmall, dragRect, pickText, CROP_MIN_PX } from './crop';

describe('crop geometry', () => {
  it('orders the corners and keeps the rectangle inside the page', () => {
    const r = dragRect({ x: 0.6, y: 0.8 }, { x: 0.2, y: 0.1 });
    expect(r.x).toBe(0.2);
    expect(r.y).toBe(0.1);
    expect(r.w).toBeCloseTo(0.4);
    expect(r.h).toBeCloseTo(0.7);
    expect(dragRect({ x: -1, y: 0.5 }, { x: 2, y: 3 })).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
  });
  it('ignores a rectangle under 24 px on a side', () => {
    const frame = { width: 1000, height: 1000 };
    expect(CROP_MIN_PX).toBe(24);
    expect(cropTooSmall({ x: 0, y: 0, w: 0.023, h: 0.5 }, frame)).toBe(true);
    expect(cropTooSmall({ x: 0, y: 0, w: 0.5, h: 0.023 }, frame)).toBe(true);
    expect(cropTooSmall({ x: 0, y: 0, w: 0.025, h: 0.025 }, frame)).toBe(false);
  });
});

describe('text of a crop and of a selection', () => {
  const items = [
    { text: 'Above', cx: 0.5, cy: 0.1 },
    { text: 'Fig. 3', cx: 0.5, cy: 0.52 },
    { text: 'caption', cx: 0.5, cy: 0.56 },
    { text: 'Far away', cx: 0.5, cy: 0.95 },
  ];
  it('picks what lies inside the rectangle and the band around it', () => {
    const r = pickText(items, { x: 0.2, y: 0.5, w: 0.6, h: 0.1 }, 0.1);
    expect(r.inside).toBe('Fig. 3 caption');
    expect(r.around).toBe('Fig. 3 caption');
    expect(pickText(items, { x: 0.2, y: 0.5, w: 0.6, h: 0.1 }, 0.5).around).toContain('Above');
  });
  it('takes the paragraph around a selection, whitespace aside', () => {
    const page = `${'a '.repeat(2000)}the   quick brown fox ${'b '.repeat(2000)}`;
    const ctx = contextAround(page, 'the quick  brown fox', 100);
    expect(ctx).toContain('the quick brown fox');
    expect(ctx.length).toBeLessThan(260);
  });
  it('falls back to the start of the page when the selection is not found', () => {
    expect(contextAround('hello world', 'zzz', 5)).toBe('hello worl');
    expect(contextAround('', 'x')).toBe('');
  });
});
