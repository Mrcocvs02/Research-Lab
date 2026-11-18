import { WATCH_FILE_LIMITS } from '@rl/core';
import { AppError } from '@rl/core';
import { isOwn, titleKey } from './match.js';
import { asObj, clean } from './metadata.js';
import type { Net } from './net.js';
import { openAlexLink } from './sources.js';

/** A work a monitoring query found. */
export interface WatchHit {
  externalId: string;
  title?: string;
  authors: string[];
  year?: number;
  doi?: string;
  arxivId?: string;
  venue?: string;
  /** Publication date reported by the source (YYYY-MM-DD). */
  publishedOn?: string;
}

/** What a monitoring query found; `truncated` when there were more works than one check reads (the oldest ones are returned). */
export interface WatchResult {
  hits: WatchHit[];
  truncated: boolean;
}

export interface WatchQuery {
  kind: 'author' | 'topic' | 'venue' | 'own-preprint';
  query: string;
  /** YYYY-MM-DD: works published on or after this day. */
  since: string;
  /** Own preprints: the profile's name variants and OpenAlex author id. */
  authorVariants?: readonly string[];
  openAlexId?: string;
}

const OA = 'https://api.openalex.org';
const FIELDS = 'id,doi,title,publication_year,publication_date,authorships,primary_location';
const q = encodeURIComponent;
const PER_PAGE = 200;
const PAGES = 5;
/** Works read by one check of one source (`PER_PAGE` x `PAGES`). */
export const WATCH_HITS_MAX = PER_PAGE * PAGES;

const OWN_ID = /^A\d+$/i;

/** Monitoring queries on OpenAlex (the only source with a date filter). Throws `AppError` NETWORK_ERROR like the sources. */
export function createWatchFetcher(net: Net): (w: WatchQuery, signal?: AbortSignal) => Promise<WatchResult> {
  /** The OpenAlex id of the first entity of a name search (`authors` or `sources`). */
  const firstId = async (kind: 'authors' | 'sources', name: string, signal?: AbortSignal): Promise<string | null> => {
    const res = asObj(await net.json(`${OA}/${kind}?search=${q(name.slice(0, 200))}&per-page=1&select=id`, signal));
    const id = /[AS]\d+$/.exec(String(asObj((Array.isArray(res['results']) ? res['results'] : [])[0])['id'] ?? ''))?.[0];
    return id ?? null;
  };

  /**
   * The OpenAlex authors a profile's name variants stand for: only search hits whose name matches the variant (a
   * common name must not resolve to a stranger). Exact full-name matches win over "same last name and initial".
   */
  const ownAuthorIds = async (variants: readonly string[], signal?: AbortSignal): Promise<string[]> => {
    const ids = new Set<string>();
    for (const v of variants.slice(0, 3)) {
      if (!titleKey(v)) continue;
      const res = asObj(await net.json(`${OA}/authors?search=${q(v.slice(0, 200))}&per-page=5&select=id,display_name`, signal));
      const hits = (Array.isArray(res['results']) ? res['results'] : []).map((r) => ({ id: /A\d+$/.exec(String(asObj(r)['id'] ?? ''))?.[0], name: clean(asObj(r)['display_name'], 300) })).filter((h): h is { id: string; name: string } => !!h.id && !!h.name && isOwn([h.name], [v]));
      const exact = hits.filter((h) => titleKey(h.name) === titleKey(v));
      for (const h of (exact.length > 0 ? exact : hits).slice(0, 3)) ids.add(h.id);
    }
    return [...ids];
  };

  return async (w, signal) => {
    const filters = [`from_publication_date:${w.since}`];
    let search = '';
    let own: readonly string[] | null = null;
    const query = w.query.trim();
    if (w.kind === 'topic') {
      if (!query) return { hits: [], truncated: false };
      search = `&search=${q(query.slice(0, 300))}`;
    } else if (w.kind === 'author') {
      const id = /^A\d+$/i.test(query) ? query.toUpperCase() : query ? await firstId('authors', query, signal) : null;
      if (!id) return { hits: [], truncated: false };
      filters.push(`author.id:${id}`);
    } else if (w.kind === 'venue') {
      const id = /^S\d+$/i.test(query) ? query.toUpperCase() : query ? await firstId('sources', query, signal) : null;
      if (!id) return { hits: [], truncated: false };
      filters.push(`primary_location.source.id:${id}`);
    } else {
      const profileId = w.openAlexId && OWN_ID.test(w.openAlexId.trim()) ? w.openAlexId.trim().toUpperCase() : null;
      const ids = profileId ? [profileId] : await ownAuthorIds(w.authorVariants ?? [], signal);
      if (ids.length === 0) throw new AppError('INVALID_REQUEST', 'No OpenAlex author matches the profile: add the OpenAlex author id to the profile', { reason: 'own-author-unknown' });
      if (!profileId) own = w.authorVariants ?? [];
      filters.push(`author.id:${ids.join('|')}`, 'type:preprint');
    }
    const out: WatchHit[] = [];
    let more = false;
    // Plain pages (`page=N`): `cursor=*` needs an API key, page numbers do not (up to 10,000 works).
    // Oldest first: when there are more works than `WATCH_HITS_MAX`, the ones returned are the oldest and the caller continues from their date.
    for (let page = 1; page <= PAGES; page++) {
      let res: Record<string, unknown>;
      try {
        res = asObj(await net.json(`${OA}/works?filter=${q(filters.join(','))}${search}&sort=publication_date:asc&per-page=${PER_PAGE}&page=${page}&select=${FIELDS}`, signal, 4 * 1024 * 1024));
      } catch (e) {
        if (e instanceof AppError && (e.details as { status?: number } | undefined)?.status === 401) throw new AppError('NETWORK_ERROR', 'OpenAlex needs an API key for this check: add one in Settings', { reason: 'openalex-key-required', status: 401 });
        throw e;
      }
      const results = Array.isArray(res['results']) ? res['results'] : [];
      for (const r of results) {
        const l = openAlexLink(asObj(r), '1970-01-01T00:00:00.000Z');
        if (!l.externalId) continue;
        // Without the profile's author id the author search is only a guess: keep the works that really carry one of the names.
        if (own && !isOwn(l.authors, own)) continue;
        const date = asObj(r)['publication_date'];
        out.push({
          externalId: l.externalId,
          authors: l.authors,
          ...(l.title ? { title: clean(l.title, 500) ?? l.title } : {}),
          ...(l.year ? { year: l.year } : {}),
          ...(l.doi ? { doi: l.doi } : {}),
          ...(l.arxivId ? { arxivId: l.arxivId } : {}),
          ...(l.venue ? { venue: l.venue } : {}),
          ...(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { publishedOn: date } : {}),
        });
      }
      const meta = asObj(res['meta']);
      more = results.length > 0 && (typeof meta['count'] === 'number' ? meta['count'] > page * PER_PAGE : typeof meta['next_cursor'] === 'string' && meta['next_cursor'] !== '');
      if (!more) break;
    }
    return { hits: out.slice(0, WATCH_FILE_LIMITS.seen), truncated: more };
  };
}
