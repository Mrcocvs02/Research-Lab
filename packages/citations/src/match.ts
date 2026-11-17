import type { CitationLink, DocumentRecord } from '@rl/core';
import { normaliseDoi } from './metadata.js';

/** `10.48550/arXiv.2401.01234` (the DOI arXiv gives its papers) to `2401.01234`. */
export const arxivFromDoi = (doi: string | null | undefined): string | null => /^10\.48550\/arxiv\.(.+)$/i.exec(doi ?? '')?.[1]?.toLowerCase() ?? null;

/** Lower case, no `arXiv:` prefix and no version. */
export const arxivBase = (id: string): string => id.trim().replace(/^arxiv:\s*/i, '').replace(/v\d+$/i, '').toLowerCase();

/** Letters and digits only, accents folded: two spellings of one title compare equal. */
export const titleKey = (t: string): string =>
  t
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Last name of "First Last" or "Last, First", folded. */
export function lastName(author: string | undefined): string {
  if (!author) return '';
  const a = author.includes(',') ? author.split(',')[0]! : (author.trim().split(/\s+/).pop() ?? '');
  return titleKey(a);
}

interface Keyed {
  doi?: string | null | undefined;
  arxivId?: string | null | undefined;
  title?: string | null | undefined;
  year?: number | null | undefined;
  authors?: readonly string[] | undefined;
}

/** `doi:` > `arxiv:` > `oa:` (a stored link's OpenAlex id). The key of a recommendation and of its dismissal. */
export function linkKey(l: Keyed & { externalId?: string | undefined }): string | null {
  const doi = l.doi ? normaliseDoi(l.doi) : '';
  const ax = l.arxivId ? arxivBase(l.arxivId) : arxivFromDoi(doi);
  if (doi && !arxivFromDoi(doi)) return `doi:${doi}`;
  if (ax) return `arxiv:${ax}`;
  if (doi) return `doi:${doi}`;
  if (l.externalId && /^W\d+$/.test(l.externalId)) return `oa:${l.externalId}`;
  return null;
}

interface OwnedEntry {
  id: string;
  title: string;
  year: number | null;
  last: string;
}

/** What matching needs of the library's documents (small: no record is kept). */
export interface OwnedIndex {
  byDoi: Map<string, string>;
  byArxiv: Map<string, string>;
  byTitle: Map<string, OwnedEntry[]>;
  size: number;
}

export function buildOwnedIndex(docs: Iterable<Pick<DocumentRecord, 'id' | 'doi' | 'arxivId' | 'title' | 'year' | 'authors'>>): OwnedIndex {
  const ix: OwnedIndex = { byDoi: new Map(), byArxiv: new Map(), byTitle: new Map(), size: 0 };
  for (const d of docs) {
    ix.size++;
    const doi = d.doi ? normaliseDoi(d.doi) : '';
    if (doi && !ix.byDoi.has(doi)) ix.byDoi.set(doi, d.id);
    const ax = d.arxivId ? arxivBase(d.arxivId) : arxivFromDoi(doi);
    if (ax && !ix.byArxiv.has(ax)) ix.byArxiv.set(ax, d.id);
    const t = d.title ? titleKey(d.title) : '';
    if (t.length >= 12) {
      const e: OwnedEntry = { id: d.id, title: t, year: d.year, last: lastName(d.authors[0]) };
      const list = ix.byTitle.get(t);
      if (list) list.push(e);
      else ix.byTitle.set(t, [e]);
    }
  }
  return ix;
}

/** Same work by title: equal normalised title, years at most one apart, same first-author last name; at least one of year and author must be known on both sides. */
export function sameWork(a: { title: string; year: number | null; last: string }, b: { title: string; year: number | null; last: string }): boolean {
  if (a.title !== b.title || a.title.length < 12) return false;
  const yearKnown = a.year !== null && b.year !== null;
  const authorKnown = a.last !== '' && b.last !== '';
  if (!yearKnown && !authorKnown) return false;
  return (!yearKnown || Math.abs(a.year! - b.year!) <= 1) && (!authorKnown || a.last === b.last);
}

/** The id of the library document a work is, or null. Never the document `selfId` itself. */
export function findOwned(ix: OwnedIndex, l: Keyed, selfId?: string): string | null {
  const doi = l.doi ? normaliseDoi(l.doi) : '';
  const ax = l.arxivId ? arxivBase(l.arxivId) : arxivFromDoi(doi);
  for (const id of [doi ? ix.byDoi.get(doi) : undefined, ax ? ix.byArxiv.get(ax) : undefined]) if (id && id !== selfId) return id;
  const t = l.title ? titleKey(l.title) : '';
  const me = { title: t, year: l.year ?? null, last: lastName(l.authors?.[0]) };
  for (const e of ix.byTitle.get(t) ?? []) if (e.id !== selfId && sameWork(me, e)) return e.id;
  return null;
}

/** Links with `matchedDocId` set (or cleared) against the current documents. */
export function matchLinks(links: CitationLink[], ix: OwnedIndex, selfId?: string): CitationLink[] {
  return links.map((l) => ({ ...l, matchedDocId: findOwned(ix, l, selfId) }));
}
