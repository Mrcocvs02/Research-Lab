// Synthetic research corpus generator (phase 1): many documents quickly, with known "sentinel" words in known
// places, so that scan, extraction, ranking and page numbers can be checked against a manifest.
// Everything is invented: terms, authors, titles. Same seed, same corpus.
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { IndexableDocument } from '@rl/core';
import { seededRandom } from './png';
import { fsPath } from './snapshot';
import { removeTree } from './fixtures';

export type CorpusFormat = 'md' | 'txt' | 'pdf';
export type CorpusLanguage = 'it' | 'en';
export type SentinelField = 'title' | 'abstract' | 'body';

/** A word that exists in exactly one document, in a known place. */
export interface CorpusSentinel {
  /** Word as written in the document (may carry accents). */
  word: string;
  /** What a user would type and a diacritic-insensitive index must match (lower case, no accents). */
  folded: string;
  field: SentinelField;
  /** 1-based page of the body occurrence (PDF) or 1 for text files. */
  page: number;
  relPath: string;
  format: CorpusFormat;
  title: string;
}

export type CorpusQueryKind = 'rare' | 'rare-pair' | 'common-pair' | 'acronym' | 'accent' | 'sentinel';

export interface CorpusQuery {
  text: string;
  kind: CorpusQueryKind;
  /** Document that must be among the hits (rare, rare-pair and sentinel queries); absent for generic queries. */
  expectRelPath?: string;
}

export interface CorpusEntry {
  index: number;
  /** Forward-slash path relative to the library root. */
  relPath: string;
  format: CorpusFormat;
  language: CorpusLanguage;
  title: string;
  authors: string[];
  abstract: string;
  year: number;
  /** Coined word that appears in the title and abstract of this document only. */
  topicTerm: string;
  /** Full text per page (text files have one page). */
  pages: string[];
  pageCount: number;
  sha256: string;
  size: number;
}

export interface CorpusManifest {
  count: number;
  seed: number;
  files: CorpusEntry[];
  dirs: string[];
  sentinels: CorpusSentinel[];
  /** Typical queries (about twenty) with the expected document where it is certain. */
  queries: CorpusQuery[];
  pdfCount: number;
  get(relPath: string): CorpusEntry | undefined;
  sentinel(field: SentinelField, format?: CorpusFormat): CorpusSentinel;
}

export interface CorpusOptions {
  seed?: number;
  /** Share of PDF documents, 0..1 (default 0.05). Sentinel documents are placed regardless. */
  pdfShare?: number;
  language?: CorpusLanguage | 'mixed';
  /** Number of top-level folders (default about the square root of the count, at least 3). */
  folders?: number;
  /** Page of the body sentinel in its PDF (default 3). */
  sentinelPage?: number;
  /** Words of body text per page (default 130). */
  wordsPerPage?: number;
  /** Where the temporary folder is created (default: OS temp dir). */
  parent?: string;
}

export interface Corpus {
  root: string;
  manifest: CorpusManifest;
  cleanup(): Promise<void>;
}

/** Smallest corpus that can hold all sentinel documents. */
export const MIN_CORPUS_SIZE = 6;

/** Fixed sentinel words: invented, with syllables that the vocabulary generator never produces. */
export const SENTINEL_WORDS = {
  title: 'zorquantel',
  abstract: 'velmarixon',
  bodyPdf: 'quillanbrox',
  bodyText: 'drivostenal',
  accent: 'ménagèrix',
} as const;

/* ------------------------------ vocabulary ------------------------------ */

const SYLLABLES = ['ba', 'be', 'bi', 'bo', 'ca', 'ce', 'co', 'da', 'de', 'di', 'fa', 'fo', 'ga', 'ge', 'ka', 'la', 'le', 'li', 'lo', 'ma', 'me', 'mi', 'na', 'ne', 'no', 'pa', 'pe', 'ra', 're', 'ri', 'ro', 'sa', 'se', 'ta', 'te', 'ti', 'to', 'va', 've', 'tri', 'pho', 'ther', 'ner', 'mon', 'lin', 'tor', 'cel', 'gen', 'kin'];
const SUFFIXES = ['ine', 'ase', 'ose', 'ium', 'oid', 'one', 'ite', 'ide', 'ics', 'ene', 'yl', 'in'];

const COMMON: Record<CorpusLanguage, string[]> = {
  en: ['model', 'method', 'analysis', 'results', 'data', 'system', 'network', 'learning', 'estimation', 'distribution', 'sampling', 'framework', 'evidence', 'theory', 'experiment', 'measure', 'structure', 'dynamics', 'noise', 'signal', 'energy', 'surface', 'gradient', 'process', 'variable', 'function', 'sequence', 'cluster', 'pattern', 'response', 'control', 'design', 'approach', 'performance', 'robust', 'adaptive', 'efficient', 'general', 'local', 'global', 'stable', 'sparse', 'dense', 'we', 'show', 'that', 'the', 'of', 'in', 'for', 'with', 'and', 'on', 'this', 'paper', 'propose', 'compare', 'evaluate', 'observe', 'study'],
  it: ['modello', 'metodo', 'analisi', 'risultati', 'dati', 'sistema', 'rete', 'apprendimento', 'stima', 'distribuzione', 'campionamento', 'struttura', 'dinamica', 'rumore', 'segnale', 'energia', 'superficie', 'processo', 'variabile', 'funzione', 'sequenza', 'modelli', 'risposta', 'controllo', 'approccio', 'prestazioni', 'robusto', 'adattivo', 'efficiente', 'generale', 'locale', 'globale', 'stabile', 'però', 'perché', 'così', 'qualità', 'città', 'è', 'più', 'già', 'già', 'università', 'velocità', 'proprietà', 'mostriamo', 'che', 'il', 'di', 'in', 'per', 'con', 'una', 'sul', 'questo', 'articolo', 'proponiamo', 'confrontiamo', 'valutiamo', 'osserviamo', 'studio'],
};

const ACRONYMS = ['GPU', 'CPU', 'RNN', 'CNN', 'PCA', 'SVD', 'MCMC', 'KL', 'SGD', 'ELBO', 'FFT', 'ODE', 'PDE', 'LSTM', 'BERT', 'DNA', 'RNA', 'MRI', 'EEG', 'SNR'];

const AUTHOR_FIRST = ['Ada', 'Bruno', 'Clara', 'Dario', 'Elena', 'Fabio', 'Gaia', 'Hugo', 'Irene', 'Jonas', 'Katia', 'Luca', 'Marta', 'Nico', 'Olga', 'Pablo'];
const AUTHOR_LAST = ['Placeholder', 'Exemplar', 'Testwell', 'Samplera', 'Fixturi', 'Mockson', 'Stubbs', 'Dummari', 'Synthi', 'Faker', 'Invented', 'Nobody'];

const FOLDER_NAMES = ['area', 'tema', 'topic', 'serie', 'gruppo', 'campo'];

function pick<T>(rnd: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)]!;
}

function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* --------------------------- in-memory documents --------------------------- */

interface Draft {
  index: number;
  relPath: string;
  format: CorpusFormat;
  language: CorpusLanguage;
  title: string;
  authors: string[];
  abstract: string;
  year: number;
  topicTerm: string;
  pages: string[];
}

interface Plan {
  drafts: Draft[];
  sentinels: CorpusSentinel[];
  dirs: string[];
  seed: number;
}

function planCorpus(count: number, opts: CorpusOptions): Plan {
  if (!Number.isInteger(count) || count < MIN_CORPUS_SIZE) throw new Error(`generateCorpus: count must be an integer >= ${MIN_CORPUS_SIZE}`);
  const seed = opts.seed ?? 1;
  const rnd = seededRandom(seed * 7919 + count);
  const pdfShare = Math.min(1, Math.max(0, opts.pdfShare ?? 0.05));
  const lang = opts.language ?? 'mixed';
  const sentinelPage = Math.max(1, opts.sentinelPage ?? 3);
  const wordsPerPage = Math.max(20, opts.wordsPerPage ?? 130);
  const folderCount = Math.max(3, opts.folders ?? Math.round(Math.sqrt(count) / 2));

  // Pool of coined technical terms, unique, shared across documents (realistic repetition).
  const used = new Set<string>(Object.values(SENTINEL_WORDS).map((w) => stripAccents(w)));
  const coin = (): string => {
    for (;;) {
      const n = 2 + Math.floor(rnd() * 2);
      let w = '';
      for (let i = 0; i < n; i++) w += pick(rnd, SYLLABLES);
      w += pick(rnd, SUFFIXES);
      if (!used.has(w)) {
        used.add(w);
        return w;
      }
    }
  };
  const poolTerms = Array.from({ length: Math.min(600, Math.max(60, count)) }, coin);

  const sentence = (language: CorpusLanguage, words: number): string => {
    const out: string[] = [];
    for (let i = 0; i < words; i++) {
      const r = rnd();
      out.push(r < 0.18 ? pick(rnd, poolTerms) : r < 0.22 ? pick(rnd, ACRONYMS) : pick(rnd, COMMON[language]));
    }
    return out.join(' ');
  };
  const paragraph = (language: CorpusLanguage, words: number): string => {
    const parts: string[] = [];
    let left = words;
    while (left > 0) {
      const w = Math.min(left, 8 + Math.floor(rnd() * 10));
      parts.push(`${cap(sentence(language, w))}.`);
      left -= w;
    }
    return parts.join(' ');
  };

  const dirs = new Set<string>();
  const folderFor = (i: number): string => {
    const f = i % folderCount;
    const base = `${FOLDER_NAMES[f % FOLDER_NAMES.length]!}-${String(f + 1).padStart(2, '0')}`;
    const rel = f % 4 === 3 ? `${base}/sub-${String.fromCharCode(97 + (i % 3))}` : base;
    const parts = rel.split('/');
    for (let k = 1; k <= parts.length; k++) dirs.add(parts.slice(0, k).join('/'));
    return rel;
  };

  // Sentinel documents come first: fixed positions, fixed places.
  const pdfTotal = Math.max(2, Math.round(count * pdfShare));
  const formatOf = (i: number): CorpusFormat => {
    if (i === 2) return 'pdf'; // body sentinel on a PDF page
    if (i === 3) return 'md';
    if (i < 6) return 'md';
    // Spread the remaining PDFs evenly; the rest alternate md / txt.
    const slot = i - 6;
    const rest = count - 6;
    const pdfsLeft = pdfTotal - 1;
    if (pdfsLeft > 0 && Math.floor(((slot + 1) * pdfsLeft) / rest) > Math.floor((slot * pdfsLeft) / rest)) return 'pdf';
    return slot % 2 === 0 ? 'md' : 'txt';
  };

  const drafts: Draft[] = [];
  const sentinels: CorpusSentinel[] = [];
  for (let i = 0; i < count; i++) {
    const language: CorpusLanguage = lang === 'mixed' ? (rnd() < 0.7 ? 'en' : 'it') : lang;
    const format = formatOf(i);
    const topicTerm = coin();
    const term2 = pick(rnd, poolTerms);
    let title =
      language === 'en'
        ? `${cap(pick(rnd, ['adaptive', 'robust', 'efficient', 'sparse', 'stable']))} ${pick(rnd, ['estimation', 'analysis', 'sampling', 'control', 'learning'])} of ${cap(topicTerm)} in ${pick(rnd, ACRONYMS)} ${term2} systems`
        : `${cap(pick(rnd, ['stima', 'analisi', 'controllo', 'apprendimento']))} ${pick(rnd, ['adattiva', 'robusta', 'efficiente', 'stabile'])} di ${cap(topicTerm)} nei sistemi ${term2}`;
    let abstractText = `${cap(topicTerm)}: ${paragraph(language, 45)}`;
    const nPages = format === 'pdf' ? 2 + Math.floor(rnd() * 3) : 1;
    const pages = Array.from({ length: nPages }, () => paragraph(language, wordsPerPage));

    const rel = (name: string) => `${folderFor(i)}/${name}`;
    const slug = `${topicTerm}-${String(i).padStart(4, '0')}`;
    let relPath = rel(`${slug}.${format}`);

    const addSentinel = (word: string, field: SentinelField, page: number) => {
      sentinels.push({ word, folded: stripAccents(word).toLowerCase(), field, page, relPath, format, title });
    };
    if (i === 0) {
      title = `${cap(SENTINEL_WORDS.title)} ${title}`;
      addSentinel(SENTINEL_WORDS.title, 'title', 1);
    } else if (i === 1) {
      abstractText = `${abstractText} ${SENTINEL_WORDS.abstract} ${sentence(language, 6)}.`;
      addSentinel(SENTINEL_WORDS.abstract, 'abstract', 1);
    } else if (i === 2) {
      const total = Math.max(nPages, sentinelPage);
      while (pages.length < total) pages.push(paragraph(language, wordsPerPage));
      pages[sentinelPage - 1] = `${pages[sentinelPage - 1]!} ${SENTINEL_WORDS.bodyPdf} ${sentence(language, 6)}.`;
      addSentinel(SENTINEL_WORDS.bodyPdf, 'body', sentinelPage);
    } else if (i === 3) {
      pages[0] = `${pages[0]!}\n\n${paragraph(language, 30)} ${SENTINEL_WORDS.bodyText} ${sentence(language, 6)}.`;
      addSentinel(SENTINEL_WORDS.bodyText, 'body', 1);
    } else if (i === 4) {
      title = `${cap(SENTINEL_WORDS.accent)} ${title}`;
      addSentinel(SENTINEL_WORDS.accent, 'title', 1);
    }
    const first = pick(rnd, AUTHOR_FIRST);
    const authors = [`${first} ${pick(rnd, AUTHOR_LAST)}`, `${pick(rnd, AUTHOR_FIRST)} ${pick(rnd, AUTHOR_LAST)}`];
    drafts.push({ index: i, relPath, format, language, title, authors, abstract: abstractText, year: 2000 + Math.floor(rnd() * 25), topicTerm, pages });
  }
  // Titles of sentinel entries were extended after the sentinel was recorded.
  for (const s of sentinels) s.title = drafts.find((d) => d.relPath === s.relPath)!.title;
  return { drafts, sentinels, dirs: [...dirs].sort(), seed };
}

/** Text of a Markdown / plain-text document: title, authors, abstract, then the body. */
function renderText(d: Draft): string {
  const body = d.pages.join('\n\n');
  if (d.format === 'md') return `# ${d.title}\n\n${d.authors.join(', ')}\n\n## Abstract\n\n${d.abstract}\n\n## ${d.language === 'en' ? 'Introduction' : 'Introduzione'}\n\n${body}\n`;
  return `${d.title}\n${d.authors.join(', ')}\n\nAbstract\n${d.abstract}\n\n${body}\n`;
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      if ((line + ' ' + w).trim().length > width) {
        lines.push(line);
        line = w;
      } else line = (line + ' ' + w).trim();
    }
    lines.push(line);
  }
  return lines;
}

async function renderPdf(d: Draft): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(d.title);
  doc.setAuthor(d.authors.join('; '));
  doc.setProducer('rl-testkit-corpus');
  const fixed = new Date('2024-01-15T10:00:00Z');
  doc.setCreationDate(fixed);
  doc.setModificationDate(fixed);
  d.pages.forEach((text, pi) => {
    const page = doc.addPage([595, 842]);
    let y = 790;
    const line = (s: string, size: number, f = font) => {
      if (!s) {
        y -= size;
        return;
      }
      page.drawText(s, { x: 50, y, size, font: f, color: rgb(0, 0, 0) });
      y -= size + 4;
    };
    if (pi === 0) {
      for (const l of wrap(d.title, 70)) line(l, 15, bold);
      line(d.authors.join(', '), 10);
      line('', 10);
      line('Abstract', 11, bold);
      for (const l of wrap(d.abstract, 95)) line(l, 9);
      line('', 10);
    }
    for (const l of wrap(text, 95)) {
      if (y < 60) break;
      line(l, 9);
    }
  });
  return doc.save({ useObjectStreams: false });
}

/* -------------------------------- queries -------------------------------- */

function buildQueries(plan: Plan, count = 20): CorpusQuery[] {
  const rnd = seededRandom(plan.seed * 31 + plan.drafts.length);
  const docs = plan.drafts;
  const pickDoc = () => docs[6 + Math.floor(rnd() * Math.max(1, docs.length - 6))] ?? docs[0]!;
  const out: CorpusQuery[] = [];
  const first = (kind: SentinelField, fmt?: CorpusFormat) => plan.sentinels.find((s) => s.field === kind && (!fmt || s.format === fmt))!;
  const plot: CorpusQueryKind[] = ['rare', 'rare', 'rare', 'rare', 'rare', 'rare', 'rare-pair', 'rare-pair', 'rare-pair', 'rare-pair', 'common-pair', 'common-pair', 'common-pair', 'common-pair', 'acronym', 'acronym', 'accent', 'accent', 'sentinel', 'sentinel'];
  for (let q = 0; q < count; q++) {
    const kind = plot[q % plot.length]!;
    if (kind === 'rare') {
      const d = pickDoc();
      out.push({ text: d.topicTerm, kind, expectRelPath: d.relPath });
    } else if (kind === 'rare-pair') {
      const d = pickDoc();
      const m = /\b(\w+) systems?$/.exec(d.title) ?? /\bsistemi (\w+)$/.exec(d.title);
      out.push({ text: `${d.topicTerm}${m?.[1] ? ` ${m[1]}` : ''}`, kind, expectRelPath: d.relPath });
    } else if (kind === 'common-pair') {
      const lang = q % 2 === 0 ? 'en' : 'it';
      out.push({ text: `${pick(rnd, COMMON[lang].slice(0, 30))} ${pick(rnd, COMMON[lang].slice(0, 30))}`, kind });
    } else if (kind === 'acronym') {
      out.push({ text: pick(rnd, ACRONYMS), kind });
    } else if (kind === 'accent') {
      out.push({ text: pick(rnd, ['qualità', 'università', 'velocità', 'perché', 'proprietà']), kind });
    } else {
      const s = q % 2 === 0 ? first('title') : first('body', 'pdf');
      out.push({ text: s.folded, kind, expectRelPath: s.relPath });
    }
  }
  return out;
}

/* --------------------------------- public --------------------------------- */

function makeManifest(plan: Plan, entries: CorpusEntry[]): CorpusManifest {
  const byPath = new Map(entries.map((e) => [e.relPath, e]));
  return {
    count: entries.length,
    seed: plan.seed,
    files: entries,
    dirs: plan.dirs,
    sentinels: plan.sentinels,
    queries: buildQueries(plan),
    pdfCount: entries.filter((e) => e.format === 'pdf').length,
    get: (rel) => byPath.get(rel),
    sentinel(field, format) {
      const s = plan.sentinels.find((x) => x.field === field && (!format || x.format === format));
      if (!s) throw new Error(`no sentinel for ${field}${format ? `/${format}` : ''}`);
      return s;
    },
  };
}

async function inPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

/**
 * Creates a library of `count` documents in a fresh temporary folder: mostly Markdown and plain text,
 * a configurable share of small PDFs, invented scientific vocabulary (Italian and English, accents,
 * acronyms) and five sentinel words in known places (`manifest.sentinels`). 1000 documents take a few seconds.
 * Content is unique per document, so every file gets its own id.
 */
export async function generateCorpus(count: number, opts: CorpusOptions = {}): Promise<Corpus> {
  const plan = planCorpus(count, opts);
  const base = await mkdtemp(path.join(opts.parent ?? os.tmpdir(), 'rl-corpus-'));
  const root = path.join(base, 'library');
  const cleanup = () => removeTree(base);
  try {
    await mkdir(root);
    for (const d of plan.dirs) await mkdir(path.join(root, ...d.split('/')), { recursive: true });
    const entries: CorpusEntry[] = new Array<CorpusEntry>(plan.drafts.length);
    await inPool(plan.drafts, 16, async (d) => {
      const data = d.format === 'pdf' ? await renderPdf(d) : Buffer.from(renderText(d), 'utf8');
      await writeFile(fsPath(path.join(root, ...d.relPath.split('/'))), data);
      entries[d.index] = { ...d, pageCount: d.pages.length, sha256: sha256(data), size: data.length };
    });
    return { root, manifest: makeManifest(plan, entries), cleanup };
  } catch (e) {
    await cleanup().catch(() => {});
    throw e;
  }
}

/** The manifest alone, with no files on disk (hashes and sizes computed from the text; PDFs approximate). */
export function generateCorpusManifest(count: number, opts: CorpusOptions = {}): CorpusManifest {
  const plan = planCorpus(count, opts);
  const entries = plan.drafts.map((d) => {
    const text = d.format === 'pdf' ? d.pages.join('\f') : renderText(d);
    return { ...d, pageCount: d.pages.length, sha256: sha256(`${d.relPath}\0${text}`), size: Buffer.byteLength(text) };
  });
  return makeManifest(plan, entries);
}

export interface IndexableCorpus {
  documents: IndexableDocument[];
  manifest: CorpusManifest;
}

/** The same corpus as `IndexableDocument` objects, for index benchmarks with no disk involved. */
export function generateIndexableDocuments(count: number, opts: CorpusOptions = {}): IndexableCorpus {
  const manifest = generateCorpusManifest(count, opts);
  const stamp = '2024-01-15T10:00:00.000Z';
  const documents: IndexableDocument[] = manifest.files.map((e) => ({
    record: {
      schemaVersion: 1,
      id: e.sha256.slice(0, 16),
      hash: e.sha256,
      previousHashes: [],
      path: e.relPath,
      pathHistory: [],
      aliasPaths: [],
      revision: 0,
      size: e.size,
      mtimeMs: Date.parse(stamp),
      missing: false,
      type: null,
      title: e.title,
      authors: e.authors,
      year: e.year,
      lang: e.language,
      ref: {},
      doi: null,
      arxivId: null,
      publication: { status: 'unknown' },
      tags: [],
      study: { state: 'to-read', underlined: { value: false, origin: 'manual' } },
      ai: {},
      addedAt: stamp,
      updatedAt: stamp,
    },
    pages:
      e.format === 'pdf'
        ? e.pages.map((text, i) => ({ page: i + 1, text: i === 0 ? `${e.title}\n${e.abstract}\n${text}` : text }))
        : [{ page: 1, text: `${e.title}\n${e.abstract}\n${e.pages[0]!}` }],
  }));
  return { documents, manifest };
}

/**
 * Writes a small text PDF for tests (and the e2e): title, authors and year on the first page, then the identifiers
 * (`DOI: ...`, `arXiv:...`) and the body. Same renderer as the corpus, fixed dates, so the same input gives the same bytes.
 */
export async function writeSyntheticPdf(file: string, d: { title: string; authors: string[]; year: number; body: string; doi?: string; arxivId?: string }): Promise<void> {
  const ids = [String(d.year), d.doi ? `DOI: ${d.doi}` : '', d.arxivId ? `arXiv:${d.arxivId} [cs.XX] 02 Jan ${d.year}` : ''].filter(Boolean).join('\n');
  const draft = { title: d.title, authors: d.authors, abstract: d.body, year: d.year, pages: [ids] } as unknown as Draft;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, await renderPdf(draft));
}
