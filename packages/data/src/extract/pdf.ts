import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AppError } from '@rl/core';
import { squash, type TextLine } from './heuristics.js';

/* Minimal view of the pdf.js API we use (the package ships its own types, but they are heavy and browser-flavoured). */
interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  hasEOL?: boolean;
}
interface PdfPage {
  getTextContent(params?: Record<string, unknown>): Promise<{ items: Array<PdfTextItem | Record<string, unknown>> }>;
  cleanup(): boolean | void;
}
interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  getMetadata(): Promise<{ info?: Record<string, unknown>; metadata?: { get(name: string): string | null | undefined } | null }>;
  destroy(): Promise<void>;
}
interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
  destroy(): Promise<void>;
}
interface PdfjsModule {
  getDocument(params: Record<string, unknown>): PdfLoadingTask;
}

let pdfjsPromise: Promise<PdfjsModule> | undefined;

/**
 * The "legacy" build of pdf.js runs in Node 22+ (and so in Electron's main process) without a worker thread:
 * pdf.js falls back to an in-process "fake worker". Loaded once, on first use.
 */
function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => m as unknown as PdfjsModule);
  return pdfjsPromise;
}

let assetUrls: { cMapUrl?: string; standardFontDataUrl?: string } | undefined;

/** Folders with the predefined CMaps and standard fonts of pdf.js (needed by some CJK / non-embedded-font PDFs). */
function pdfAssets(): { cMapUrl?: string; standardFontDataUrl?: string } {
  if (assetUrls) return assetUrls;
  try {
    const pkg = createRequire(import.meta.url).resolve('pdfjs-dist/package.json');
    const base = path.dirname(pkg);
    assetUrls = {
      cMapUrl: pathToFileURL(path.join(base, 'cmaps') + path.sep).href,
      standardFontDataUrl: pathToFileURL(path.join(base, 'standard_fonts') + path.sep).href,
    };
  } catch {
    assetUrls = {}; // bundled without node_modules: extraction still works for the usual PDFs
  }
  return assetUrls;
}

export interface PdfLimits {
  maxPages: number;
  timeoutMs: number;
  /** Characters kept per page. */
  maxCharsPerPage: number;
}

export interface PdfExtraction {
  pages: Array<{ page: number; text: string }>;
  /** Lines of the first page with font sizes, for the title and author heuristics. */
  firstPageLines: TextLine[];
  info: Record<string, string>;
  /** `dc:title` from the XMP packet when present. */
  xmpTitle?: string;
  pageCount: number;
  truncated: boolean;
}

const isItem = (i: PdfTextItem | Record<string, unknown>): i is PdfTextItem => typeof (i as PdfTextItem).str === 'string' && Array.isArray((i as PdfTextItem).transform);

/** Joins pdf.js text items into lines (new line when the baseline moves or the item ends a line). */
function toLines(items: Array<PdfTextItem | Record<string, unknown>>): TextLine[] {
  const lines: TextLine[] = [];
  let cur = '';
  let curSize = 0;
  let curY = Number.NaN;
  let prevEnd = Number.NaN;
  const flush = () => {
    if (cur.trim()) lines.push({ text: cur, size: curSize });
    cur = '';
    curSize = 0;
    curY = Number.NaN;
    prevEnd = Number.NaN;
  };
  for (const item of items) {
    if (!isItem(item)) continue;
    const t = item.transform;
    const size = Math.hypot(t[2] ?? 0, t[3] ?? 0);
    const x = t[4] ?? 0;
    const y = t[5] ?? 0;
    if (item.str === '' && !item.hasEOL) continue;
    const newLine = !Number.isNaN(curY) && Math.abs(y - curY) > Math.max(1.5, 0.6 * Math.max(size, curSize));
    if (newLine) flush();
    if (Number.isNaN(curY)) curY = y;
    // Word gap without an explicit space item.
    if (cur && !cur.endsWith(' ') && !item.str.startsWith(' ') && !Number.isNaN(prevEnd) && x - prevEnd > 0.15 * Math.max(size, 1)) cur += ' ';
    cur += item.str;
    if (item.str.trim()) curSize = Math.max(curSize, size);
    prevEnd = x + (item.width ?? 0);
    if (item.hasEOL) flush();
  }
  flush();
  return lines;
}

const fail = (reason: string, message: string, cause?: unknown) => new AppError('IO_ERROR', message, { reason }, cause === undefined ? undefined : { cause });

/** Extracts text per page and metadata. Throws `AppError('IO_ERROR', ..., { reason })` for malformed, encrypted or too slow files. */
export async function extractPdf(data: Uint8Array, limits: PdfLimits, signal?: AbortSignal): Promise<PdfExtraction> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    // pdf.js refuses Node Buffers (it may take ownership of the memory): hand it a plain Uint8Array view.
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    verbosity: 0,
    isEvalSupported: false,
    enableXfa: false,
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: false,
    useWorkerFetch: false,
    ...pdfAssets(),
  });
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(fail('timeout', 'PDF extraction took too long')), limits.timeoutMs);
    onAbort = () => reject(new AppError('CANCELLED', 'Extraction cancelled'));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
  guard.catch(() => {}); // the race below reports it; never an unhandled rejection
  const work = (async (): Promise<PdfExtraction> => {
    let doc: PdfDocument;
    try {
      doc = await task.promise;
    } catch (e) {
      const name = (e as Error)?.name ?? '';
      throw fail(name === 'PasswordException' ? 'encrypted' : 'malformed', name === 'PasswordException' ? 'PDF is password protected' : 'PDF cannot be parsed', e);
    }
    const pages: Array<{ page: number; text: string }> = [];
    let firstPageLines: TextLine[] = [];
    const total = doc.numPages;
    const last = Math.min(total, limits.maxPages);
    for (let n = 1; n <= last; n++) {
      if (signal?.aborted) throw new AppError('CANCELLED', 'Extraction cancelled');
      try {
        const page = await doc.getPage(n);
        const content = await page.getTextContent({ includeMarkedContent: false });
        const lines = toLines(content.items);
        if (n === 1) firstPageLines = lines;
        const text = lines.map((l) => l.text).join('\n');
        pages.push({ page: n, text: text.length > limits.maxCharsPerPage ? text.slice(0, limits.maxCharsPerPage) : text });
        page.cleanup();
      } catch (e) {
        if (e instanceof AppError) throw e;
        pages.push({ page: n, text: '' }); // one broken page does not lose the others
      }
    }
    const info: Record<string, string> = {};
    let xmpTitle: string | undefined;
    try {
      const md = await doc.getMetadata();
      for (const [k, v] of Object.entries(md.info ?? {})) if (typeof v === 'string') info[k] = v;
      const t = md.metadata?.get('dc:title');
      if (typeof t === 'string' && t.trim()) xmpTitle = squash(t);
    } catch {
      /* metadata is optional */
    }
    return { pages, firstPageLines, info, ...(xmpTitle ? { xmpTitle } : {}), pageCount: total, truncated: total > last };
  })();
  try {
    return await Promise.race([work, guard]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    work.catch(() => {});
    await task.destroy().catch(() => {});
  }
}
