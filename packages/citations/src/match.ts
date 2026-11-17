import type { CitationLink, DocumentRecord } from '@rl/core';
import { normaliseDoi } from './metadata.js';

/** `10.48550/arXiv.2401.01234` (the DOI arXiv gives its papers; `v2` after it is dropped) to `2401.01234`. */
export const arxivFromDoi = (doi: string | null | undefined): string | null => /^10\.48550\/arxiv\.(.+)$/i.exec(doi ?? '')?.[1]?.replace(/v\d+$/i, '').toLowerCase() ?? null;

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

/**
 * Every identity a link has, best first: `doi:` (a journal DOI), `arxiv:`, `doi:` of the arXiv DOI, `oa:` (a stored
 * link's OpenAlex id). One work can be keyed differently by two sources (OpenAlex gives DOI and arXiv id, Semantic
 * Scholar only the arXiv id), so counts and dismissals work on the set, not on one key.
 */
export function linkKeys(l: Keyed & { externalId?: string | undefined }): string[] {
  const doi = l.doi ? normaliseDoi(l.doi) : '';
  const ax = l.arxivId ? arxivBase(l.arxivId) : arxivFromDoi(doi);
  const keys: string[] = [];
  if (doi && !arxivFromDoi(doi)) keys.push(`doi:${doi}`);
  if (ax) keys.push(`arxiv:${ax}`);
  if (doi && arxivFromDoi(doi)) keys.push(`doi:${doi}`);
  if (l.externalId && /^W\d+$/.test(l.externalId)) keys.push(`oa:${l.externalId}`);
  return keys;
}

/** The best key of a link (the first of `linkKeys`): the key shown for a recommendation. */
export const linkKey = (l: Keyed & { externalId?: string | undefined }): string | null => linkKeys(l)[0] ?? null;

/** The best key among a set of keys of one work (`doi:` journal first, then `arxiv:`, `doi:` of an arXiv DOI, `oa:`). */
export function bestKey(keys: Iterable<string>): string {
  const rank = (k: string) => (k.startsWith('arxiv:') ? 1 : k.startsWith('doi:10.48550/') ? 2 : k.startsWith('doi:') ? 0 : 3);
  return [...keys].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1))[0]!;
}

/** First letter of the given name in "First Last" or "Last, First". */
const initialOf = (a: string): string => titleKey(a.includes(',') ? a.slice(a.indexOf(',') + 1) : a)[0] ?? '';

/** An author is the user when it equals a variant, or has the same last name and first initial. */
export function isOwn(authors: readonly string[], variants: readonly string[]): boolean {
  const keys = variants.map((v) => ({ full: titleKey(v), last: lastName(v), initial: initialOf(v) })).filter((v) => v.full);
  return authors.some((a) => keys.some((v) => v.full === titleKey(a) || (v.last !== '' && v.last === lastName(a) && v.initial !== '' && v.initial === initialOf(a))));
}

interface OwnedEntry {
  id: string;
  title: string;
  year: number | null;
  last: string;
}

/** What matching needs of the library's documents (small: no record is kept). */
export interface OwnedIndex {
  /** Document ids per DOI / arXiv id (two documents may share one; the first is listed first). */
  byDoi: Map<string, string[]>;
  byArxiv: Map<string, string[]>;
  byTitle: Map<string, OwnedEntry[]>;
  size: number;
}

const push = (m: Map<string, string[]>, k: string, id: string) => {
  const l = m.get(k);
  if (l) l.push(id);
  else m.set(k, [id]);
};

export function buildOwnedIndex(docs: Iterable<Pick<DocumentRecord, 'id' | 'doi' | 'arxivId' | 'title' | 'year' | 'authors'>>): OwnedIndex {
  const ix: OwnedIndex = { byDoi: new Map(), byArxiv: new Map(), byTitle: new Map(), size: 0 };
  for (const d of docs) {
    ix.size++;
    const doi = d.doi ? normaliseDoi(d.doi) : '';
    if (doi) push(ix.byDoi, doi, d.id);
    const ax = d.arxivId ? arxivBase(d.arxivId) : arxivFromDoi(doi);
    if (ax) push(ix.byArxiv, ax, d.id);
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

/** A title this long is specific enough to match with a year alone (short ones are common: "Deep learning"). */
const LONG_TITLE = 30;

/**
 * Same work by title: equal normalised title, years at most one apart, same first-author last name. At least one of
 * year and author must be known on both sides, and without a known author the title must be long and the year known.
 */
export function sameWork(a: { title: string; year: number | null; last: string }, b: { title: string; year: number | null; last: string }): boolean {
  if (a.title !== b.title || a.title.length < 12) return false;
  const yearKnown = a.year !== null && b.year !== null;
  const authorKnown = a.last !== '' && b.last !== '';
  if (!yearKnown && !authorKnown) return false;
  if (!authorKnown && a.title.length < LONG_TITLE) return false;
  return (!yearKnown || Math.abs(a.year! - b.year!) <= 1) && (!authorKnown || a.last === b.last);
}

/** The id of the library document a work is, or null. Never the document `selfId` itself. */
export function findOwned(ix: OwnedIndex, l: Keyed, selfId?: string): string | null {
  const doi = l.doi ? normaliseDoi(l.doi) : '';
  const ax = l.arxivId ? arxivBase(l.arxivId) : arxivFromDoi(doi);
  for (const ids of [doi ? ix.byDoi.get(doi) : undefined, ax ? ix.byArxiv.get(ax) : undefined]) {
    const id = ids?.find((x) => x !== selfId);
    if (id) return id;
  }
  const t = l.title ? titleKey(l.title) : '';
  const me = { title: t, year: l.year ?? null, last: lastName(l.authors?.[0]) };
  for (const e of ix.byTitle.get(t) ?? []) if (e.id !== selfId && sameWork(me, e)) return e.id;
  return null;
}

/** Links with `matchedDocId` set (or cleared) against the current documents. */
export function matchLinks(links: CitationLink[], ix: OwnedIndex, selfId?: string): CitationLink[] {
  return links.map((l) => ({ ...l, matchedDocId: findOwned(ix, l, selfId) }));
}
