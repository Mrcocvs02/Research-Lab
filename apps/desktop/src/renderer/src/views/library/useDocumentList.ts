import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Channels, ResponseOf, StudyState } from '@rl/core';
import { rl } from '../../lib/rl';
import { passesClient, type QueryPlan } from './docQuery';
import type { TaxonomyModel } from './taxonomyModel';

export type SearchFacetsData = ResponseOf<Channels, 'search:facets'>;
type SummaryItem = ResponseOf<Channels, 'documents:list'>['items'][number];
type Hit = ResponseOf<Channels, 'search:query'>['hits'][number];

/** One line of the list: a document summary, or a search hit (no tags then: they come from the lookup). */
export interface DocRow {
  docId: string;
  title: string | null;
  authors: string[];
  year: number | null;
  type: string | null;
  path: string;
  studyState: StudyState;
  tags: string[] | null;
  addedAt: string;
  missing: boolean;
  snippet?: string;
  field?: Hit['field'];
  pages?: Hit['pages'];
}

export const PAGE_SIZE = 100;
const ALL_PAGE = 200;
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
  addedAt: s.addedAt,
  missing: s.missing,
});

const fromHit = (h: Hit): DocRow => {
  const row: DocRow = { docId: h.docId, title: h.title, authors: h.authors, year: h.year, type: h.type, path: h.path, studyState: h.studyState, tags: null, addedAt: '', missing: false, snippet: h.snippet, field: h.field };
  if (h.pages) row.pages = h.pages;
  return row;
};

/** Every document summary of the library, loaded once in the background (tags for search hits, client-side filters). */
export interface TagLookup {
  get(docId: string): string[] | undefined;
  /** Starts loading (once) and resolves when every summary is in. */
  ready(): Promise<void>;
}

export function useTagLookup(refreshKey: string): TagLookup & { version: number } {
  const map = useRef(new Map<string, string[]>());
  const loading = useRef<Promise<void> | null>(null);
  const wanted = useRef(false);
  const [version, setVersion] = useState(0);

  const load = useCallback(() => {
    const run = (async () => {
      const next = new Map<string, string[]>();
      let offset = 0;
      for (;;) {
        const page = await rl.invoke('documents:list', { sort: 'title', limit: ALL_PAGE, offset });
        for (const s of page.items) next.set(s.docId, s.tags);
        offset += page.items.length;
        if (page.items.length === 0 || offset >= page.total) break;
      }
      map.current = next;
      setVersion((v) => v + 1);
    })();
    const tracked: Promise<void> = run.finally(() => {
      if (loading.current === tracked) loading.current = null;
    });
    loading.current = tracked;
    return run;
  }, []);

  // A change of the documents makes the lookup stale: reload it, but only if somebody ever asked for it.
  useEffect(() => {
    if (wanted.current) void load().catch(() => {});
  }, [refreshKey, load]);

  return useMemo(
    () => ({
      version,
      get: (id: string) => map.current.get(id),
      ready: () => {
        if (!wanted.current) {
          wanted.current = true;
          return load();
        }
        return loading.current ?? Promise.resolve();
      },
    }),
    [version, load],
  );
}

export interface DocList {
  total: number;
  loading: boolean;
  error: unknown;
  facets: SearchFacetsData | null;
  /** The text the rows answer. */
  forText: string | undefined;
  /** True while the rows are the whole result, filtered here (see `QueryPlan.client`). */
  clientSide: boolean;
  /** Changes whenever rows were added or replaced. */
  version: number;
  rowAt(index: number): DocRow | undefined;
  /** Asks for the pages that cover rows `start`..`end` (inclusive). */
  ensure(start: number, end: number): void;
  /** Loads every row (for "select all" and range selection across unloaded pages). */
  loadAll(): Promise<DocRow[]>;
  /** The ids in list order; `undefined` for rows not loaded yet. */
  ids(): Array<string | undefined>;
}

interface Store {
  key: string;
  total: number;
  pages: Map<number, DocRow[]>;
  asked: Set<number>;
  all: DocRow[] | null;
}

/**
 * The documents of the current query as a sparse, paged list: only the pages near the scroll position are
 * requested, so 5000 documents cost a handful of calls. When the plan has client-side conditions the whole result is
 * loaded and filtered instead. Rows keep showing while a refresh of the same query is in flight.
 */
export function useDocumentList(plan: QueryPlan, enabled: boolean, refreshKey: string, model: TaxonomyModel, lookup: TagLookup & { version: number }): DocList {
  const store = useRef<Store>({ key: '', total: 0, pages: new Map(), asked: new Set(), all: null });
  const ticket = useRef(0);
  const [tick, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);
  const [state, setState] = useState<{ loading: boolean; error: unknown; facets: SearchFacetsData | null; forText: string | undefined }>({ loading: false, error: null, facets: null, forText: undefined });
  const planRef = useRef(plan);
  planRef.current = plan;
  const modelRef = useRef(model);
  modelRef.current = model;
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;

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

  const loadClientSide = useCallback(
    async (p: QueryPlan, mine: number) => {
      const rows: DocRow[] = [];
      let total = Infinity;
      let facets: SearchFacetsData | undefined;
      while (rows.length < total) {
        const r = await fetchPage(p, rows.length, ALL_PAGE, rows.length === 0);
        if (mine !== ticket.current) return null;
        if (r.facets) facets = r.facets;
        total = r.total;
        if (r.rows.length === 0) break;
        rows.push(...r.rows);
      }
      const needTags = rows.some((r) => r.tags === null);
      if (needTags) await lookupRef.current.ready();
      if (mine !== ticket.current) return null;
      const kept = rows
        .map((r) => (r.tags === null ? { ...r, tags: lookupRef.current.get(r.docId) ?? [] } : r))
        .filter((r) => passesClient(modelRef.current, p.client!, r));
      return { rows: kept, facets };
    },
    [fetchPage],
  );

  useEffect(() => {
    if (!enabled) return;
    const mine = ++ticket.current;
    const p = planRef.current;
    const sameQuery = store.current.key === p.key;
    if (!sameQuery) {
      store.current = { key: p.key, total: 0, pages: new Map(), asked: new Set(), all: null };
      bump();
    }
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(
      () => {
        void (async () => {
          try {
            if (p.client) {
              const r = await loadClientSide(p, mine);
              if (!r || mine !== ticket.current) return;
              store.current = { key: p.key, total: r.rows.length, pages: new Map(), asked: new Set(), all: r.rows };
              setState({ loading: false, error: null, facets: r.facets ?? null, forText: p.text });
            } else {
              const r = await fetchPage(p, 0, PAGE_SIZE, true);
              if (mine !== ticket.current) return;
              store.current = { key: p.key, total: r.total, pages: new Map([[0, r.rows]]), asked: new Set([0]), all: null };
              setState({ loading: false, error: null, facets: r.facets ?? null, forText: p.text });
            }
            bump();
          } catch (error) {
            if (mine === ticket.current) setState((s) => ({ ...s, loading: false, error }));
          }
        })();
      },
      p.text.trim() === '' ? 0 : DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [plan.key, enabled, refreshKey, fetchPage, loadClientSide]);

  const ensure = useCallback(
    (start: number, end: number) => {
      const s = store.current;
      if (s.all || s.key !== planRef.current.key) return;
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
    const row = s.all ? s.all[index] : s.pages.get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE];
    if (!row) return undefined;
    if (row.tags !== null) return row;
    const tags = lookupRef.current.get(row.docId);
    return tags ? { ...row, tags } : row;
  }, []);

  const ids = useCallback((): Array<string | undefined> => {
    const s = store.current;
    if (s.all) return s.all.map((r) => r.docId);
    return Array.from({ length: s.total }, (_, i) => s.pages.get(Math.floor(i / PAGE_SIZE))?.[i % PAGE_SIZE]?.docId);
  }, []);

  const loadAll = useCallback(async (): Promise<DocRow[]> => {
    const s = store.current;
    if (s.all) return s.all;
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

  return {
    total: store.current.total,
    loading: state.loading,
    error: state.error,
    facets: state.facets,
    forText: state.forText,
    clientSide: store.current.all !== null,
    version: tick,
    rowAt,
    ensure,
    loadAll,
    ids,
  };
}
