import path from 'node:path';
import type { DocumentRecord } from '@rl/core';
import { titleKey, type BibEntry } from './entry.js';

/** What the matcher needs to know of a library document. */
export type LibDoc = Pick<DocumentRecord, 'id' | 'path' | 'aliasPaths' | 'hash' | 'previousHashes' | 'pdfWrite' | 'doi' | 'arxivId' | 'title' | 'year' | 'authors'>;

export interface LibIndex {
  byPath: Map<string, string>;
  byHash: Map<string, string>;
  byDoi: Map<string, string>;
  byArxiv: Map<string, string>;
  byTitle: Map<string, string>;
}

const lower = (p: string) => p.toLowerCase();
const familyOf = (a: string | undefined): string => titleKey((a ?? '').split(',')[0] ?? '');

export function buildIndex(docs: readonly LibDoc[]): LibIndex {
  const ix: LibIndex = { byPath: new Map(), byHash: new Map(), byDoi: new Map(), byArxiv: new Map(), byTitle: new Map() };
  for (const d of docs) {
    for (const p of [d.path, ...d.aliasPaths]) ix.byPath.set(lower(p), d.id);
    for (const h of [d.hash, ...d.previousHashes, ...(d.pdfWrite ? [d.pdfWrite.base.hash] : [])]) ix.byHash.set(h, d.id);
    if (d.doi) ix.byDoi.set(d.doi.toLowerCase(), d.id);
    if (d.arxivId) ix.byArxiv.set(d.arxivId.toLowerCase().replace(/v\d+$/, ''), d.id);
    const t = titleKey(d.title);
    if (t.length >= 12) {
      const k = `${t}|${d.year ?? ''}|${familyOf(d.authors[0])}`;
      // Two documents with the same key are ambiguous: neither matches by title.
      ix.byTitle.set(k, ix.byTitle.has(k) ? '' : d.id);
    }
  }
  return ix;
}

export type Resolution = { kind: 'library'; docId: string } | { kind: 'external'; files: string[] } | { kind: 'nofile' };

export interface Env {
  /** Folder the relative file paths start from. */
  base: string;
  /** Absolute root of the library. */
  root: string;
  index: LibIndex;
  /** SHA-256 of a PDF file that exists (read only), else null. */
  hashFile(abs: string): Promise<string | null>;
}

const inside = (root: string, abs: string): string | null => {
  const rel = path.relative(root, abs);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : null;
};

/** Finds the library document of an entry by its files (path inside the library, then content hash), then by identifiers, then by title. */
export async function resolveEntry(e: BibEntry, env: Env): Promise<Resolution> {
  const external: string[] = [];
  for (const f of e.files) {
    if (!/\.pdf$/i.test(f) || /^[a-z][a-z0-9+.-]{2,}:/i.test(f)) continue;
    const abs = path.isAbsolute(f) ? path.normalize(f) : path.resolve(env.base, f);
    const rel = inside(env.root, abs);
    const byPath = rel === null ? undefined : env.index.byPath.get(lower(rel));
    if (byPath) return { kind: 'library', docId: byPath };
    const h = await env.hashFile(abs);
    if (h === null) continue;
    const byHash = env.index.byHash.get(h);
    if (byHash) return { kind: 'library', docId: byHash };
    if (rel === null) external.push(abs);
  }
  const byDoi = e.doi ? env.index.byDoi.get(e.doi) : undefined;
  if (byDoi) return { kind: 'library', docId: byDoi };
  const byArxiv = e.arxivId ? env.index.byArxiv.get(e.arxivId.toLowerCase()) : undefined;
  if (byArxiv) return { kind: 'library', docId: byArxiv };
  const t = titleKey(e.title);
  const byTitle = t.length >= 12 ? env.index.byTitle.get(`${t}|${e.year ?? ''}|${familyOf(e.authors[0])}`) : undefined;
  if (byTitle) return { kind: 'library', docId: byTitle };
  return external.length > 0 ? { kind: 'external', files: external } : { kind: 'nofile' };
}
