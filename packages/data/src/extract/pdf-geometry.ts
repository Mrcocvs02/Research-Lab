import { readFile, stat } from 'node:fs/promises';
import { AppError, STUDY_LIMITS } from '@rl/core';
import { resolveInRoot } from '@rl/core/node';
import { toFsPath } from '../fs-util.js';
import { loadPdfjs, textOnlyParams } from './pdf.js';

/**
 * Rectangles of quoted text without drawing (D-373): pdf.js `getTextContent()` gives the transform and width of every
 * item in page space, so a quote is placed by the position of its characters inside the items; the reader refines it
 * when the document is opened. Matching follows the reader (`views/reader/repair.ts`): no spaces or hyphens, lower case,
 * and among several occurrences the one closest to the saved vertical position (that axis was never distorted).
 */

/** Fractions of the page, origin top left. */
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One annotation to place: its quote and the saved (possibly misplaced) rectangles. */
export interface QuoteQuery {
  id: string;
  page: number;
  text: string;
  rects: readonly NormRect[];
}

export type QuoteOutcome = { id: string; status: 'found'; rects: NormRect[]; unchanged: boolean } | { id: string; status: 'none' | 'ambiguous' };

interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

/** `transform` maps page units to the page box (y down). */
export interface PageGeometry {
  items: readonly TextItem[];
  transform: readonly number[];
  width: number;
  height: number;
}

/** Relative advances (Helvetica, per mille) of a-z and A-Z: the characters of an item are placed in proportion to them. */
const LOWER = '556556500556556278556556222222500222833556556556556333500278556500722500500500';
const UPPER = '667667722722667611778722278500667556833722778667778722667611722667944667667611';
const advance = (ch: string): number => {
  const c = ch.charCodeAt(0);
  if (c >= 97 && c <= 122) return +LOWER.slice((c - 97) * 3, (c - 97) * 3 + 3);
  if (c >= 65 && c <= 90) return +UPPER.slice((c - 65) * 3, (c - 65) * 3 + 3);
  return ch === ' ' || ".,:;!|'`/()[]-".includes(ch) ? 278 : c >= 0x2e80 ? 1000 : 556;
};

const SKIP = /[\s\-­‐-―]/;
const compact = (s: string) => [...s].filter((c) => !SKIP.test(c)).join('').toLowerCase();

/** The box of characters `[from, to)` of an item, as an axis-aligned rectangle of the page box. */
function itemBox(p: PageGeometry, it: TextItem, from: number, to: number) {
  const [m0, m1, m2, m3, m4, m5] = p.transform as [number, number, number, number, number, number];
  const [t0, t1, t2, t3, t4, t5] = it.transform as [number, number, number, number, number, number];
  const a = m0 * t0 + m2 * t1;
  const b = m1 * t0 + m3 * t1;
  const c = m0 * t2 + m2 * t3;
  const d = m1 * t2 + m3 * t3;
  const adv = Math.hypot(a, b);
  const size = Math.hypot(c, d);
  const weights = it.str.split('').map(advance);
  const total = weights.reduce((n, w) => n + w, 0);
  if (!adv || !size || !total || !Number.isFinite(it.width)) return null;
  const at = (k: number) => (weights.slice(0, k).reduce((n, w) => n + w, 0) / total) * it.width * (adv / Math.hypot(t0, t1));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const x of [at(from), at(to)]) {
    // Descent .2 and ascent .9 of the font size around the baseline (the line box the reader measures, calibrated on it).
    for (const y of [-0.2 * size, 0.9 * size]) {
      xs.push(m0 * t4 + m2 * t5 + m4 + (a / adv) * x + (c / size) * y);
      ys.push(m1 * t4 + m3 * t5 + m5 + (b / adv) * x + (d / size) * y);
    }
  }
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const centerOf = (r: readonly NormRect[]) => (Math.min(...r.map((q) => q.y)) + Math.max(...r.map((q) => q.y + q.h))) / 2;

/** Intersection over union of two sets of rectangles (each set is made of lines that do not overlap each other). */
export function overlapRatio(a: readonly NormRect[], b: readonly NormRect[]): number {
  let i = 0;
  for (const p of a) for (const q of b) i += Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x)) * Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y));
  const u = [...a, ...b].reduce((n, r) => n + r.w * r.h, 0) - i;
  return u <= 0 ? 0 : i / u;
}

/** Rectangles of every occurrence of the quote on a page (at most 40); the pieces of one line are joined. */
export function quoteOccurrences(page: PageGeometry, quote: string): NormRect[][] {
  const q = compact(quote);
  if (!q) return [];
  let text = '';
  const where: Array<[number, number]> = [];
  page.items.forEach((it, i) => {
    for (let k = 0; k < it.str.length; k++) {
      const c = compact(it.str[k]!);
      text += c;
      for (let n = 0; n < c.length; n++) where.push([i, k]);
    }
  });
  const found: NormRect[][] = [];
  for (let at = text.indexOf(q); at !== -1 && found.length < 40; at = text.indexOf(q, at + 1)) {
    const spans = new Map<number, [number, number]>();
    for (const [i, k] of where.slice(at, at + q.length)) spans.set(i, [spans.get(i)?.[0] ?? k, k]);
    const rects: NormRect[] = [];
    for (const [i, [from, last]] of spans) {
      const box = itemBox(page, page.items[i]!, from, last + 1);
      if (!box) continue;
      const x = clamp01(box.x0 / page.width);
      const y = clamp01(box.y0 / page.height);
      const r = { x, y, w: clamp01(box.x1 / page.width) - x, h: clamp01(box.y1 / page.height) - y };
      const prev = rects[rects.length - 1];
      if (prev && Math.min(prev.y + prev.h, y + r.h) - Math.max(prev.y, y) > 0.6 * Math.min(prev.h, r.h)) {
        // Same line (the pieces of a quote are contiguous): one rectangle.
        const x0 = Math.min(prev.x, x);
        const y0 = Math.min(prev.y, y);
        prev.w = Math.max(prev.x + prev.w, x + r.w) - x0;
        prev.h = Math.max(prev.y + prev.h, y + r.h) - y0;
        prev.x = x0;
        prev.y = y0;
      } else if (r.w >= 0.002 && r.h >= 0.002 && r.h <= 0.25) rects.push(r);
    }
    if (rects.length > 0) found.push(rects.slice(0, STUDY_LIMITS.rectsPerAnnotation));
  }
  return found;
}

/**
 * Places one annotation: the occurrence closest to the saved vertical position. Two occurrences closer than one line
 * cannot be told apart by position: ambiguous, left to the reader.
 */
export function locateQuote(page: PageGeometry, q: QuoteQuery): QuoteOutcome {
  const occ = quoteOccurrences(page, q.text);
  if (occ.length === 0) return { id: q.id, status: 'none' };
  const saved = q.rects.length > 0 ? centerOf(q.rects) : 0.5;
  const [best, second] = occ.map((rects) => ({ rects, c: centerOf(rects) })).sort((p, r) => Math.abs(p.c - saved) - Math.abs(r.c - saved));
  if (second && Math.abs(second.c - best!.c) < Math.max(q.rects[0]?.h ?? 0, 0.01)) return { id: q.id, status: 'ambiguous' };
  return { id: q.id, status: 'found', rects: best!.rects, unchanged: overlapRatio(q.rects, best!.rects) >= 0.9 };
}

export interface GeometryOptions {
  signal?: AbortSignal;
  /** After each page read (progress signal for the watchdog of the thread running this). */
  onPage?(page: number): void;
}

const fail = (reason: string, cause?: unknown) => new AppError('IO_ERROR', `PDF check failed (${reason})`, { reason }, cause === undefined ? undefined : { cause });

/**
 * Places the annotations (queries) of the PDF at `rel`, page by page; only pages with a query are read. Read-only.
 * Throws `AppError`: `IO_ERROR` with `details.reason` (not-found, too-large, io, malformed, encrypted), `CANCELLED` on abort.
 */
export async function repairQuotes(rootPath: string, rel: string, queries: readonly QuoteQuery[], options: GeometryOptions = {}): Promise<QuoteOutcome[]> {
  const { signal } = options;
  const check = () => {
    if (signal?.aborted) throw new AppError('CANCELLED', 'Check cancelled');
  };
  check();
  const abs = await resolveInRoot(rootPath, rel);
  const data = await stat(toFsPath(abs)).then(
    async (st) => {
      if (!st.isFile()) throw fail('not-found');
      if (st.size > 200 * 1024 * 1024) throw fail('too-large');
      return readFile(toFsPath(abs));
    },
    (e: unknown) => {
      throw e instanceof AppError ? e : fail('io', e);
    },
  );
  const task = (await loadPdfjs()).getDocument(textOnlyParams(data));
  try {
    const doc = await task.promise.catch((e: Error) => {
      throw fail(e?.name === 'PasswordException' ? 'encrypted' : 'malformed', e);
    });
    const byPage = new Map<number, QuoteQuery[]>();
    for (const q of queries) byPage.set(q.page, [...(byPage.get(q.page) ?? []), q]);
    const out = new Map<string, QuoteOutcome>();
    for (const [n, list] of [...byPage].sort((a, b) => a[0] - b[0])) {
      check();
      let geometry: PageGeometry | null = null;
      try {
        const page = (await doc.getPage(n)) as unknown as {
          getViewport(p: { scale: number }): { transform: number[]; width: number; height: number };
          getTextContent(p: object): Promise<{ items: unknown[] }>;
          cleanup(): unknown;
        };
        const view = page.getViewport({ scale: 1 });
        const { items } = await page.getTextContent({ includeMarkedContent: false });
        geometry = { items: items.filter((i): i is TextItem => typeof (i as TextItem).str === 'string' && Array.isArray((i as TextItem).transform)), transform: view.transform, width: view.width, height: view.height };
        page.cleanup();
      } catch {
        /* a page that cannot be read (or is not there) gives `none`; the others go on */
      }
      for (const q of list) out.set(q.id, geometry && geometry.width > 0 && geometry.height > 0 ? locateQuote(geometry, q) : { id: q.id, status: 'none' });
      options.onPage?.(n);
    }
    return queries.map((q) => out.get(q.id)!);
  } finally {
    await task.destroy().catch(() => {});
  }
}
