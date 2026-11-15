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

/* ------------------------------- LaTeX ------------------------------- */

/** Content of the first balanced `{...}` after `\name` (optionally `\name[opt]`). */
function texArgument(src: string, name: string): string | undefined {
  const m = new RegExp(String.raw`\\${name}\*?\s*(?:\[[^\]]*\])?\s*\{`).exec(src);
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
function texToText(s: string): string {
  let t = s.replace(/(?<!\\)%.*$/gm, '');
  for (let i = 0; i < 3; i++) t = t.replace(/\\(?:thanks|footnote|inst|affil|affiliation|address|email|orcid)\*?\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}/g, '');
  t = t.replace(/\\\\|\\newline|\\and\b/g, ' ');
  t = t.replace(/\\(?:textbf|textit|emph|textsc|texttt|mathrm|mathbf|mbox|text)\s*\{([^{}]*)\}/g, '$1');
  t = t.replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, ' ').replace(/[{}]/g, '').replace(/~/g, ' ').replace(/\\(.)/g, '$1');
  return squash(t);
}

function latexMeta(src: string): PlainExtraction['meta'] {
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
  const abs = /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/.exec(src);
  if (abs) {
    const a = texToText(abs[1] as string);
    if (a.length >= 40) meta.abstract = a.slice(0, 3000);
  }
  const date = texArgument(src, 'date');
  const y = /\b(19[5-9]\d|20[0-3]\d)\b/.exec(date ?? '');
  if (y) meta.year = Number(y[1]);
  return meta;
}

/* ----------------------------- Markdown / rst ----------------------------- */

function markdownMeta(src: string): PlainExtraction['meta'] {
  const meta: PlainExtraction['meta'] = {};
  let body = src;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(src);
  if (fm) {
    body = src.slice(fm[0].length);
    const t = /^title\s*:\s*(.+)$/im.exec(fm[1] as string);
    if (t) meta.title = squash((t[1] as string).replace(/^["']|["']$/g, '')).slice(0, 300);
    const a = /^authors?\s*:\s*(.+)$/im.exec(fm[1] as string);
    if (a) {
      const names = (a[1] as string)
        .replace(/^\[|\]$/g, '')
        .split(/,|;/)
        .map((n) => squash(n.replace(/^["']|["']$/g, '')))
        .filter(Boolean);
      if (names.length) meta.authors = names.slice(0, 50);
    }
    const d = /^date\s*:\s*(\d{4})/im.exec(fm[1] as string);
    if (d) meta.year = Number(d[1]);
  }
  if (!meta.title) {
    const h = /^#\s+(.+?)\s*#*\s*$/m.exec(body);
    if (h) meta.title = squash(h[1] as string).slice(0, 300);
    else {
      const setext = /^(.+)\r?\n(?:=+|-{3,})\s*$/m.exec(body);
      if (setext) meta.title = squash(setext[1] as string).slice(0, 300);
    }
  }
  return meta;
}

function rstMeta(src: string): PlainExtraction['meta'] {
  const m = /^([^\s].*)\r?\n([=#*~^-])\2{3,}\s*$/m.exec(src);
  return m ? { title: squash(m[1] as string).slice(0, 300) } : {};
}

/* -------------------------------- Notebook -------------------------------- */

function notebookText(src: string): PlainExtraction {
  let nb: { cells?: Array<{ cell_type?: string; source?: string | string[] }> };
  try {
    nb = JSON.parse(src) as typeof nb;
  } catch (e) {
    throw new AppError('IO_ERROR', 'Notebook is not valid JSON', { reason: 'malformed' }, { cause: e });
  }
  const parts: string[] = [];
  let title: string | undefined;
  for (const c of nb.cells ?? []) {
    const text = Array.isArray(c.source) ? c.source.join('') : typeof c.source === 'string' ? c.source : '';
    if (!text.trim()) continue;
    if (c.cell_type !== 'markdown' && c.cell_type !== 'code' && c.cell_type !== 'raw') continue;
    parts.push(text);
    if (!title && c.cell_type === 'markdown') {
      const h = /^#\s+(.+)$/m.exec(text);
      if (h) title = squash(h[1] as string).slice(0, 300);
    }
  }
  return { pages: [{ page: 1, text: parts.join('\n\n') }], meta: title ? { title } : {}, format: 'notebook' };
}

/* ------------------------------ docx / pptx ------------------------------ */

/** Hard cap on one inflated zip entry: a few hundred KB of XML is normal, this stops zip bombs. */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

function unzipEntries(data: Uint8Array, wanted: (name: string) => boolean): Record<string, Uint8Array> {
  try {
    return unzipSync(data, {
      filter: (f) => {
        if (!wanted(f.name)) return false;
        if (f.originalSize > MAX_ENTRY_BYTES) throw new AppError('IO_ERROR', 'Archive entry too large', { reason: 'too-large' });
        return true;
      },
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('IO_ERROR', 'Office file cannot be unpacked', { reason: 'malformed' }, { cause: e });
  }
}

const utf8 = (u: Uint8Array | undefined): string => (u ? new TextDecoder('utf-8').decode(u) : '');

function coreMeta(xml: string): PlainExtraction['meta'] {
  const meta: PlainExtraction['meta'] = {};
  const tag = (name: string) => {
    const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
    return m ? squash(decodeEntities(m[1] as string)) : undefined;
  };
  const title = tag('dc:title');
  if (title) meta.title = title.slice(0, 300);
  const creator = tag('dc:creator');
  if (creator) {
    const names = creator.split(/;|,|\band\b/).map(squash).filter(Boolean);
    if (names.length) meta.authors = names.slice(0, 50);
  }
  const y = yearFromDate(tag('dcterms:created'));
  if (y) meta.year = y;
  return meta;
}

/** Text of `<w:t>` / `<a:t>` runs, paragraph by paragraph. */
function xmlParagraphs(xml: string, para: string, run: string): string[] {
  const out: string[] = [];
  const pRe = new RegExp(`<${para}[ >][\\s\\S]*?</${para}>`, 'g');
  const tokRe = new RegExp(`<${run}(?:\\s[^>]*)?>([\\s\\S]*?)</${run}>|<(?:w:tab|w:br|a:br)\\s*/?>`, 'g');
  for (const p of xml.match(pRe) ?? []) {
    let line = '';
    for (const m of p.matchAll(tokRe)) line += m[1] !== undefined ? decodeEntities(m[1]) : m[0].includes('tab') ? '\t' : '\n';
    if (line.trim()) out.push(line.replace(/\s*\n\s*/g, '\n').trim());
  }
  return out;
}

function docxText(data: Uint8Array): PlainExtraction {
  const files = unzipEntries(data, (n) => n === 'word/document.xml' || n === 'docProps/core.xml');
  const doc = utf8(files['word/document.xml']);
  if (!doc) throw new AppError('IO_ERROR', 'Not a Word document', { reason: 'malformed' });
  const paragraphs = xmlParagraphs(doc, 'w:p', 'w:t');
  const meta = coreMeta(utf8(files['docProps/core.xml']));
  return { pages: [{ page: 1, text: paragraphs.join('\n') }], meta, format: 'docx' };
}

function pptxText(data: Uint8Array): PlainExtraction {
  const files = unzipEntries(data, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n) || n === 'docProps/core.xml');
  const slides = Object.keys(files)
    .filter((n) => n.startsWith('ppt/slides/'))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]));
  if (slides.length === 0) throw new AppError('IO_ERROR', 'Not a PowerPoint file', { reason: 'malformed' });
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
  const text = decodeText(data);
  if (format === 'notebook') return notebookText(text);
  const meta = format === 'latex' ? latexMeta(text) : format === 'markdown' ? markdownMeta(text) : format === 'rst' ? rstMeta(text) : {};
  return { pages: [{ page: 1, text }], meta, format };
}
