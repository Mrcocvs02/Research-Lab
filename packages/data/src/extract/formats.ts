import { unzipSync } from 'fflate';
import { AppError, type ExtractedMeta, type ExtractedText } from '@rl/core';
import { squash, yearFromDate } from './heuristics.js';

type Format = ExtractedText['format'];
export interface PlainExtraction {
  pages: Array<{ page: number; text: string }>;
  meta: Omit<ExtractedMeta, 'pageCount' | 'doiCandidates' | 'arxivCandidates'>;
  format: Format;
}

const TEXT_FORMATS: Record<string, Format> = {
  txt: 'text',
  md: 'markdown',
  markdown: 'markdown',
  tex: 'latex',
  rst: 'rst',
  py: 'code',
  csv: 'csv',
  tsv: 'csv',
  ipynb: 'notebook',
  docx: 'docx',
  pptx: 'pptx',
};

export function formatOf(ext: string): Format | 'pdf' | undefined {
  return ext === 'pdf' ? 'pdf' : TEXT_FORMATS[ext];
}

/** UTF-8 (with or without BOM), UTF-16 with BOM, else Windows-1252: old notes often are not UTF-8. */
export function decodeText(buf: Uint8Array): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return new TextDecoder('utf-8').decode(buf.subarray(3));
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

const decodeEntities = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const cp = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
  });

/**
 * Every regex in this file runs on document text, i.e. on hostile input (D-060). Rules: no nested or adjacent
 * unbounded quantifiers, every `\s*`/`[^x]*` that could meet a long run is bounded, XML is tokenized by index scans,
 * and metadata is looked for in the first MAX_META_SOURCE characters only (titles, authors and abstracts are at the top).
 */
const MAX_META_SOURCE = 256 * 1024;
const head = (s: string): string => (s.length > MAX_META_SOURCE ? s.slice(0, MAX_META_SOURCE) : s);

/* ------------------------------- LaTeX ------------------------------- */

/** Content of the first balanced `{...}` after `\name` (optionally `\name[opt]`). */
function texArgument(src: string, name: string): string | undefined {
  const m = new RegExp(String.raw`\\${name}\*?\s{0,20}(?:\[[^\]]{0,200}\])?\s{0,20}\{`).exec(src);
  if (!m) return undefined;
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  for (; i < src.length && depth > 0; i++) {
    const c = src[i];
    if (c === '\\') i++;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
  }
  return depth === 0 ? src.slice(start, i - 1) : undefined;
}

/** Drops comments and layout macros, keeps the words. */
function texToText(raw: string): string {
  const s = head(raw);
  let t = s.replace(/(?<!\\)%.*$/gm, '');
  for (let i = 0; i < 3; i++) {
    t = t.replace(/\\(?:thanks|footnote|inst|affil|affiliation|address|email|orcid)\*?\s{0,20}(?:\[[^\]]{0,200}\])?\s{0,20}\{[^{}]{0,5000}\}/g, '');
  }
  t = t.replace(/\\\\|\\newline|\\and\b/g, ' ');
  t = t.replace(/\\(?:textbf|textit|emph|textsc|texttt|mathrm|mathbf|mbox|text)\s{0,20}\{([^{}]{0,5000})\}/g, '$1');
  t = t.replace(/\\[a-zA-Z]{1,40}\*?(?:\[[^\]]{0,200}\])?/g, ' ').replace(/[{}]/g, '').replace(/~/g, ' ').replace(/\\(.)/g, '$1');
  return squash(t);
}

function latexMeta(full: string): PlainExtraction['meta'] {
  const src = head(full);
  const meta: PlainExtraction['meta'] = {};
  const title = texArgument(src, 'title');
  if (title) {
    const t = texToText(title);
    if (t) meta.title = t.slice(0, 300);
  }
  const author = texArgument(src, 'author');
  if (author) {
    const names = author
      .split(/\\and\b|\\\\|,|\band\b/)
      .map(texToText)
      .filter((n) => n.length >= 3 && n.length <= 80 && !/[@]/.test(n));
    if (names.length) meta.authors = [...new Set(names)].slice(0, 50);
  }
  const open = '\\begin{abstract}';
  const absStart = src.indexOf(open);
  const absEnd = absStart < 0 ? -1 : src.indexOf('\\end{abstract}', absStart);
  if (absEnd > 0) {
    const a = texToText(src.slice(absStart + open.length, absEnd));
    if (a.length >= 40) meta.abstract = a.slice(0, 3000);
  }
  const date = texArgument(src, 'date');
  const y = /\b(19[5-9]\d|20[0-3]\d)\b/.exec(date ?? '');
  if (y) meta.year = Number(y[1]);
  return meta;
}

/* ----------------------------- Markdown / rst ----------------------------- */

/** First ATX heading (`# Title`) by a line scan (no regex backtracking); returns the trimmed heading text. */
function firstHeading(src: string, maxLines = 5000): string | undefined {
  let pos = 0;
  for (let n = 0; n < maxLines && pos < src.length; n++) {
    let nl = src.indexOf('\n', pos);
    if (nl < 0) nl = src.length;
    if (src.charCodeAt(pos) === 35 /* # */ && (src.charAt(pos + 1) === ' ' || src.charAt(pos + 1) === '\t')) {
      let end = nl;
      while (end > pos + 1 && /[ \t#\r]/.test(src.charAt(end - 1))) end--;
      const text = src.slice(pos + 1, end).trim();
      if (text) return text;
    }
    pos = nl + 1;
  }
  return undefined;
}

function markdownMeta(full: string): PlainExtraction['meta'] {
  const src = head(full);
  const meta: PlainExtraction['meta'] = {};
  let body = src;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(src); // anchored at the start: one lazy scan, linear
  if (fm) {
    body = src.slice(fm[0].length);
    const t = /^title[ \t]{0,10}:[ \t]{0,10}(.+)$/im.exec(fm[1] as string);
    if (t) meta.title = squash((t[1] as string).replace(/^["']|["']$/g, '')).slice(0, 300);
    const a = /^authors?[ \t]{0,10}:[ \t]{0,10}(.+)$/im.exec(fm[1] as string);
    if (a) {
      const names = (a[1] as string)
        .replace(/^\[|\]$/g, '')
        .split(/,|;/)
        .map((n) => squash(n.replace(/^["']|["']$/g, '')))
        .filter(Boolean);
      if (names.length) meta.authors = names.slice(0, 50);
    }
    const d = /^date[ \t]{0,10}:[ \t]{0,10}(\d{4})/im.exec(fm[1] as string);
    if (d) meta.year = Number(d[1]);
  }
  if (!meta.title) {
    const h = firstHeading(body);
    if (h) meta.title = squash(h).slice(0, 300);
    else {
      const setext = /^(.{1,300})\r?\n(?:=+|-{3,})[ \t]*\r?$/m.exec(body);
      if (setext) meta.title = squash(setext[1] as string).slice(0, 300);
    }
  }
  return meta;
}

function rstMeta(full: string): PlainExtraction['meta'] {
  const m = /^([^\s].{0,299})\r?\n([=#*~^-])\2{3,}[ \t]*\r?$/m.exec(head(full));
  return m ? { title: squash(m[1] as string).slice(0, 300) } : {};
}

/* -------------------------------- Notebook -------------------------------- */

/** Largest notebook parsed: notebooks with embedded outputs get big, but never this big without being hostile. */
const MAX_NOTEBOOK_BYTES = 8 * 1024 * 1024;
const MAX_NOTEBOOK_DEPTH = 64;
const MAX_NOTEBOOK_CELLS = 20_000;
const MAX_CELL_CHARS = 1_000_000;

const malformed = (message: string, cause?: unknown) =>
  new AppError('IO_ERROR', message, { reason: 'malformed' }, cause === undefined ? undefined : { cause });

/** Nesting depth of a JSON text by one linear scan (strings skipped), so the parser never meets a pathological depth. */
function jsonDepthExceeds(src: string, limit: number): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (inString) {
      if (c === 92 /* \ */) i++;
      else if (c === 34 /* " */) inString = false;
    } else if (c === 34) inString = true;
    else if (c === 91 /* [ */ || c === 123 /* { */) {
      if (++depth > limit) return true;
    } else if ((c === 93 /* ] */ || c === 125 /* } */) && depth > 0) depth--;
  }
  return false;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function notebookText(data: Uint8Array): PlainExtraction {
  if (data.length > MAX_NOTEBOOK_BYTES) throw new AppError('IO_ERROR', 'Notebook too large', { reason: 'too-large' });
  const src = decodeText(data);
  if (jsonDepthExceeds(src, MAX_NOTEBOOK_DEPTH)) throw malformed('Notebook JSON is nested too deeply');
  let nb: unknown;
  try {
    nb = JSON.parse(src);
  } catch (e) {
    throw malformed('Notebook is not valid JSON', e);
  }
  if (!isRecord(nb) || !Array.isArray(nb['cells'])) throw malformed('Not a Jupyter notebook (no cells array)');
  const parts: string[] = [];
  let title: string | undefined;
  for (const c of nb['cells'].slice(0, MAX_NOTEBOOK_CELLS) as unknown[]) {
    if (!isRecord(c)) continue;
    const type = c['cell_type'];
    if (type !== 'markdown' && type !== 'code' && type !== 'raw') continue;
    const source = c['source'];
    let text = '';
    if (typeof source === 'string') text = source;
    else if (Array.isArray(source)) text = source.filter((x): x is string => typeof x === 'string').join('');
    if (text.length > MAX_CELL_CHARS) text = text.slice(0, MAX_CELL_CHARS);
    if (!text.trim()) continue;
    parts.push(text);
    if (!title && type === 'markdown') {
      const h = firstHeading(text, 200);
      if (h) title = squash(h).slice(0, 300);
    }
  }
  return { pages: [{ page: 1, text: parts.join('\n\n') }], meta: title ? { title } : {}, format: 'notebook' };
}

/* ------------------------------ docx / pptx ------------------------------ */

/**
 * Zip bomb limits. They are per ARCHIVE, not per entry: the sum of the inflated sizes of the entries we actually
 * inflate, and the number of entries of any kind. Entries we do not need are never inflated (filter returns false).
 */
export const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 2000;
/** Per-XML caps (inflated): a whole thesis is a few MiB of document.xml; slides and core.xml are far smaller. */
const MAX_DOCUMENT_XML = 32 * 1024 * 1024;
const MAX_SLIDE_XML = 8 * 1024 * 1024;
const MAX_CORE_XML = 1024 * 1024;

const tooLarge = (message: string) => new AppError('IO_ERROR', message, { reason: 'too-large' });

/** `capOf(name)` is the largest inflated size accepted for the entry, 0 when the entry is not wanted. */
function unzipEntries(data: Uint8Array, capOf: (name: string) => number): Record<string, Uint8Array> {
  let entries = 0;
  let total = 0;
  try {
    return unzipSync(data, {
      filter: (f) => {
        if (++entries > MAX_ARCHIVE_ENTRIES) throw tooLarge('Archive has too many entries');
        const cap = capOf(f.name);
        if (cap === 0) return false;
        // core.xml only adds optional metadata: an oversized one is skipped, it does not fail the document.
        if (f.originalSize > cap && f.name === 'docProps/core.xml') return false;
        if (f.originalSize > cap) throw tooLarge('Archive entry too large');
        total += f.originalSize;
        if (total > MAX_ARCHIVE_BYTES) throw tooLarge('Archive too large once unpacked');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('IO_ERROR', 'Office file cannot be unpacked', { reason: 'malformed' }, { cause: e });
  }
}

const utf8 = (u: Uint8Array | undefined): string => (u ? new TextDecoder('utf-8').decode(u) : '');

/** Text of the first `<name ...>text</name>` element, by index scans (a lazy regex is quadratic on unclosed tags). */
function xmlElementText(xml: string, name: string): string | undefined {
  const open = `<${name}`;
  const close = `</${name}>`;
  for (let i = xml.indexOf(open); i !== -1; i = xml.indexOf(open, i + 1)) {
    const after = xml.charAt(i + open.length);
    if (after !== '>' && after !== ' ' && after !== '\t' && after !== '\n' && after !== '\r' && after !== '/') continue;
    const gt = xml.indexOf('>', i);
    if (gt < 0) return undefined;
    if (xml.charAt(gt - 1) === '/') continue; // self-closing
    const end = xml.indexOf(close, gt + 1);
    if (end < 0) return undefined; // no closing tag anywhere after: none of the later openings can have one either
    return squash(decodeEntities(xml.slice(gt + 1, end)));
  }
  return undefined;
}

function coreMeta(xml: string): PlainExtraction['meta'] {
  const meta: PlainExtraction['meta'] = {};
  const title = xmlElementText(xml, 'dc:title');
  if (title) meta.title = title.slice(0, 300);
  const creator = xmlElementText(xml, 'dc:creator');
  if (creator) {
    const names = creator.split(/;|,|\band\b/).map(squash).filter(Boolean);
    if (names.length) meta.authors = names.slice(0, 50);
  }
  const y = yearFromDate(xmlElementText(xml, 'dcterms:created'));
  if (y) meta.year = y;
  return meta;
}

/**
 * Text of `<w:t>` / `<a:t>` runs, paragraph by paragraph. A single left-to-right tokenizer: every step moves forward
 * past the next `>`, so the cost is linear whatever the nesting or however many tags are left unclosed.
 */
function xmlParagraphs(xml: string, para: string, run: string): string[] {
  const out: string[] = [];
  let line = '';
  let inRun = false;
  const flush = () => {
    if (line.trim()) {
      // Blank lines and the blanks around a line break collapse into one "\n" (split/trim: a regex for this is quadratic).
      out.push(
        line
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .join('\n'),
      );
    }
    line = '';
    inRun = false;
  };
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    const textEnd = lt < 0 ? n : lt;
    if (inRun && textEnd > i) line += decodeEntities(xml.slice(i, textEnd));
    if (lt < 0) break;
    const gt = xml.indexOf('>', lt + 1);
    if (gt < 0) break; // an unterminated tag: nothing after it is markup we can trust
    i = gt + 1;
    const selfClosing = xml.charCodeAt(gt - 1) === 47; /* / */
    const closing = xml.charCodeAt(lt + 1) === 47;
    const inner = xml.slice(lt + (closing ? 2 : 1), selfClosing ? gt - 1 : gt);
    const sp = inner.search(/\s/);
    const name = sp < 0 ? inner : inner.slice(0, sp);
    const bare = sp < 0 || inner.slice(sp).trim() === '';
    if (closing) {
      if (name === para) flush();
      else if (name === run) inRun = false;
    } else if (name === para) {
      flush();
    } else if (name === run) {
      inRun = !selfClosing;
    } else if (bare && name === 'w:tab') {
      line += '\t';
    } else if (bare && (name === 'w:br' || name === 'a:br')) {
      line += '\n';
    }
  }
  flush();
  return out;
}

function docxText(data: Uint8Array): PlainExtraction {
  const files = unzipEntries(data, (n) => (n === 'word/document.xml' ? MAX_DOCUMENT_XML : n === 'docProps/core.xml' ? MAX_CORE_XML : 0));
  const doc = utf8(files['word/document.xml']);
  if (!doc) throw malformed('Not a Word document');
  const paragraphs = xmlParagraphs(doc, 'w:p', 'w:t');
  const meta = coreMeta(utf8(files['docProps/core.xml']));
  return { pages: [{ page: 1, text: paragraphs.join('\n') }], meta, format: 'docx' };
}

function pptxText(data: Uint8Array): PlainExtraction {
  const files = unzipEntries(data, (n) => (/^ppt\/slides\/slide\d+\.xml$/.test(n) ? MAX_SLIDE_XML : n === 'docProps/core.xml' ? MAX_CORE_XML : 0));
  const slides = Object.keys(files)
    .filter((n) => n.startsWith('ppt/slides/'))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]));
  if (slides.length === 0) throw malformed('Not a PowerPoint file');
  const pages = slides.map((n, i) => ({ page: i + 1, text: xmlParagraphs(utf8(files[n]), 'a:p', 'a:t').join('\n') }));
  const meta = coreMeta(utf8(files['docProps/core.xml']));
  if (!meta.title) {
    const first = pages[0]?.text.split('\n')[0];
    if (first && first.length <= 200) meta.title = squash(first);
  }
  return { pages, meta, format: 'pptx' };
}

/** Text and metadata of every supported non-PDF format. */
export function extractNonPdf(format: Format, data: Uint8Array): PlainExtraction {
  if (format === 'docx') return docxText(data);
  if (format === 'pptx') return pptxText(data);
  if (format === 'notebook') return notebookText(data);
  const text = decodeText(data);
  const meta = format === 'latex' ? latexMeta(text) : format === 'markdown' ? markdownMeta(text) : format === 'rst' ? rstMeta(text) : {};
  return { pages: [{ page: 1, text }], meta, format };
}
