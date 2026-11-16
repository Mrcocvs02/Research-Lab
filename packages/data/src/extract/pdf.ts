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
type PdfItems = Array<PdfTextItem | Record<string, unknown>>;
interface PdfPage {
  getTextContent(params?: Record<string, unknown>): Promise<{ items: PdfItems }>;
  /** Stream of `{ items }` chunks: lets us stop reading a page that produces far more text than we keep. */
  streamTextContent?(params?: Record<string, unknown>): ReadableStream<{ items: PdfItems }>;
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
  /** Characters kept in total; collection stops as soon as it is reached (`truncated`). Default: no total limit. */
  maxCharsPerFile?: number;
  /**
   * Progress signal for a watchdog: called with `(0, total)` once the document is open, then `(n, total)` after each page.
   * The in-process `timeoutMs` timer cannot fire while pdf.js blocks the thread, so the supervisor of the thread running
   * the extraction (the main process, for a worker) must kill it when no signal arrives for a while. Errors thrown by
   * the callback are ignored.
   */
  onPage?: (page: number, total: number) => void;
}

/** Page requests that fail in a row before the rest of the page tree is given up (a huge or cyclic `/Count`). */
const MAX_CONSECUTIVE_PAGE_FAILURES = 8;
/** Larger than any real page count; a `/Count` above it is a lie and is not reported as the page count. */
const MAX_PLAUSIBLE_PAGES = 1_000_000;

/** Text extraction never draws: a canvas factory that refuses, so `@napi-rs/canvas` is never used for a document. */
class NoCanvasFactory {
  create(): never {
    throw new Error('Canvas is disabled: text extraction does not render');
  }
  reset(): never {
    throw new Error('Canvas is disabled: text extraction does not render');
  }
  destroy(): void {}
}

/** Reads the text items of a page, stopping once `maxChars` of text have been seen. */
async function readItems(page: PdfPage, maxChars: number): Promise<PdfItems> {
  if (typeof page.streamTextContent !== 'function') return (await page.getTextContent({ includeMarkedContent: false })).items;
  const reader = page.streamTextContent({ includeMarkedContent: false }).getReader();
  const items: PdfItems = [];
  let chars = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const it of value.items) {
        items.push(it);
        if (typeof (it as PdfTextItem).str === 'string') chars += (it as PdfTextItem).str.length;
      }
      if (chars > maxChars) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return items;
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
    // Text only: no scripting, no images, no canvas, no wasm image decoders, no streaming or range requests.
    enableScripting: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    maxImageSize: 1,
    canvasMaxAreaInBytes: 1,
    useWasm: false,
    CanvasFactory: NoCanvasFactory,
    disableStream: true,
    disableRange: true,
    disableAutoFetch: true,
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
    const total = doc.numPages;
    if (!Number.isInteger(total) || total < 1) throw fail('malformed', 'PDF has no pages');
    const signalPage = (n: number) => {
      try {
        limits.onPage?.(n, total);
      } catch {
        /* a progress callback must never break the extraction */
      }
    };
    signalPage(0);
    const pages: Array<{ page: number; text: string }> = [];
    let firstPageLines: TextLine[] = [];
    // The page count is checked against the limit BEFORE any page is read: a hostile `/Count` only costs the cap.
    const last = Math.min(total, limits.maxPages);
    const maxFileChars = limits.maxCharsPerFile ?? Number.POSITIVE_INFINITY;
    let chars = 0;
    let truncated = total > last;
    let failures = 0;
    for (let n = 1; n <= last; n++) {
      if (signal?.aborted) throw new AppError('CANCELLED', 'Extraction cancelled');
      if (chars >= maxFileChars) {
        truncated = true;
        break;
      }
      try {
        const page = await doc.getPage(n);
        const lines = toLines(await readItems(page, limits.maxCharsPerPage));
        if (n === 1) firstPageLines = lines;
        let text = lines.map((l) => l.text).join('\n');
        if (text.length > limits.maxCharsPerPage) text = text.slice(0, limits.maxCharsPerPage);
        if (chars + text.length > maxFileChars) {
          text = text.slice(0, maxFileChars - chars);
          truncated = true;
        }
        chars += text.length;
        pages.push({ page: n, text });
        page.cleanup();
        failures = 0;
      } catch (e) {
        if (e instanceof AppError) throw e;
        pages.push({ page: n, text: '' }); // one broken page does not lose the others
        if (++failures >= MAX_CONSECUTIVE_PAGE_FAILURES) {
          pages.length -= failures; // the page tree is broken from here on (bogus /Count, cycle): stop asking
          truncated = true;
          break;
        }
      }
      signalPage(n);
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
    return { pages, firstPageLines, info, ...(xmpTitle ? { xmpTitle } : {}), pageCount: Math.min(total, MAX_PLAUSIBLE_PAGES), truncated };
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
