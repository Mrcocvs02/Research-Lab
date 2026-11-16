import { useCallback, useEffect, useRef, useState } from 'react';
import type { Channels, ResponseOf, SearchFilters } from '@rl/core';
import { rl } from '../../lib/rl';

export type SearchResults = ResponseOf<Channels, 'search:query'>;
export type SearchFacetsData = ResponseOf<Channels, 'search:facets'>;

export interface SearchState {
  text: string;
  filters: SearchFilters;
  sort: 'relevance' | 'title' | 'year-desc' | 'year-asc' | 'added-desc' | 'author';
}

export interface SearchResultState {
  /** The hits loaded so far (every page requested up to now) and the total of the query. */
  results: SearchResults | null;
  facets: SearchFacetsData | null;
  loading: boolean;
  error: unknown;
  /** The text the current `results` answer (lets the view and tests tell stale results from fresh ones). */
  forText?: string;
  /** True while more results can be requested. */
  hasMore: boolean;
  /** Requests the next page (fixed size, by offset); the hits are appended. */
  loadMore: () => void;
}

export const SEARCH_PAGE_SIZE = 25;
const DEBOUNCE_MS = 180;

type Loaded = Omit<SearchResultState, 'hasMore' | 'loadMore'>;

/**
 * Runs the search as the text or filters change (debounced; an answer that arrives after a newer request
 * is dropped). Results come in pages of a fixed size: `loadMore` asks for the next one by offset and appends it,
 * so every result is reachable however many there are. `refreshKey` changes when the index changed under us
 * (scan finished) and starts again from the first page.
 */
export function useSearch(state: SearchState, enabled: boolean, refreshKey: string): SearchResultState {
  const [out, setOut] = useState<Loaded>({ results: null, facets: null, loading: false, error: null });
  const [exhausted, setExhausted] = useState(false);
  const ticket = useRef(0);
  const current = useRef({ state, out });
  current.current = { state, out };
  const filtersKey = JSON.stringify(state.filters);

  useEffect(() => {
    if (!enabled) return;
    const mine = ++ticket.current;
    setOut((o) => ({ ...o, loading: true }));
    setExhausted(false);
    const timer = setTimeout(() => {
      const sort = state.sort === 'relevance' && state.text.trim() === '' ? 'title' : state.sort;
      rl.invoke('search:run', { text: state.text, filters: state.filters, sort, limit: SEARCH_PAGE_SIZE, offset: 0 }).then(
        ({ facets, ...results }) => {
          if (mine === ticket.current) setOut({ results, facets, loading: false, error: null, forText: state.text });
        },
        (error: unknown) => {
          if (mine === ticket.current) setOut((o) => ({ ...o, loading: false, error }));
        },
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.text, filtersKey, state.sort, enabled, refreshKey]);

  const loadMore = useCallback(() => {
    const { state: s, out: o } = current.current;
    if (!o.results || o.loading) return;
    const offset = o.results.hits.length;
    const mine = ++ticket.current;
    setOut((x) => ({ ...x, loading: true }));
    const sort = s.sort === 'relevance' && s.text.trim() === '' ? 'title' : s.sort;
    rl.invoke('search:query', { text: s.text, filters: s.filters, sort, limit: SEARCH_PAGE_SIZE, offset }).then(
      (page) => {
        if (mine !== ticket.current) return;
        // A page without new hits ends the list (the total may have shrunk under us).
        if (page.hits.length === 0) setExhausted(true);
        setOut((x) => {
          if (!x.results) return { ...x, loading: false };
          const seen = new Set(x.results.hits.map((h) => h.docId));
          const hits = [...x.results.hits, ...page.hits.filter((h) => !seen.has(h.docId))];
          return { ...x, loading: false, results: { total: page.total, hits, tookMs: page.tookMs } };
        });
      },
      (error: unknown) => {
        if (mine === ticket.current) setOut((x) => ({ ...x, loading: false, error }));
      },
    );
  }, []);

  const hasMore = !exhausted && out.results !== null && out.results.hits.length > 0 && out.results.hits.length < out.results.total;
  return { ...out, hasMore, loadMore };
}
