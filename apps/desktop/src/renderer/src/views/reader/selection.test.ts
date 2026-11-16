// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { pieceFrom, readFindMatch, readRange } from './selection';

const FRAME = { left: 100, top: 50, width: 400, height: 800 };
const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });

/** A page div as pdf.js builds it: `.page[data-page-number]` with an optional `.textLayer`. */
function page(n: number, withText: boolean): HTMLElement {
  const div = document.createElement('div');
  div.className = 'page';
  div.dataset['pageNumber'] = String(n);
  if (withText) {
    const layer = document.createElement('div');
    layer.className = 'textLayer';
    div.append(layer);
  }
  return div;
}
const withRects = <T extends HTMLElement>(el: T, rects: Array<ReturnType<typeof box>>): T => {
  (el as unknown as { getClientRects: () => unknown }).getClientRects = () => rects;
  return el;
};

afterEach(() => void (document.body.innerHTML = ''));

describe('pieceFrom: the one normalisation of selections and find matches', () => {
  it('turns client rectangles into fractions of the page and tidies the text', () => {
    const p = pieceFrom(4, [box(140, 130, 120, 16)], FRAME, '  some \n  words ');
    expect(p?.page).toBe(4);
    expect(p?.text).toBe('some words');
    const r = p!.rects[0]!;
    expect([r.x, r.y, r.w, r.h].map((n) => Math.round(n * 1e6) / 1e6)).toEqual([0.1, 0.1, 0.3, 0.02]);
  });

  it('drops a whole-page rectangle, merges the pieces of a line, and gives nothing for empty text or no rectangle', () => {
    expect(pieceFrom(1, [box(100, 50, 400, 800)], FRAME, 'x')).toBeNull();
    expect(pieceFrom(1, [box(140, 130, 120, 16)], FRAME, '   ')).toBeNull();
    const merged = pieceFrom(1, [box(140, 130, 60, 16), box(200, 130, 60, 16)], FRAME, 'ab');
    expect(merged?.rects).toHaveLength(1);
  });
});

describe('readFindMatch', () => {
  it('reads what pdf.js marks as the current match, per page, with the selection normalisation', () => {
    const container = document.createElement('div');
    const p2 = page(2, true);
    const p3 = page(3, true);
    const mark = (text: string, rects: Array<ReturnType<typeof box>>) => {
      const span = document.createElement('span');
      span.className = 'highlight selected';
      span.textContent = text;
      return withRects(span, rects);
    };
    const other = document.createElement('span');
    other.className = 'highlight'; // a match that is not the current one
    other.textContent = 'not this';
    p2.querySelector('.textLayer')!.append(other, mark('foo', [box(140, 130, 120, 16)]));
    p3.querySelector('.textLayer')!.append(mark('bar', [box(140, 250, 40, 16)]));
    container.append(p3, p2); // order in the DOM does not matter
    document.body.append(container);

    const read = readFindMatch(container, () => FRAME);
    expect(read.skipped).toBe(0);
    expect(read.pieces.map((p) => [p.page, p.text])).toEqual([[2, 'foo'], [3, 'bar']]);
    // Same numbers as the selection path would give for the same client rectangle.
    expect(read.pieces[0]).toEqual(pieceFrom(2, [box(140, 130, 120, 16)], FRAME, 'foo'));
  });

  it('is empty when nothing is marked', () => {
    const container = document.createElement('div');
    container.append(page(1, true));
    expect(readFindMatch(container, () => FRAME)).toEqual({ pieces: [], skipped: 0 });
  });
});

describe('readRange: pages of a long selection that are not drawn yet', () => {
  /** A range-like object covering some pages; each clone (one per page that has a text layer, in order) yields that page's rectangles. */
  function fakeRange(covered: HTMLElement[], rectsByPage: Map<HTMLElement, Array<ReturnType<typeof box>>>) {
    const drawn = covered.filter((p) => p.querySelector('.textLayer'));
    let i = 0;
    const range = {
      intersectsNode: (n: Node) => covered.includes(n as HTMLElement),
      cloneRange: () => {
        const div = drawn[i++]!;
        return {
          compareBoundaryPoints: () => 0,
          setStart: () => {},
          setEnd: () => {},
          getClientRects: () => rectsByPage.get(div) ?? [],
          toString: () => `text of ${div.dataset['pageNumber']}`,
        };
      },
    };
    return range as unknown as Range;
  }

  it('counts the pages without a text layer instead of skipping them silently', () => {
    const container = document.createElement('div');
    const pages = [page(1, true), page(2, false), page(3, false), page(4, true)];
    container.append(...pages);
    document.body.append(container);
    const rects = new Map([
      [pages[0]!, [box(140, 130, 120, 16)]],
      [pages[3]!, [box(140, 330, 120, 16)]],
    ]);
    const read = readRange(container, fakeRange(pages, rects), () => FRAME);
    expect(read.skipped).toBe(2);
    expect(read.pieces.map((p) => p.page)).toEqual([1, 4]);
  });

  it('reports no skipped page when every page of the selection is drawn', () => {
    const container = document.createElement('div');
    const pages = [page(1, true), page(2, true)];
    container.append(...pages);
    document.body.append(container);
    const rects = new Map<HTMLElement, Array<ReturnType<typeof box>>>(pages.map((p, i) => [p, [box(140, 130 + i * 40, 120, 16)]]));
    const read = readRange(container, fakeRange(pages, rects), () => FRAME);
    expect(read.skipped).toBe(0);
    expect(read.pieces).toHaveLength(2);
  });

  it('ignores pages the range does not touch', () => {
    const container = document.createElement('div');
    const pages = [page(1, false), page(2, true)];
    container.append(...pages);
    document.body.append(container);
    const read = readRange(container, fakeRange([pages[1]!], new Map([[pages[1]!, [box(140, 130, 120, 16)]]])), () => FRAME);
    expect(read.skipped).toBe(0);
    expect(read.pieces.map((p) => p.page)).toEqual([2]);
  });
});
