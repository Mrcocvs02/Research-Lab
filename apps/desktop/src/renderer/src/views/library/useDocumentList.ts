import { useCallback, useEffect, useRef, useState } from 'react';
import type { Channels, ResponseOf, StudyState } from '@rl/core';
import { rl } from '../../lib/rl';
import type { QueryPlan } from './docQuery';

export type SearchFacetsData = ResponseOf<Channels, 'search:facets'>;
type SummaryItem = ResponseOf<Channels, 'documents:list'>['items'][number];
type Hit = ResponseOf<Channels, 'search:query'>['hits'][number];

/** One line of the list: a document summary or a search hit. */
export interface DocRow {
  docId: string;
  title: string | null;
  authors: string[];
  year: number | null;
  type: string | null;
  path: string;
  studyState: StudyState;
  /** Every tag, the implied ones included. */
  tags: string[];
  /** Only the tags put on the document by hand (the ones that can be removed); falls back to `tags` until the main process sends it. */
  directTags: string[];
  addedAt: string;
  missing: boolean;
  /** File size in bytes. */
  size: number;
  snippet?: string;
  field?: Hit['field'];
  pages?: Hit['pages'];
}

export const PAGE_SIZE = 100;
/** Rows per call when only ids are wanted (the largest page the server allows). */
const IDS_PAGE = 200;
/** A refresh re-reads at most this many already loaded pages besides the first. */
const REFRESH_PAGES = 30;
const DEBOUNCE_MS = 150;

const fromSummary = (s: SummaryItem): DocRow => ({
  docId: s.docId,
  title: s.title,
  authors: s.authors,
  year: s.year,
  type: s.type,
  path: s.path,
  studyState: s.studyState,
  tags: s.tags,
  directTags: s.directTags ?? s.tags,
  addedAt: s.addedAt,
  missing: s.missing,
  size: s.size,
});

const fromHit = (h: Hit): DocRow => {
  const row: DocRow = { docId: h.docId, title: h.title, authors: h.authors, year: h.year, type: h.type, path: h.path, studyState: h.studyState, tags: h.tags, directTags: h.directTags ?? h.tags, addedAt: '', missing: false, size: h.size, snippet: h.snippet, field: h.field };
  if (h.pages) row.pages = h.pages;
  return row;
};

export interface DocList {
  total: number;
  loading: boolean;
  error: unknown;
  facets: SearchFacetsData | null;
  /** The text the rows answer. */
  forText: string | undefined;
  /** Changes whenever rows were added or replaced. */
  version: number;
  rowAt(index: number): DocRow | undefined;
  /** Asks for the pages that cover rows `start`..`end` (inclusive). */
  ensure(start: number, end: number): void;
  /** Loads every row (range selection across unloaded pages, tag counts of a big selection). */
  loadAll(): Promise<DocRow[]>;
  /** The ids of the whole current result, in list order. Pages are asked from the server and only their ids are kept. */
  allIds(): Promise<string[]>;
  /** The ids in list order; `undefined` for rows not loaded yet. */
  ids(): Array<string | undefined>;
}

interface Store {
  key: string;
  total: number;
  pages: Map<number, DocRow[]>;
  asked: Set<number>;
}

/**
 * The documents of the current query as a sparse, paged list: only the pages near the scroll position are
 * requested (every filter is the server's, D-122), so 5000 documents cost a handful of one-page calls. Rows keep
 * showing while a refresh of the same query is in flight.
 */
export function useDocumentList(plan: QueryPlan, enabled: boolean, refreshKey: string): DocList {
  const store = useRef<Store>({ key: '', total: 0, pages: new Map(), asked: new Set() });
  const ticket = useRef(0);
  const [tick, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);
  const [state, setState] = useState<{ loading: boolean; error: unknown; facets: SearchFacetsData | null; forText: string | undefined }>({ loading: false, error: null, facets: null, forText: undefined });
  const planRef = useRef(plan);
  planRef.current = plan;

  const fetchPage = useCallback(async (p: QueryPlan, offset: number, limit: number, first: boolean) => {
    const hasText = p.text.trim() !== '';
    const sort = p.sort as Exclude<QueryPlan['sort'], 'relevance'>;
    if (hasText) {
      if (first) {
        const { facets, ...r } = await rl.invoke('search:run', { text: p.text, filters: p.filters, sort: p.sort, limit, offset });
        return { rows: r.hits.map(fromHit), total: r.total, facets };
      }
      const r = await rl.invoke('search:query', { text: p.text, filters: p.filters, sort: p.sort, limit, offset });
      return { rows: r.hits.map(fromHit), total: r.total, facets: undefined };
    }
    if (first) {
      const [r, facets] = await Promise.all([
        rl.invoke('documents:list', { filters: p.filters, sort, limit, offset }),
        rl.invoke('search:facets', { text: '', filters: p.filters }),
      ]);
      return { rows: r.items.map(fromSummary), total: r.total, facets };
    }
    const r = await rl.invoke('documents:list', { filters: p.filters, sort, limit, offset });
    return { rows: r.items.map(fromSummary), total: r.total, facets: undefined };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const mine = ++ticket.current;
    const p = planRef.current;
    const sameQuery = store.current.key === p.key;
    if (!sameQuery) {
      store.current = { key: p.key, total: 0, pages: new Map(), asked: new Set() };
      bump();
    }
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(
      () => {
        void (async () => {
          try {
            const r = await fetchPage(p, 0, PAGE_SIZE, true);
            if (mine !== ticket.current) return;
            const pages = new Map<number, DocRow[]>([[0, r.rows]]);
            // Same query: keep the pages that were showing, so rows (and the selection's active row) do not vanish.
            const again = sameQuery ? [...store.current.pages.keys()].filter((n) => n > 0 && n * PAGE_SIZE < r.total).sort((a, b) => a - b).slice(0, REFRESH_PAGES) : [];
            for (let i = 0; i < again.length; i += 4) {
              await Promise.all(
                again.slice(i, i + 4).map(async (n) => {
                  pages.set(n, (await fetchPage(p, n * PAGE_SIZE, PAGE_SIZE, false)).rows);
                }),
              );
              if (mine !== ticket.current) return;
            }
            store.current = { key: p.key, total: r.total, pages, asked: new Set(pages.keys()) };
            setState({ loading: false, error: null, facets: r.facets ?? null, forText: p.text });
            bump();
          } catch (error) {
            if (mine === ticket.current) setState((s) => ({ ...s, loading: false, error }));
          }
        })();
      },
      p.text.trim() === '' ? 0 : DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [plan.key, enabled, refreshKey, fetchPage]);

  const ensure = useCallback(
    (start: number, end: number) => {
      const s = store.current;
      if (s.key !== planRef.current.key) return;
      const last = Math.min(end, s.total - 1);
      for (let p = Math.floor(Math.max(0, start) / PAGE_SIZE); p <= Math.floor(last / PAGE_SIZE); p++) {
        if (s.pages.has(p) || s.asked.has(p)) continue;
        s.asked.add(p);
        const mine = ticket.current;
        fetchPage(planRef.current, p * PAGE_SIZE, PAGE_SIZE, false).then(
          (r) => {
            if (mine !== ticket.current || store.current !== s) return;
            s.pages.set(p, r.rows);
            bump();
          },
          (error: unknown) => {
            s.asked.delete(p);
            if (mine === ticket.current) setState((x) => ({ ...x, error }));
          },
        );
      }
    },
    [fetchPage],
  );

  const rowAt = useCallback((index: number): DocRow | undefined => {
    const s = store.current;
    return s.pages.get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE];
  }, []);

  const ids = useCallback((): Array<string | undefined> => {
    const s = store.current;
    return Array.from({ length: s.total }, (_, i) => s.pages.get(Math.floor(i / PAGE_SIZE))?.[i % PAGE_SIZE]?.docId);
  }, []);

  const loadAll = useCallback(async (): Promise<DocRow[]> => {
    const s = store.current;
    const pageCount = Math.ceil(s.total / PAGE_SIZE);
    const missing = Array.from({ length: pageCount }, (_, p) => p).filter((p) => !s.pages.has(p));
    for (let i = 0; i < missing.length; i += 4) {
      await Promise.all(
        missing.slice(i, i + 4).map(async (p) => {
          const r = await fetchPage(planRef.current, p * PAGE_SIZE, PAGE_SIZE, false);
          if (store.current === s) s.pages.set(p, r.rows);
        }),
      );
    }
    bump();
    const out: DocRow[] = [];
    for (let p = 0; p < pageCount; p++) out.push(...(s.pages.get(p) ?? []));
    return out;
  }, [fetchPage]);

  const allIds = useCallback(async (): Promise<string[]> => {
    const s = store.current;
    const pageCount = Math.ceil(s.total / PAGE_SIZE);
    if (Array.from({ length: pageCount }, (_, p) => p).every((p) => s.pages.has(p))) return ids().filter((x): x is string => x !== undefined);
    const p = planRef.current;
    const calls = Math.ceil(s.total / IDS_PAGE);
    const out: string[][] = [];
    for (let i = 0; i < calls; i += 4) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(4, calls - i) }, async (_, k) => (await fetchPage(p, (i + k) * IDS_PAGE, IDS_PAGE, false)).rows.map((r) => r.docId)),
      );
      out.push(...batch);
    }
    return out.flat();
  }, [fetchPage, ids]);

  return {
    total: store.current.total,
    loading: state.loading,
    error: state.error,
    facets: state.facets,
    forText: state.forText,
    version: tick,
    rowAt,
    ensure,
    loadAll,
    allIds,
    ids,
  };
}
