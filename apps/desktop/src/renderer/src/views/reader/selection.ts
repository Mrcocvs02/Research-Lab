import { mergeRects, normaliseRect, type Rect } from './geometry';

/** A piece of a text selection (or of a find match) on one page: its text and its rectangles as fractions of the page. */
export interface SelectionPiece {
  page: number;
  text: string;
  rects: Rect[];
}

/** What the viewer read: the pieces, and how many pages inside the selection had no text layer drawn yet (virtualised) and were left out. */
export interface SelectionRead {
  pieces: SelectionPiece[];
  skipped: number;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The piece of one page for client rectangles: the one normalisation both the selection path and the find-match path use. */
export function pieceFrom(page: number, clientRects: Iterable<Box>, frame: Box, rawText: string): SelectionPiece | null {
  const rects = mergeRects([...clientRects].map((r) => normaliseRect(r, frame)).filter((r): r is Rect => r !== null));
  const text = rawText.replace(/\s+/g, ' ').trim();
  return rects.length > 0 && text !== '' ? { page, text, rects } : null;
}

/** The page number of a `.page` element, or null. */
export const pageOf = (pageDiv: HTMLElement): number | null => {
  const n = Number(pageDiv.dataset['pageNumber']);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * The selection (a DOM range) split by page. A page inside the range whose text layer is not drawn yet (pdf.js draws
 * only the pages near the screen) cannot be read: it is counted in `skipped`, so the reader can tell the user.
 * `frameOf` gives the box the rectangles are measured against (the overlay of the page).
 */
export function readRange(container: HTMLElement, range: Range, frameOf: (page: number, pageDiv: HTMLElement) => Box): SelectionRead {
  const pieces: SelectionPiece[] = [];
  let skipped = 0;
  for (const pageDiv of container.querySelectorAll<HTMLElement>('.page')) {
    if (!range.intersectsNode(pageDiv)) continue;
    const page = pageOf(pageDiv);
    if (page === null) continue;
    const textLayer = pageDiv.querySelector('.textLayer');
    if (!textLayer) {
      skipped++;
      continue;
    }
    // Only the part of the selection that lies in this page's text.
    const clip = range.cloneRange();
    const bounds = document.createRange();
    bounds.selectNodeContents(textLayer);
    if (clip.compareBoundaryPoints(Range.START_TO_START, bounds) < 0) clip.setStart(bounds.startContainer, bounds.startOffset);
    if (clip.compareBoundaryPoints(Range.END_TO_END, bounds) > 0) clip.setEnd(bounds.endContainer, bounds.endOffset);
    const piece = pieceFrom(page, clip.getClientRects(), frameOf(page, pageDiv), clip.toString());
    if (piece) pieces.push(piece);
  }
  return { pieces, skipped };
}

/** Marks pdf.js puts on the current find match in the text layer (`TextHighlighter`). */
export const FIND_MATCH_SELECTOR = '.textLayer .highlight.selected';

/** The current find match, split by page, measured like a selection. */
export function readFindMatch(container: HTMLElement, frameOf: (page: number, pageDiv: HTMLElement) => Box): SelectionRead {
  const byPage = new Map<number, { div: HTMLElement; els: HTMLElement[] }>();
  for (const el of container.querySelectorAll<HTMLElement>(FIND_MATCH_SELECTOR)) {
    const div = el.closest<HTMLElement>('.page');
    const page = div ? pageOf(div) : null;
    if (!div || page === null) continue;
    const entry = byPage.get(page) ?? { div, els: [] };
    entry.els.push(el);
    byPage.set(page, entry);
  }
  const pieces: SelectionPiece[] = [];
  for (const [page, { div, els }] of [...byPage].sort((a, b) => a[0] - b[0])) {
    const rects = els.flatMap((el) => [...el.getClientRects()]);
    const piece = pieceFrom(page, rects, frameOf(page, div), els.map((el) => el.textContent ?? '').join(' '));
    if (piece) pieces.push(piece);
  }
  return { pieces, skipped: 0 };
}
