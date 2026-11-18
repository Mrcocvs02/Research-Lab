// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { centerY, compactOf, findQuote, locateInTextLayer, overlapRatio, pickNearest } from './repair';

describe('findQuote', () => {
  it('finds one occurrence regardless of spaces, case and a line-end hyphen', () => {
    const raw = 'The inter- national agreement was signed';
    const hit = findQuote(raw, 'International  Agreement');
    expect(hit).toHaveLength(1);
    expect(raw.slice(hit[0]!.start, hit[0]!.end)).toBe('inter- national agreement');
  });
  it('finds every occurrence', () => {
    expect(findQuote('abc x abc y abc', 'abc')).toHaveLength(3);
  });
  it('finds nothing for an empty or absent quote', () => {
    expect(findQuote('abc', '  ')).toEqual([]);
    expect(findQuote('abc', 'zzz')).toEqual([]);
  });
  it('maps compact offsets back to the raw text', () => {
    const c = compactOf('a - b');
    expect(c.text).toBe('ab');
    expect(c.map).toEqual([0, 4]);
  });
});

describe('pickNearest', () => {
  it('takes the occurrence closest to the saved position', () => {
    expect(pickNearest([0.1, 0.6], 0.55, 0.02)).toEqual({ kind: 'found', index: 1 });
  });
  it('is ambiguous when two occurrences are less than a line apart', () => {
    expect(pickNearest([0.3, 0.305], 0.3, 0.02)).toEqual({ kind: 'ambiguous' });
  });
  it('is none without occurrences', () => {
    expect(pickNearest([], 0.5, 0.02)).toEqual({ kind: 'none' });
  });
});

describe('overlapRatio', () => {
  const r = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  it('is 1 for the same rectangles and 0 for disjoint ones', () => {
    expect(overlapRatio([r(0.1, 0.1, 0.2, 0.02)], [r(0.1, 0.1, 0.2, 0.02)])).toBeCloseTo(1);
    expect(overlapRatio([r(0.1, 0.1, 0.2, 0.02)], [r(0.5, 0.5, 0.2, 0.02)])).toBe(0);
  });
  it('is low for a stretched rectangle (x too small, too wide)', () => {
    expect(overlapRatio([r(0.0, 0.1, 0.5, 0.02)], [r(0.1, 0.1, 0.3, 0.02)])).toBeLessThan(0.9);
  });
  it('sums several lines', () => {
    const lines = [r(0.1, 0.1, 0.8, 0.02), r(0.1, 0.12, 0.4, 0.02)];
    expect(overlapRatio(lines, lines)).toBeCloseTo(1);
    expect(centerY(lines)).toBeCloseTo(0.12);
  });
});

/** A text layer of one span per line; each text node measures as a fixed rectangle per character run. */
function layer(lines: string[]): HTMLElement {
  const el = document.createElement('div');
  el.className = 'textLayer';
  for (const l of lines) {
    const s = document.createElement('span');
    s.textContent = l;
    el.append(s);
  }
  document.body.replaceChildren(el);
  return el;
}
const FRAME = { left: 0, top: 0, width: 1000, height: 1000 };
/** Rectangles by line: a range inside the span `i` gets the line `i` (height 20), x from the character offsets (10 px per char). */
const measure = (range: Range) => {
  const texts = [...document.querySelectorAll('.textLayer span')].map((span) => span.firstChild as Text);
  const si = texts.indexOf(range.startContainer as Text);
  const ei = texts.indexOf(range.endContainer as Text);
  const out: Array<{ left: number; top: number; width: number; height: number }> = [];
  for (let i = si; i <= ei; i++) {
    const text = texts[i]!;
    const from = i === si ? range.startOffset : 0;
    const to = i === ei ? range.endOffset : text.length;
    out.push({ left: from * 10, top: 100 + i * 100, width: (to - from) * 10, height: 20 });
  }
  return out;
};

describe('locateInTextLayer', () => {
  it('measures the quote on one line', () => {
    const el = layer(['first line', 'the quick brown fox', 'last']);
    const got = locateInTextLayer(el, 1, FRAME, 'quick brown', 0.2, 0.02, measure);
    expect(got.status).toBe('found');
    if (got.status === 'found') {
      expect(got.rects).toHaveLength(1);
      const r = got.rects[0]!;
      expect([r.x, r.y, r.w, r.h].map((n) => Math.round(n * 1000))).toEqual([40, 200, 110, 20]);
    }
  });
  it('measures a quote that runs over two lines', () => {
    const el = layer(['an inter-', 'national text']);
    const got = locateInTextLayer(el, 1, FRAME, 'international text', 0.15, 0.02, measure);
    expect(got.status === 'found' && got.rects.length).toBe(2);
  });
  it('picks the occurrence nearest the saved vertical position', () => {
    const el = layer(['word here', 'filler', 'word here']);
    const got = locateInTextLayer(el, 1, FRAME, 'word', 0.31, 0.02, measure);
    expect(got.status === 'found' && got.rects[0]!.y).toBeCloseTo(0.3);
  });
  it('reports ambiguity and absence', () => {
    const el = layer(['word word']);
    expect(locateInTextLayer(el, 1, FRAME, 'word', 0.1, 0.02, measure).status).toBe('ambiguous');
    expect(locateInTextLayer(layer(['abc']), 1, FRAME, 'zzz', 0.1, 0.02, measure).status).toBe('none');
  });
});
