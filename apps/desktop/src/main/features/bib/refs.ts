import path from 'node:path';
import { AppError, EXPORT_LIMITS, type ExportSelection } from '@rl/core';
import { ExportTarget, isInsideLibrary } from '../../export/target.js';
import { collect } from '../../export/collect.js';
import type { MainServices } from '../../ipc/handlers/services.js';
import { bibtexFile, safeKey, type BibDoc } from './bibtex-write.js';

export type RefFormat = 'bibtex' | 'ris' | 'csl';
export const EXTENSION: Record<RefFormat, string> = { bibtex: 'bib', ris: 'ris', csl: 'json' };
type Item = { doc: BibDoc; key: string };

const PROCEEDINGS = /proceedings|conference|workshop|symposium|congress|meeting/i;
const one = (s: string): string => s.replace(/[\r\n]+/g, ' ').trim();

/** RIS (one record per reference, tags of two letters, `ER` closes it). */
export function risFile(items: readonly Item[]): string {
  const out: string[] = [];
  for (const { doc: d, key } of [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    const venue = d.ref.venue ?? null;
    const tag = (t: string, v: string | null | undefined) => v && out.push(`${t}  - ${one(v)}`);
    tag('TY', venue === null ? 'GEN' : PROCEEDINGS.test(venue) ? 'CPAPER' : 'JOUR');
    tag('ID', safeKey(key));
    tag('TI', d.title);
    for (const a of d.authors) tag('AU', a);
    if (d.year !== null) tag('PY', String(d.year));
    tag(venue !== null && PROCEEDINGS.test(venue) ? 'T2' : 'JO', venue);
    tag('M1', d.ref.venueRef);
    tag('DO', d.doi);
    if (d.arxivId) out.push(`UR  - https://arxiv.org/abs/${one(d.arxivId)}`);
    out.push('ER  - ', '');
  }
  return out.join('\r\n');
}

/** "Family, Given" or "Given Family" as a CSL name. */
function csName(a: string): { family?: string; given?: string; literal?: string } {
  const t = a.trim();
  const i = t.indexOf(',');
  if (i > 0) return { family: t.slice(0, i).trim(), given: t.slice(i + 1).trim() };
  const parts = t.split(/\s+/);
  return parts.length > 1 ? { family: parts[parts.length - 1]!, given: parts.slice(0, -1).join(' ') } : { literal: t };
}

/** CSL JSON: an array of items, keys as `id` and `citation-key`. */
export function cslFile(items: readonly Item[]): string {
  const rows = [...items]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ doc: d, key }) => {
      const venue = d.ref.venue ?? null;
      return {
        id: safeKey(key),
        'citation-key': safeKey(key),
        type: venue === null ? 'document' : PROCEEDINGS.test(venue) ? 'paper-conference' : 'article-journal',
        ...(d.title ? { title: d.title } : {}),
        ...(d.authors.length > 0 ? { author: d.authors.map(csName) } : {}),
        ...(d.year !== null ? { issued: { 'date-parts': [[d.year]] } } : {}),
        ...(venue !== null ? { 'container-title': venue } : {}),
        ...(d.ref.venueRef ? { note: d.ref.venueRef } : {}),
        ...(d.doi ? { DOI: d.doi } : {}),
        ...(d.arxivId ? { URL: `https://arxiv.org/abs/${d.arxivId}` } : {}),
      };
    });
  return `${JSON.stringify(rows, null, 2)}\n`;
}

export const render = (format: RefFormat, items: readonly Item[]): string => (format === 'ris' ? risFile(items) : format === 'csl' ? cslFile(items) : bibtexFile(items));

const BASE = /^[^<>:"/\\|?*\u0000-\u001f]+$/;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** Writes `text` as `base.ext`, `base-2.ext`... : the first name that does not exist, created exclusively (nothing is overwritten, even in a race). */
async function writeFree(target: ExportTarget, base: string, ext: string, text: string | Uint8Array): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const file = n === 1 ? `${base}.${ext}` : `${base}-${n}.${ext}`;
    if (await target.writeNew(file, text)) return file;
  }
  throw new AppError('CONFLICT', 'Too many files with this name', { reason: 'exists' });
}

async function folderOf(s: MainServices, destination: string, fileName: string | undefined, ext: string, fallback: string): Promise<{ target: ExportTarget; base: string }> {
  const rt = await s.runtime.require();
  const dir = s.approved.resolve(destination, 'export-destination');
  if (dir === null) throw new AppError('INVALID_REQUEST', 'The folder was not chosen with the folder dialog', { reason: 'destination-not-approved' });
  if (await isInsideLibrary(rt.store.rootPath, dir)) throw new AppError('CONFLICT', 'The file cannot be inside the library folder', { reason: 'inside-library' });
  const base = (fileName?.trim() || fallback).replace(new RegExp(`\\.${ext}$`, 'i'), '');
  if (!BASE.test(base) || RESERVED.test(base) || /[. ]$/.test(base) || base.length > 100) throw new AppError('INVALID_REQUEST', 'Not a valid file name', { reason: 'invalid-name' });
  return { target: new ExportTarget(dir), base };
}

/** The PRISMA diagram (SVG) or its table (Markdown), the Map as SVG or PNG, written as a new file in a folder chosen by the user. */
export async function saveText(s: MainServices, req: { destination: string; fileName: string; ext: 'svg' | 'md' | 'pdf' | 'png'; text: string; base64?: boolean | undefined }): Promise<{ file: string }> {
  if ((req.ext === 'png') !== (req.base64 === true) || req.text.length > (req.ext === 'png' ? 8_000_000 : req.ext === 'svg' ? 2_000_000 : 400_000)) throw new AppError('INVALID_REQUEST', 'The text is too long for this kind of file', { reason: 'too-long' });
  const { target, base } = await folderOf(s, req.destination, req.fileName, req.ext, req.ext === 'png' || req.ext === 'svg' ? 'map' : 'prisma');
  // `pdf`: the text is the Markdown of a report, laid out as a plain PDF (loaded only now). `png`: the bytes, in base64.
  if (req.ext === 'png') {
    const bytes = Buffer.from(req.text, 'base64');
    // Not an image (or damaged): nothing is written. The signature of a PNG file is fixed.
    if (bytes.length < 8 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a) throw new AppError('INVALID_REQUEST', 'Not a PNG image', { reason: 'not-png' });
    return { file: await writeFree(target, base, 'png', bytes) };
  }
  const text = req.ext === 'pdf' ? (await import('../project/pdf.js')).reportPdf(req.text) : req.text;
  return { file: await writeFree(target, base, req.ext, text) };
}

/**
 * "Export…" with the reference formats: the documents of the selection to a new file in a folder chosen by the user. A file
 * that exists is never overwritten: the name gets a number. Keys come from the library's schema (existing ones are kept).
 */
export async function exportRefs(
  s: MainServices,
  req: { selection: ExportSelection; format: RefFormat; destination: string; fileName?: string | undefined },
  keys: (ids: readonly string[]) => Promise<Item[]>,
): Promise<{ count: number; file: string }> {
  const rt = await s.runtime.require();
  const { target, base } = await folderOf(s, req.destination, req.fileName, EXTENSION[req.format], 'references');
  const { docs } = await collect(s, rt, req.selection);
  if (docs.length === 0) throw new AppError('INVALID_REQUEST', 'Nothing to export', { reason: 'empty' });
  if (docs.length > EXPORT_LIMITS.documents) throw new AppError('INVALID_REQUEST', 'Too many documents', { reason: 'too-many' });
  const text = render(req.format, await keys(docs.map((d) => d.id)));
  const file = await writeFree(target, base, EXTENSION[req.format], text);
  return { count: docs.length, file: path.basename(file) };
}
