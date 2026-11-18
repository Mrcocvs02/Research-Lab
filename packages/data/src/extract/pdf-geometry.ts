import { readFile, stat } from 'node:fs/promises';
import { AppError, STUDY_LIMITS } from '@rl/core';
import { resolveInRoot } from '@rl/core/node';
import { toFsPath } from '../fs-util.js';
import { loadPdfjs, textOnlyParams } from './pdf.js';

/**
 * Rectangles of quoted text, computed WITHOUT drawing (D-373): pdf.js `getTextContent()` gives the transform and the
 * width of every text item in the space of the page, so the rectangle of a quote follows from the position of its
 * characters inside the items (proportional to the item width). The reader refines them when the document is opened.
 * The PDF is only ever read here.
 *
 * The matching rules (`compact`, occurrence choice) are those of the reader (`views/reader/repair.ts`, D-347): the
 * quote and the page text are compared without spaces and hyphens, in lower case, and when the quote occurs more
 * than once the occurrence closest to the saved vertical position wins (the vertical axis was never distorted).
 */

/** A rectangle as fractions of the page (x, y from the top left). */
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the job asks about one annotation. `rects` are the saved (possibly misplaced) rectangles. */
export interface QuoteQuery {
  id: string;
  page: number;
  text: string;
  rects: readonly NormRect[];
}

export type QuoteOutcome =
  | { id: string; status: 'found'; rects: NormRect[]; /** The saved rectangles already cover the text (>= 90% overlap): only the marker is needed. */ unchanged: boolean }
  | { id: string; status: 'none' | 'ambiguous' };

interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

/** The geometry of one page as the matching needs it. `transform` maps page units to the page box (y down, like the reader). */
export interface PageGeometry {
  items: readonly TextItem[];
  transform: readonly number[];
  width: number;
  height: number;
}

/** Vertical extent of a text item around its baseline, in font sizes (the reader refines the exact line box). */
const ASCENT = 0.75;
const DESCENT = 0.2;

/**
 * Relative advance of a character (a generic sans/serif proportion, per mille, like Helvetica). The characters of an item
 * are placed in proportion to these, so that a quote in the middle of a long item lands near its glyphs: the exact
 * advances are not in the text content, and the reader refines the rectangle when the document is opened.
 */
const LOWER = [556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500];
const UPPER = [667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611];
const NARROW = new Set([...".,:;!|'`/()[]-"]);
function advance(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c >= 97 && c <= 122) return LOWER[c - 97]!;
  if (c >= 65 && c <= 90) return UPPER[c - 65]!;
  if (c === 32 || NARROW.has(ch)) return 278;
  return c >= 0x2e80 ? 1000 : 556;
}

const SKIPPED = /[\s\-­‐-―]/;

interface Compact {
  text: string;
  /** For each compact character: the item and the offset in it. */
  item: number[];
  at: number[];
}

function compactItems(items: readonly TextItem[]): Compact {
  const out: Compact = { text: '', item: [], at: [] };
  items.forEach((it, i) => {
    for (let k = 0; k < it.str.length; k++) {
      const ch = it.str[k]!;
      if (SKIPPED.test(ch)) continue;
      for (const c of ch.toLowerCase()) {
        out.text += c;
        out.item.push(i);
        out.at.push(k);
      }
    }
  });
  return out;
}

const compactQuote = (quote: string): string => {
  let text = '';
  for (const ch of quote) if (!SKIPPED.test(ch)) text += ch.toLowerCase();
  return text;
};

/** The box of characters `[from, to)` of an item, as an axis-aligned rectangle of the page box (in page-box units). */
function itemBox(page: PageGeometry, it: TextItem, from: number, to: number): { x0: number; y0: number; x1: number; y1: number } | null {
  const len = it.str.length;
  if (len === 0 || to <= from) return null;
  const m = page.transform;
  const t = it.transform;
  // item space -> page box: [a b c d e f] of the item composed with the page transform.
  const a = m[0]! * t[0]! + m[2]! * t[1]!;
  const b = m[1]! * t[0]! + m[3]! * t[1]!;
  const c = m[0]! * t[2]! + m[2]! * t[3]!;
  const d = m[1]! * t[2]! + m[3]! * t[3]!;
  const e = m[0]! * t[4]! + m[2]! * t[5]! + m[4]!;
  const f = m[1]! * t[4]! + m[3]! * t[5]! + m[5]!;
  const adv = Math.hypot(a, b);
  const size = Math.hypot(c, d);
  if (adv === 0 || size === 0 || !Number.isFinite(it.width)) return null;
  // Unit vectors of the writing direction and of "up" in the page box; the width is in the same units as the transform.
  const ux = a / adv;
  const uy = b / adv;
  const vx = c / size;
  const vy = d / size;
  const scale = adv / Math.hypot(t[0]!, t[1]!);
  let total = 0;
  let before = 0;
  let upto = 0;
  for (let k = 0; k < len; k++) {
    if (k === from) before = total;
    if (k === to) upto = total;
    total += advance(it.str[k]!);
  }
  if (to >= len) upto = total;
  const x0 = (it.width * scale * before) / total;
  const x1 = (it.width * scale * upto) / total;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const dx of [x0, x1]) {
    for (const dy of [-DESCENT * size, ASCENT * size]) {
      xs.push(e + ux * dx + vx * dy);
      ys.push(f + uy * dx + vy * dy);
    }
  }
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Joins the pieces of one line (same height band, touching): the same rule the reader uses, so a quote stays within the rectangle limit. */
function mergeLine(rects: NormRect[], max: number = STUDY_LIMITS.rectsPerAnnotation): NormRect[] {
  const sorted = [...rects].sort((p, q) => p.y - q.y || p.x - q.x);
  const out: NormRect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last) {
      const overlap = Math.min(last.y + last.h, r.y + r.h) - Math.max(last.y, r.y);
      const sameLine = overlap > 0.6 * Math.min(last.h, r.h);
      const touching = r.x <= last.x + last.w + 0.01 && r.x + r.w >= last.x - 0.01;
      if (sameLine && touching) {
        const x = Math.min(last.x, r.x);
        const y = Math.min(last.y, r.y);
        last.w = Math.max(last.x + last.w, r.x + r.w) - x;
        last.h = Math.max(last.y + last.h, r.y + r.h) - y;
        last.x = x;
        last.y = y;
        continue;
      }
    }
    out.push({ ...r });
  }
  return out.slice(0, max);
}

const area = (r: NormRect) => r.w * r.h;
const inter = (a: NormRect, b: NormRect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Intersection over union of two sets of rectangles (each set is made of lines that do not overlap each other). */
export function overlapRatio(a: readonly NormRect[], b: readonly NormRect[]): number {
  const i = a.reduce((n, ra) => n + b.reduce((m, rb) => m + inter(ra, rb), 0), 0);
  const u = a.reduce((n, r) => n + area(r), 0) + b.reduce((n, r) => n + area(r), 0) - i;
  return u <= 0 ? 0 : i / u;
}

const centerOf = (rects: readonly NormRect[]): number => (Math.min(...rects.map((r) => r.y)) + Math.max(...rects.map((r) => r.y + r.h))) / 2;

/** Rectangles of every occurrence of the quote on a page (at most `max`). */
export function quoteOccurrences(page: PageGeometry, quote: string, max = 40): NormRect[][] {
  const q = compactQuote(quote);
  if (q === '') return [];
  const pageText = compactItems(page.items);
  const found: NormRect[][] = [];
  for (let at = pageText.text.indexOf(q); at !== -1 && found.length < max; at = pageText.text.indexOf(q, at + 1)) {
    // The characters of the occurrence, grouped by item: [first, last] offset inside each.
    const spans = new Map<number, [number, number]>();
    for (let n = at; n < at + q.length; n++) {
      const i = pageText.item[n]!;
      const k = pageText.at[n]!;
      const s = spans.get(i);
      if (s) s[1] = Math.max(s[1], k);
      else spans.set(i, [k, k]);
    }
    const rects: NormRect[] = [];
    for (const [i, [from, last]] of spans) {
      const box = itemBox(page, page.items[i]!, from, last + 1);
      if (!box) continue;
      const x = clamp01(box.x0 / page.width);
      const y = clamp01(box.y0 / page.height);
      const w = clamp01(box.x1 / page.width) - x;
      const h = clamp01(box.y1 / page.height) - y;
      if (w >= 0.002 && h >= 0.002 && h <= 0.25) rects.push({ x, y, w, h });
    }
    if (rects.length > 0) found.push(mergeLine(rects));
  }
  return found;
}

/**
 * The rectangles of one annotation: the occurrence of its quote closest to the saved vertical position. Two occurrences
 * closer to each other than one line cannot be told apart by position: that is ambiguous and goes to the reader.
 */
export function locateQuote(page: PageGeometry, q: QuoteQuery): QuoteOutcome {
  const occurrences = quoteOccurrences(page, q.text);
  if (occurrences.length === 0) return { id: q.id, status: 'none' };
  const saved = q.rects.length > 0 ? centerOf(q.rects) : 0.5;
  const line = Math.max(q.rects[0]?.h ?? 0, 0.01);
  const order = occurrences.map((rects, index) => ({ index, c: centerOf(rects), d: Math.abs(centerOf(rects) - saved) })).sort((a, b) => a.d - b.d);
  const [best, second] = order;
  if (second && Math.abs(second.c - best!.c) < line) return { id: q.id, status: 'ambiguous' };
  const rects = occurrences[best!.index]!;
  return { id: q.id, status: 'found', rects, unchanged: overlapRatio(q.rects, rects) >= 0.9 };
}

export interface GeometryOptions {
  signal?: AbortSignal;
  /** Called after each page that was read (progress signal for the watchdog of the thread that runs this). */
  onPage?(page: number): void;
  /** Largest file read (default 200 MiB, like the text extractor). */
  maxBytes?: number;
}

const fail = (reason: string, message: string, cause?: unknown) => new AppError('IO_ERROR', message, { reason }, cause === undefined ? undefined : { cause });

/**
 * Recomputes the rectangles of the queries (annotations of the PDF at `rel`) from their quoted text, page by page; only
 * the pages that have a query are read. Never writes. Throws `AppError` (`IO_ERROR` with `details.reason` for a
 * malformed, encrypted or too large file, `CANCELLED` on abort); a page that cannot be read gives `none` for its queries.
 */
export async function repairQuotes(rootPath: string, rel: string, queries: readonly QuoteQuery[], options: GeometryOptions = {}): Promise<QuoteOutcome[]> {
  const { signal } = options;
  const cancelled = () => new AppError('CANCELLED', 'Check cancelled');
  if (signal?.aborted) throw cancelled();
  const abs = await resolveInRoot(rootPath, rel);
  let data: Uint8Array;
  try {
    const st = await stat(toFsPath(abs));
    if (!st.isFile()) throw fail('not-found', 'Not a regular file');
    if (st.size > (options.maxBytes ?? 200 * 1024 * 1024)) throw fail('too-large', 'File too large');
    data = await readFile(toFsPath(abs), signal ? { signal } : undefined);
  } catch (e) {
    if (e instanceof AppError) throw e;
    if ((e as Error).name === 'AbortError') throw cancelled();
    throw fail('io', 'Cannot read file', e);
  }
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument(textOnlyParams(data));
  try {
    let doc: Awaited<typeof task.promise>;
    try {
      doc = await task.promise;
    } catch (e) {
      throw fail((e as Error)?.name === 'PasswordException' ? 'encrypted' : 'malformed', 'PDF cannot be opened', e);
    }
    const byPage = new Map<number, QuoteQuery[]>();
    for (const q of queries) byPage.set(q.page, [...(byPage.get(q.page) ?? []), q]);
    const outcomes = new Map<string, QuoteOutcome>();
    for (const [n, list] of [...byPage].sort((a, b) => a[0] - b[0])) {
      if (signal?.aborted) throw cancelled();
      let geometry: PageGeometry | null = null;
      if (Number.isInteger(n) && n >= 1 && n <= doc.numPages) {
        try {
          const page = (await doc.getPage(n)) as unknown as PdfGeometryPage;
          const view = page.getViewport({ scale: 1 });
          const content = await page.getTextContent({ includeMarkedContent: false });
          const items = content.items.filter((i): i is TextItem => typeof (i as TextItem).str === 'string' && Array.isArray((i as TextItem).transform));
          geometry = { items, transform: view.transform, width: view.width, height: view.height };
          page.cleanup();
        } catch {
          geometry = null; // one broken page does not lose the others
        }
      }
      for (const q of list) outcomes.set(q.id, geometry && geometry.width > 0 && geometry.height > 0 ? locateQuote(geometry, q) : { id: q.id, status: 'none' });
      try {
        options.onPage?.(n);
      } catch {
        /* a progress callback must never break the check */
      }
    }
    return queries.map((q) => outcomes.get(q.id) ?? { id: q.id, status: 'none' });
  } finally {
    await task.destroy().catch(() => {});
  }
}

interface PdfGeometryPage {
  getViewport(params: { scale: number }): { transform: number[]; width: number; height: number };
  getTextContent(params?: Record<string, unknown>): Promise<{ items: Array<Record<string, unknown>> }>;
  cleanup(): unknown;
}
