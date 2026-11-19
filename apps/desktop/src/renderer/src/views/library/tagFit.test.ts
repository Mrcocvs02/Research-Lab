import { describe, expect, it } from 'vitest';
import { fitTags } from './tagFit';

describe('fitTags (W18)', () => {
  it('all tags when they fit, none when there are none', () => {
    expect(fitTags([], 200)).toBe(0);
    expect(fitTags(['alpha', 'beta'], 200)).toBe(2);
  });
  it('leaves room for the +N chip when some are left out', () => {
    const labels = ['alpha beta', 'gamma delta', 'epsilon zeta', 'eta theta'];
    const n = fitTags(labels, 170);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThan(labels.length);
    const used = labels.slice(0, n).reduce((s, l) => s + Math.round(l.length * 6.2) + 18 + 4, -4);
    expect(used + 4 + 36).toBeLessThanOrEqual(170);
  });
  it('at least one, even when it is wider than the line', () => {
    expect(fitTags(['a very long tag name that cannot fit', 'b'], 90)).toBe(1);
  });
  it('a wider card takes more tags', () => {
    const labels = ['alpha beta', 'gamma delta', 'epsilon zeta', 'eta theta', 'iota kappa'];
    expect(fitTags(labels, 330)).toBeGreaterThan(fitTags(labels, 190));
  });
});
