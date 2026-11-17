import { WATCH_FILE_LIMITS } from '@rl/core';
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
const FIELDS = 'id,doi,title,publication_year,authorships,primary_location';
const q = encodeURIComponent;
const PAGES = 4;

/** Monitoring queries on OpenAlex (the only source with a date filter). Throws `AppError` NETWORK_ERROR like the sources. */
export function createWatchFetcher(net: Net): (w: WatchQuery, signal?: AbortSignal) => Promise<WatchHit[]> {
  /** The OpenAlex id of the first entity of a name search (`authors` or `sources`). */
  const firstId = async (kind: 'authors' | 'sources', name: string, signal?: AbortSignal): Promise<string | null> => {
    const res = asObj(await net.json(`${OA}/${kind}?search=${q(name.slice(0, 200))}&per-page=1&select=id`, signal));
    const id = /[AS]\d+$/.exec(String(asObj((Array.isArray(res['results']) ? res['results'] : [])[0])['id'] ?? ''))?.[0];
    return id ?? null;
  };

  return async (w, signal) => {
    const filters = [`from_publication_date:${w.since}`];
    let search = '';
    const query = w.query.trim();
    if (w.kind === 'topic') {
      if (!query) return [];
      search = `&search=${q(query.slice(0, 300))}`;
    } else if (w.kind === 'author') {
      const id = /^A\d+$/i.test(query) ? query.toUpperCase() : query ? await firstId('authors', query, signal) : null;
      if (!id) return [];
      filters.push(`author.id:${id}`);
    } else if (w.kind === 'venue') {
      const id = /^S\d+$/i.test(query) ? query.toUpperCase() : query ? await firstId('sources', query, signal) : null;
      if (!id) return [];
      filters.push(`primary_location.source.id:${id}`);
    } else {
      const ids = new Set<string>();
      if (w.openAlexId) ids.add(w.openAlexId);
      else for (const v of (w.authorVariants ?? []).slice(0, 3)) {
        const id = await firstId('authors', v, signal);
        if (id) ids.add(id);
      }
      if (ids.size === 0) return [];
      filters.push(`author.id:${[...ids].join('|')}`, 'type:preprint');
    }
    const out: WatchHit[] = [];
    let cursor: string | null = '*';
    for (let page = 0; cursor && page < PAGES; page++) {
      const res = asObj(await net.json(`${OA}/works?filter=${q(filters.join(','))}${search}&sort=publication_date:desc&per-page=50&cursor=${q(cursor)}&select=${FIELDS}`, signal, 4 * 1024 * 1024));
      const results = Array.isArray(res['results']) ? res['results'] : [];
      for (const r of results) {
        const l = openAlexLink(asObj(r), '1970-01-01T00:00:00.000Z');
        if (!l.externalId) continue;
        out.push({
          externalId: l.externalId,
          authors: l.authors,
          ...(l.title ? { title: clean(l.title, 500) ?? l.title } : {}),
          ...(l.year ? { year: l.year } : {}),
          ...(l.doi ? { doi: l.doi } : {}),
          ...(l.arxivId ? { arxivId: l.arxivId } : {}),
          ...(l.venue ? { venue: l.venue } : {}),
        });
      }
      const next = asObj(res['meta'])['next_cursor'];
      cursor = results.length > 0 && typeof next === 'string' && next ? next : null;
    }
    return out.slice(0, WATCH_FILE_LIMITS.seen);
  };
}
