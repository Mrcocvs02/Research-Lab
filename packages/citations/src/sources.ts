import { CITATION_FILE_LIMITS, type CitationLink, type CitationSource, type WorkMetadata as CoreMetadata, type WorkRef as CoreRef } from '@rl/core';
import { asObj, clean, clip, encodePath, normaliseDoi, parseArxivAtom } from './metadata.js';
import { arxivBase, arxivFromDoi, lastName, sameWork, titleKey } from './match.js';
import type { Net } from './net.js';

/** A reference as the sources take it: the core one plus the id the source gave the work on an earlier refresh. */
export type SourceRef = CoreRef & { externalId?: string };

/** What `lookup` returns beyond the core shape. */
export type LookupResult = CoreMetadata & { externalId?: string; citedByCount?: number };

/** The published version of a preprint, as a source reports it. */
export interface PublishedInfo {
  doi: string;
  venue: string | null;
  venueRef: string | null;
  year: number | null;
  source: 'openalex' | 'arxiv' | 'semanticscholar';
}

export interface CitationSourceX extends CitationSource {
  findPublished?(ref: SourceRef, signal?: AbortSignal): Promise<PublishedInfo | null>;
}

type Obj = Record<string, unknown>;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const compact = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
const L = CITATION_FILE_LIMITS;
const LIST_BYTES = 4 * 1024 * 1024;
const q = encodeURIComponent;
const yearOf = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= 1000 && v <= 3000 ? v : undefined);
const doiOf = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? clip(normaliseDoi(v), 300) : undefined);
const names = (list: unknown[]): string[] => list.map((a) => clean(a, L.author)).filter((a): a is string => a !== null).slice(0, L.authors);
const refArxiv = (r: SourceRef): string | null => (r.arxivId ? arxivBase(r.arxivId) : arxivFromDoi(r.doi));
const validArxiv = (a: string | null): a is string => a !== null && /^[a-z0-9.\-/]{4,60}$/.test(a);

/** Accept a search hit only when title, year and first author agree with what is known. */
function confident(ref: SourceRef, c: { title?: string | undefined; year?: number | undefined; authors: string[] }): boolean {
  if (!ref.title || !c.title) return false;
  return sameWork({ title: titleKey(ref.title), year: ref.year ?? null, last: lastName(ref.authors?.[0]) }, { title: titleKey(c.title), year: c.year ?? null, last: lastName(c.authors[0]) });
}

/* --------------------------------------------- OpenAlex --------------------------------------------- */

const OA = 'https://api.openalex.org';
const LINK_FIELDS = 'id,doi,title,publication_year,authorships,primary_location';
const FULL_FIELDS = `${LINK_FIELDS},type,locations,biblio,cited_by_count,referenced_works,is_retracted`;
const oaId = (u: unknown): string | undefined => (typeof u === 'string' ? /W\d+$/.exec(u)?.[0] : undefined);
const oaAuthors = (w: Obj): string[] => names(arr(w['authorships']).map((a) => asObj(asObj(a)['author'])['display_name']));
const oaVenue = (w: Obj): string | undefined => clean(asObj(asObj(w['primary_location'])['source'])['display_name'], 500) ?? undefined;

export function openAlexLink(w: Obj, at: string): CitationLink {
  const doi = doiOf(w['doi']);
  return compact({
    externalId: oaId(w['id']),
    doi,
    arxivId: arxivFromDoi(doi) ?? undefined,
    title: clean(w['title'] ?? w['display_name'], L.text) ?? undefined,
    authors: oaAuthors(w),
    year: yearOf(w['publication_year']),
    venue: oaVenue(w),
    matchedDocId: null,
    source: 'openalex' as const,
    checkedAt: at,
  });
}

const biblioRef = (b: Obj): string | undefined => {
  const vol = clean(b['volume'], 40);
  const issue = clean(b['issue'], 40);
  const first = clean(b['first_page'], 40);
  const last = clean(b['last_page'], 40);
  const pages = first ? (last && last !== first ? `${first}-${last}` : first) : null;
  const head = vol ? (issue ? `${vol}(${issue})` : vol) : '';
  return clean([head, pages].filter(Boolean).join(':'), 500) ?? undefined;
};

export function createOpenAlex(net: Net, now: () => Date): CitationSourceX {
  const memo = new Map<string, Obj>();
  const remember = (key: string, w: Obj): Obj => {
    if (memo.size >= 8) memo.delete(memo.keys().next().value as string);
    memo.set(key, w);
    return w;
  };
  const one = async (path: string, signal?: AbortSignal): Promise<Obj | null> => {
    const w = asObj(await net.json(`${OA}/works/${path}${path.includes('?') ? '&' : '?'}select=${FULL_FIELDS}`, signal));
    return oaId(w['id']) ? w : null;
  };
  const byDoi = (doi: string, signal?: AbortSignal) => one(`doi:${encodePath(doi)}`, signal);

  async function resolve(ref: SourceRef, signal?: AbortSignal): Promise<Obj | null> {
    const ax = refArxiv(ref);
    const key = `${ref.externalId ?? ""}|${ref.doi ?? ""}|${ax ?? ""}|${ref.title ?? ""}|${ref.year ?? ""}|${ref.authors?.[0] ?? ""}`;
    const hit = memo.get(key);
    if (hit) return hit;
    let w: Obj | null = null;
    if (ref.externalId && /^W\d+$/.test(ref.externalId)) w = await one(ref.externalId, signal);
    if (!w && ref.doi) w = await byDoi(normaliseDoi(ref.doi), signal);
    if (!w && validArxiv(ax) && !ref.doi?.toLowerCase().includes('10.48550/')) w = await byDoi(`10.48550/arXiv.${ax}`, signal);
    if (!w && ref.title && titleKey(ref.title).length >= 12) {
      const y = ref.year;
      const filter = y ? `&filter=${q(`publication_year:${y - 1}|${y}|${y + 1}`)}` : '';
      const res = asObj(await net.json(`${OA}/works?search=${q(ref.title.slice(0, 300))}&per-page=5${filter}&select=${FULL_FIELDS}`, signal, LIST_BYTES));
      w = arr(res['results']).map(asObj).find((c) => oaId(c['id']) && confident(ref, { title: clean(c['title'], L.text) ?? undefined, year: yearOf(c['publication_year']), authors: oaAuthors(c) })) ?? null;
    }
    return w ? remember(key, w) : null;
  }

  const locationDoi = (l: Obj): string | undefined => doiOf(l['doi']) ?? doiOf(/doi\.org\/(10\.[^\s?#]+)/i.exec(typeof l['landing_page_url'] === 'string' ? l['landing_page_url'] : '')?.[1]);

  return {
    id: 'openalex',
    async lookup(ref, signal) {
      const w = await resolve(ref, signal);
      if (!w) return null;
      const doi = doiOf(w['doi']);
      const fromLocation = arr(w['locations'])
        .map((l) => /arxiv\.org\/abs\/([^\s?#]+)/i.exec(String(asObj(l)['landing_page_url'] ?? ''))?.[1])
        .find(Boolean);
      return compact({
        title: clean(w['title'] ?? w['display_name'], L.text) ?? undefined,
        authors: oaAuthors(w),
        year: yearOf(w['publication_year']),
        doi,
        arxivId: arxivFromDoi(doi) ?? (fromLocation ? arxivBase(fromLocation) : undefined),
        venue: oaVenue(w),
        venueRef: biblioRef(asObj(w['biblio'])),
        publicationStatus: w['type'] === 'preprint' ? ('preprint' as const) : ('published' as const),
        source: 'openalex' as const,
        externalId: oaId(w['id']),
        citedByCount: typeof w['cited_by_count'] === 'number' && w['cited_by_count'] >= 0 ? Math.floor(w['cited_by_count']) : undefined,
      });
    },

    async fetchReferences(ref, signal) {
      const w = await resolve(ref, signal);
      const ids = arr(w?.['referenced_works']).map(oaId).filter((x): x is string => !!x).slice(0, L.references);
      const at = now().toISOString();
      const byId = new Map<string, CitationLink>();
      for (let i = 0; i < ids.length; i += 50) {
        const part = ids.slice(i, i + 50);
        const res = asObj(await net.json(`${OA}/works?filter=${q(`openalex_id:${part.join('|')}`)}&per-page=50&select=${LINK_FIELDS}`, signal, LIST_BYTES));
        for (const r of arr(res['results'])) {
          const l = openAlexLink(asObj(r), at);
          if (l.externalId) byId.set(l.externalId, l);
        }
      }
      // A work the source could not give is kept as a bare id, so the count stays true.
      return ids.map((id) => byId.get(id) ?? { externalId: id, authors: [], matchedDocId: null, source: 'openalex' as const, checkedAt: at });
    },

    async fetchCitedBy(ref: SourceRef, signal?: AbortSignal) {
      const id = ref.externalId && /^W\d+$/.test(ref.externalId) ? ref.externalId : oaId((await resolve(ref, signal))?.['id']);
      if (!id) return [];
      const at = now().toISOString();
      const out: CitationLink[] = [];
      let cursor: string | null = '*';
      while (cursor && out.length < L.citedBy) {
        const res = asObj(await net.json(`${OA}/works?filter=${q(`cites:${id}`)}&sort=publication_date:desc&per-page=50&cursor=${q(cursor)}&select=${LINK_FIELDS}`, signal, LIST_BYTES));
        const results = arr(res['results']);
        for (const r of results) out.push(openAlexLink(asObj(r), at));
        const next = asObj(res['meta'])['next_cursor'];
        cursor = results.length > 0 && typeof next === 'string' && next ? next : null;
      }
      return out.slice(0, L.citedBy);
    },

    async findPublished(ref, signal) {
      const w = await resolve(ref, signal);
      if (!w) return null;
      const own = doiOf(w['doi']);
      let doi: string | undefined;
      let loc: Obj | undefined;
      if (own && !arxivFromDoi(own) && w['type'] !== 'preprint') doi = own;
      else {
        loc = arr(w['locations']).map(asObj).find((l) => (l['version'] === 'publishedVersion' || asObj(l['source'])['type'] === 'journal') && locationDoi(l) && !arxivFromDoi(locationDoi(l)));
        doi = loc ? locationDoi(loc) : undefined;
      }
      if (!doi || doi === (ref.doi ? normaliseDoi(ref.doi) : '')) return null;
      const pub = doi === own ? w : await byDoi(doi, signal).catch(() => null);
      return {
        doi,
        venue: pub ? (oaVenue(pub) ?? null) : (clean(asObj(asObj(loc)['source'])['display_name'], 500) ?? null),
        venueRef: pub ? (biblioRef(asObj(pub['biblio'])) ?? null) : null,
        year: pub ? (yearOf(pub['publication_year']) ?? null) : null,
        source: 'openalex',
      };
    },
  };
}

/* ----------------------------------------- Semantic Scholar ----------------------------------------- */

const S2 = 'https://api.semanticscholar.org/graph/v1';
const S2_LINK = 'title,year,authors,externalIds,venue';
const S2_FULL = `${S2_LINK},citationCount,journal`;

function s2Link(p: Obj, at: string): CitationLink {
  const ids = asObj(p['externalIds']);
  const doi = doiOf(ids['DOI']);
  return compact({
    externalId: typeof p['paperId'] === 'string' ? clip(p['paperId'], 100) : undefined,
    doi,
    arxivId: typeof ids['ArXiv'] === 'string' ? clip(arxivBase(ids['ArXiv']), 300) : undefined,
    title: clean(p['title'], L.text) ?? undefined,
    authors: names(arr(p['authors']).map((a) => asObj(a)['name'])),
    year: yearOf(p['year']),
    venue: clean(p['venue'] || asObj(p['journal'])['name'], 500) ?? undefined,
    matchedDocId: null,
    source: 'semanticscholar' as const,
    checkedAt: at,
  });
}

export function createSemanticScholar(net: Net, now: () => Date): CitationSourceX {
  const paper = async (id: string, fields: string, signal?: AbortSignal): Promise<Obj | null> => {
    const p = asObj(await net.json(`${S2}/paper/${id}?fields=${fields}`, signal));
    return typeof p['paperId'] === 'string' ? p : null;
  };
  async function resolve(ref: SourceRef, signal?: AbortSignal): Promise<Obj | null> {
    const ax = refArxiv(ref);
    let p: Obj | null = null;
    if (ref.externalId && /^[0-9a-f]{40}$/.test(ref.externalId)) p = await paper(ref.externalId, S2_FULL, signal);
    if (!p && ref.doi) p = await paper(`DOI:${encodePath(normaliseDoi(ref.doi))}`, S2_FULL, signal);
    if (!p && validArxiv(ax)) p = await paper(`ARXIV:${encodePath(ax)}`, S2_FULL, signal);
    if (!p && ref.title && titleKey(ref.title).length >= 12) {
      const res = asObj(await net.json(`${S2}/paper/search/match?query=${q(ref.title.slice(0, 300))}&fields=paperId,${S2_FULL}`, signal));
      p = arr(res['data']).map(asObj).find((c) => typeof c['paperId'] === 'string' && confident(ref, { title: clean(c['title'], L.text) ?? undefined, year: yearOf(c['year']), authors: names(arr(c['authors']).map((a) => asObj(a)['name'])) })) ?? null;
    }
    return p;
  }
  const list = async (ref: SourceRef, edge: 'references' | 'citations', key: 'citedPaper' | 'citingPaper', cap: number, signal?: AbortSignal): Promise<CitationLink[]> => {
    const id = ref.externalId && /^[0-9a-f]{40}$/.test(ref.externalId) ? ref.externalId : (await resolve(ref, signal))?.['paperId'];
    if (typeof id !== 'string') return [];
    const at = now().toISOString();
    const out: CitationLink[] = [];
    for (let offset: number | null = 0; offset !== null && out.length < cap; ) {
      const res = asObj(await net.json(`${S2}/paper/${id}/${edge}?fields=${S2_LINK}&limit=500&offset=${offset}`, signal, LIST_BYTES));
      const data = arr(res['data']);
      for (const d of data) {
        const l = s2Link(asObj(asObj(d)[key]), at);
        if (l.title || l.doi || l.arxivId) out.push(l);
      }
      const nx = res['next'];
      offset = data.length > 0 && typeof nx === 'number' && nx > offset ? nx : null;
    }
    return out.slice(0, cap);
  };

  return {
    id: 'semanticscholar',
    async lookup(ref, signal) {
      const p = await resolve(ref, signal);
      if (!p) return null;
      const l = s2Link(p, now().toISOString());
      const j = asObj(p['journal']);
      const ref2 = [clean(j['volume'], 40), clean(j['pages'], 40)].filter(Boolean).join(':');
      return compact({
        title: l.title,
        authors: l.authors,
        year: l.year,
        doi: l.doi,
        arxivId: l.arxivId,
        venue: l.venue,
        venueRef: ref2 || undefined,
        publicationStatus: l.doi && !arxivFromDoi(l.doi) ? ('published' as const) : ('preprint' as const),
        source: 'semanticscholar' as const,
        externalId: l.externalId,
        citedByCount: typeof p['citationCount'] === 'number' && p['citationCount'] >= 0 ? Math.floor(p['citationCount']) : undefined,
      });
    },
    fetchReferences: (ref, signal) => list(ref, 'references', 'citedPaper', L.references, signal),
    fetchCitedBy: (ref, signal) => list(ref, 'citations', 'citingPaper', L.citedBy, signal),
    async findPublished(ref, signal) {
      const m = await this.lookup(ref, signal);
      if (!m?.doi || arxivFromDoi(m.doi) || m.doi === (ref.doi ? normaliseDoi(ref.doi) : '')) return null;
      return { doi: m.doi, venue: m.venue ?? null, venueRef: m.venueRef ?? null, year: m.year ?? null, source: 'semanticscholar' };
    },
  };
}

/* ------------------------------------------------- arXiv ------------------------------------------------- */

/** Metadata only (the Atom feed of arXiv has no citation graph). */
export function createArxiv(net: Net): CitationSourceX {
  const lookupRaw = async (ref: SourceRef, signal?: AbortSignal) => {
    const ax = refArxiv(ref);
    if (!validArxiv(ax)) return null;
    const text = await net.text(`https://export.arxiv.org/api/query?id_list=${q(ax)}`, 'application/atom+xml', signal);
    return text === null ? null : parseArxivAtom(text);
  };
  return {
    id: 'arxiv',
    async lookup(ref, signal) {
      const m = await lookupRaw(ref, signal);
      if (!m) return null;
      return compact({
        title: m.title ?? undefined,
        authors: m.authors,
        year: m.year ?? undefined,
        doi: m.doi ?? undefined,
        arxivId: m.arxivId ?? undefined,
        venueRef: m.venue ?? undefined,
        publicationStatus: m.publication === 'published' ? ('published' as const) : ('preprint' as const),
        source: 'arxiv' as const,
      });
    },
    fetchReferences: async () => [],
    fetchCitedBy: async () => [],
    async findPublished(ref, signal) {
      const m = await lookupRaw(ref, signal);
      if (!m?.doi || arxivFromDoi(m.doi)) return null;
      return { doi: m.doi, venue: null, venueRef: m.venue, year: null, source: 'arxiv' };
    },
  };
}
