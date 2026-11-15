import { useEffect, useRef, useState } from 'react';
import type { Channels, ResponseOf, SearchFilters } from '@rl/core';
import { rl } from '../../lib/rl';

export type SearchResults = ResponseOf<Channels, 'search:query'>;
export type SearchFacetsData = ResponseOf<Channels, 'search:facets'>;

export interface SearchState {
  text: string;
  filters: SearchFilters;
  sort: 'relevance' | 'title' | 'year-desc' | 'year-asc' | 'added-desc' | 'author';
  limit: number;
}

export interface SearchResultState {
  results: SearchResults | null;
  facets: SearchFacetsData | null;
  loading: boolean;
  error: unknown;
}

const DEBOUNCE_MS = 180;

/**
 * Runs the search as the text or filters change (debounced; an answer that arrives after a newer request
 * is dropped). `refreshKey` changes when the index changed under us (scan finished).
 */
export function useSearch(state: SearchState, enabled: boolean, refreshKey: string): SearchResultState {
  const [out, setOut] = useState<SearchResultState>({ results: null, facets: null, loading: false, error: null });
  const ticket = useRef(0);
  const filtersKey = JSON.stringify(state.filters);

  useEffect(() => {
    if (!enabled) return;
    const mine = ++ticket.current;
    setOut((o) => ({ ...o, loading: true }));
    const timer = setTimeout(() => {
      const sort = state.sort === 'relevance' && state.text.trim() === '' ? 'title' : state.sort;
      Promise.all([
        rl.invoke('search:query', { text: state.text, filters: state.filters, sort, limit: state.limit }),
        rl.invoke('search:facets', { text: state.text, filters: state.filters }),
      ]).then(
        ([results, facets]) => {
          if (mine === ticket.current) setOut({ results, facets, loading: false, error: null });
        },
        (error: unknown) => {
          if (mine === ticket.current) setOut((o) => ({ ...o, loading: false, error }));
        },
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.text, filtersKey, state.sort, state.limit, enabled, refreshKey]);

  return out;
}
