import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError, sha256Schema, type ExtractedMeta, type ExtractedText, type ExtractOptions, type RelativePath, type TextExtractor } from '@rl/core';
import { atomicWriteFile, resolveInRoot, sha256Of } from '@rl/core/node';
import { toFsPath } from '../fs-util.js';
import { withRetry, type RetryOptions } from '../retry.js';
import { extractNonPdf, formatOf } from './formats.js';
import {
  abstractFromText,
  authorsFromFirstPage,
  authorsFromInfo,
  plausibleTitle,
  squash,
  titleFromFirstPage,
  yearFromDate,
  yearFromText,
} from './heuristics.js';
import { arxivYear, findArxivIds, findDois, uniqueInOrder, type ArxivMatch, type DoiMatch } from './identifiers.js';
import { extractPdf } from './pdf.js';

export interface TextExtractorOptions {
  /**
   * Folder for the extracted-text cache, one file per content hash (`<hash>.json`). Must be OUTSIDE the library
   * (the main process passes a folder in the local app data). Rebuildable: it can be deleted at any time.
   */
  cacheDir?: string;
  /** Pages read from a PDF (default 400). A per-call `maxPages` can only lower it. */
  maxPages?: number;
  /** Largest file read (default 200 MiB for PDF/Office, see `maxTextBytes` for plain text). */
  maxBytes?: number;
  /** Largest plain-text file read (default 32 MiB). */
  maxTextBytes?: number;
  /** Time allowed for one PDF (default 60 s). */
  timeoutMs?: number;
  /** Characters kept per page (default 400 000) and per file (default 8 000 000). */
  maxCharsPerPage?: number;
  maxCharsPerFile?: number;
  retry?: RetryOptions;
}

const CACHE_VERSION = 1;
const MAX_CANDIDATES = 20;

const noText = (s: string) => s.replace(/\s/g, '').length;

interface CacheEntry {
  v: number;
  maxPages: number;
  result: ExtractedText;
}

/**
 * Text and metadata extraction, offline and without AI. The text is data: nothing in it is executed or followed.
 * Failures (malformed or encrypted PDF, too large, too slow) throw `AppError('IO_ERROR', ..., { reason })`,
 * unsupported extensions `INVALID_REQUEST`; callers handle them per file so one bad file never stops a scan.
 */
export function createTextExtractorImpl(options: TextExtractorOptions = {}): TextExtractor {
  const defaultMaxPages = options.maxPages ?? 400;
  const maxBytes = options.maxBytes ?? 200 * 1024 * 1024;
  const maxTextBytes = options.maxTextBytes ?? 32 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxCharsPerPage = options.maxCharsPerPage ?? 400_000;
  const maxCharsPerFile = options.maxCharsPerFile ?? 8_000_000;

  const cacheFile = (hash: string): string | undefined => (options.cacheDir && sha256Schema.safeParse(hash).success ? path.join(options.cacheDir, `${hash}.json`) : undefined);

  async function readCache(hash: string, maxPages: number): Promise<ExtractedText | undefined> {
    const file = cacheFile(hash);
    if (!file) return undefined;
    try {
      const entry = JSON.parse(await readFile(toFsPath(file), 'utf8')) as CacheEntry;
      if (entry.v !== CACHE_VERSION || entry.maxPages !== maxPages || !Array.isArray(entry.result?.pages)) return undefined;
      return { ...entry.result, fromCache: true };
    } catch {
      return undefined; // missing or corrupt: regenerate
    }
  }

  async function writeCache(hash: string, maxPages: number, result: ExtractedText): Promise<void> {
    const file = cacheFile(hash);
    if (!file || !options.cacheDir) return;
    try {
      await mkdir(toFsPath(options.cacheDir), { recursive: true });
      const { fromCache: _f, ...clean } = result;
      await atomicWriteFile(file, JSON.stringify({ v: CACHE_VERSION, maxPages, result: clean } satisfies CacheEntry));
    } catch {
      /* the cache is an optimisation: a failed write must not fail the extraction */
    }
  }

  return {
    async extract(rootPath: string, rel: RelativePath, o: ExtractOptions = {}): Promise<ExtractedText> {
      const signal = o.signal;
      const maxPages = Math.max(1, Math.min(o.maxPages ?? defaultMaxPages, defaultMaxPages));
      const ext = path.extname(rel).slice(1).toLowerCase();
      const format = formatOf(ext);
      if (!format) throw new AppError('INVALID_REQUEST', 'Unsupported file type for text extraction', { reason: 'unsupported-format' });
      if (signal?.aborted) throw new AppError('CANCELLED', 'Extraction cancelled');

      if (o.hash) {
        const hit = await readCache(o.hash, maxPages);
        if (hit) return hit;
      }

      const abs = await resolveInRoot(rootPath, rel);
      const limit = format === 'pdf' || format === 'docx' || format === 'pptx' ? maxBytes : maxTextBytes;
      let data: Uint8Array;
      try {
        const st = await withRetry(() => stat(toFsPath(abs)), options.retry);
        if (!st.isFile()) throw new AppError('NOT_FOUND', 'Not a regular file');
        if (st.size > limit) throw new AppError('IO_ERROR', 'File too large for text extraction', { reason: 'too-large' });
        data = await withRetry(() => readFile(toFsPath(abs), signal ? { signal } : undefined), options.retry);
      } catch (e) {
        if (e instanceof AppError) throw e;
        const code = (e as NodeJS.ErrnoException).code;
        if ((e as Error).name === 'AbortError') throw new AppError('CANCELLED', 'Extraction cancelled');
        throw new AppError(code === 'ENOENT' ? 'NOT_FOUND' : 'IO_ERROR', 'Cannot read file', { code: code ?? 'unknown' }, { cause: e });
      }
      const hash = sha256Of(data);
      if (o.hash === undefined) {
        const hit = await readCache(hash, maxPages);
        if (hit) return hit;
      }

      let result: ExtractedText;
      if (format === 'pdf') result = await fromPdf(data, hash, maxPages, signal);
      else result = fromOther(format, data, hash);
      await writeCache(hash, maxPages, result);
      return result;
    },
  };

  async function fromPdf(data: Uint8Array, hash: string, maxPages: number, signal?: AbortSignal): Promise<ExtractedText> {
    const pdf = await extractPdf(data, { maxPages, timeoutMs, maxCharsPerPage }, signal);
    let chars = 0;
    let truncated = pdf.truncated;
    const pages = [];
    for (const p of pdf.pages) {
      if (chars >= maxCharsPerFile) {
        truncated = true;
        break;
      }
      chars += p.text.length;
      pages.push(p);
    }
    const hasText = pages.reduce((n, p) => n + noText(p.text), 0) >= 25;
    const meta: ExtractedMeta = { pageCount: pdf.pageCount };

    // Title: PDF metadata when it looks like a title, else the largest text of the first page.
    const first = titleFromFirstPage(pdf.firstPageLines);
    const metaTitle = plausibleTitle(pdf.info['Title']) ?? plausibleTitle(pdf.xmpTitle);
    const title = metaTitle ?? first?.title;
    if (title) meta.title = title.slice(0, 2000);

    // Authors: the PDF's Author field when it parses as people, else the lines under the title.
    const authors = authorsFromInfo(pdf.info['Author']);
    const fromPage = first ? authorsFromFirstPage(pdf.firstPageLines, first.endIndex) : [];
    const best = authors.length > 0 ? authors : fromPage;
    if (best.length) meta.authors = best;

    const firstText = pages[0]?.text ?? '';
    const twoPages = pages
      .slice(0, 2)
      .map((p) => p.text)
      .join('\n');
    const infoText = [pdf.info['Subject'], pdf.info['Keywords'], pdf.info['Title']].filter(Boolean).join('\n');

    // Identifiers: first pages and the PDF info fields for the document's own; every page for the candidates.
    const doiBuckets: DoiMatch[][] = [findDois(firstText), findDois(infoText), findDois(pages[1]?.text ?? '')];
    const ownDoi = pickDoi(doiBuckets);
    if (ownDoi) meta.doi = ownDoi;
    const arxivBuckets: ArxivMatch[][] = [findArxivIds(firstText), findArxivIds(infoText)];
    const ownArxiv = arxivBuckets.flat()[0];
    if (ownArxiv) {
      meta.arxivId = ownArxiv.id;
      if (ownArxiv.version !== undefined) meta.arxivVersion = ownArxiv.version;
    }
    const allDois = [...doiBuckets.flat(), ...pages.slice(2).flatMap((p) => findDois(p.text))];
    const allArxiv = [...arxivBuckets.flat(), ...pages.slice(1).flatMap((p) => findArxivIds(p.text))];
    const doiCandidates = uniqueInOrder(allDois.map((d) => d.doi), (d) => d.toLowerCase(), MAX_CANDIDATES);
    const arxivCandidates = uniqueInOrder(allArxiv.map((a) => a.id), (a) => a, MAX_CANDIDATES);
    if (doiCandidates.length) meta.doiCandidates = doiCandidates;
    if (arxivCandidates.length) meta.arxivCandidates = arxivCandidates;

    const year = (ownArxiv && arxivYear(ownArxiv.id)) || yearFromText(firstText) || yearFromDate(pdf.info['CreationDate']) || yearFromDate(pdf.info['ModDate']);
    if (year) meta.year = year;
    const abstract = abstractFromText(twoPages);
    if (abstract) meta.abstract = abstract;

    return { pages, meta, noTextLayer: !hasText, hasText, needsOcr: !hasText && pdf.pageCount > 0, format: 'pdf', truncated, hash };
  }

  function fromOther(format: ExtractedText['format'], data: Uint8Array, hash: string): ExtractedText {
    const x = extractNonPdf(format, data);
    let chars = 0;
    let truncated = false;
    const pages: ExtractedText['pages'] = [];
    for (const p of x.pages) {
      if (chars >= maxCharsPerFile) {
        truncated = true;
        break;
      }
      const text = p.text.length > maxCharsPerPage ? p.text.slice(0, maxCharsPerPage) : p.text;
      if (text.length < p.text.length) truncated = true;
      chars += text.length;
      pages.push({ page: p.page, text });
    }
    const joined = pages.map((p) => p.text).join('\n');
    const head = joined.slice(0, 20_000);
    const meta: ExtractedMeta = { ...x.meta, pageCount: pages.length };
    const dois = findDois(joined);
    const arxivs = findArxivIds(joined);
    const ownDoi = pickDoi([findDois(head), dois]);
    if (ownDoi) meta.doi = ownDoi;
    const ownArxiv = findArxivIds(head)[0] ?? arxivs[0];
    if (ownArxiv) {
      meta.arxivId = ownArxiv.id;
      if (ownArxiv.version !== undefined) meta.arxivVersion = ownArxiv.version;
    }
    const doiCandidates = uniqueInOrder(dois.map((d) => d.doi), (d) => d.toLowerCase(), MAX_CANDIDATES);
    const arxivCandidates = uniqueInOrder(arxivs.map((a) => a.id), (a) => a, MAX_CANDIDATES);
    if (doiCandidates.length) meta.doiCandidates = doiCandidates;
    if (arxivCandidates.length) meta.arxivCandidates = arxivCandidates;
    if (meta.title) meta.title = squash(meta.title);
    const hasText = noText(joined) > 0;
    return { pages, meta, noTextLayer: false, hasText, needsOcr: false, format, truncated, hash };
  }
}

/** The first labelled DOI of the first non-empty bucket; else its first DOI. */
function pickDoi(buckets: DoiMatch[][]): string | undefined {
  for (const b of buckets) {
    if (b.length === 0) continue;
    return (b.find((d) => d.labelled) ?? b[0])?.doi;
  }
  return undefined;
}
