import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useApp } from '../../state/app-context';
import { Facets, hasFilters } from './Facets';
import { ResultList } from './ResultList';
import { useScanStatus } from './useScanStatus';
import { useSearch, type SearchState } from './useSearch';

const SORTS = ['relevance', 'title', 'year-desc', 'year-asc', 'added-desc', 'author'] as const;
const PAGE_SIZE = 25;

/**
 * The Library section: search bar, results with snippets and pages, facets, scan controls.
 * Phase 2 builds the full navigation (folder tree, list and grid) around these parts.
 */
export function LibraryView() {
  const { t } = useTranslation();
  const app = useApp();
  const inputId = useId();
  const helpId = useId();
  const sortId = useId();
  const { status, start, cancel, rebuild } = useScanStatus();
  const [state, setState] = useState<SearchState>({ text: '', filters: {}, sort: 'relevance', limit: PAGE_SIZE });

  // Scan on opening the view when nothing ran in this session (a new library, for instance).
  const startedFor = useRef<string | null>(null);
  useEffect(() => {
    if (status?.state === 'idle' && app.activeLibraryId && startedFor.current !== app.activeLibraryId) {
      startedFor.current = app.activeLibraryId;
      void start().catch(() => {});
    }
  }, [status?.state, app.activeLibraryId, start]);

  const refreshKey = `${status?.state ?? 'none'}:${status?.indexed ?? 0}`;
  const { results, facets, loading, error, forText } = useSearch(state, Boolean(app.activeLibraryId), refreshKey);
  const running = status?.state === 'running';
  // A new text, filter or sort starts again from the first page of results.
  const set = (patch: Partial<SearchState>) => setState((s) => ({ ...s, limit: PAGE_SIZE, ...patch }));

  return (
    <div className="page library-page" data-testid="section-library">
      <h1>{t('sections.library')}</h1>

      <div className="search-bar" role="search">
        <label htmlFor={inputId}>{t('search.label')}</label>
        <input
          id={inputId}
          type="search"
          value={state.text}
          maxLength={500}
          placeholder={t('search.placeholder')}
          aria-describedby={helpId}
          onChange={(e) => set({ text: e.target.value })}
          data-testid="search-input"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="hint" id={helpId}>
          {t('search.help')}
        </p>
      </div>

      <div className="library-tools">
        <label htmlFor={sortId}>{t('search.sort')}</label>
        <select id={sortId} value={state.sort} onChange={(e) => set({ sort: e.target.value as SearchState['sort'] })} data-testid="search-sort">
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`search.sorts.${s}`)}
            </option>
          ))}
        </select>
        <span className="spacer" />
        {running ? (
          <button type="button" onClick={() => void cancel()} data-testid="scan-cancel">
            {t('scan.cancel')}
          </button>
        ) : (
          <>
            <button type="button" onClick={() => void start().catch(() => {})} data-testid="scan-start">
              {t('scan.start')}
            </button>
            <button type="button" className="link" onClick={() => void rebuild().catch(() => {})} data-testid="index-rebuild">
              {t('scan.rebuild')}
            </button>
          </>
        )}
      </div>

      {error ? <ErrorNote testId="search-error">{errorMessage(error, t)}</ErrorNote> : null}

      <div className="library-body">
        <Facets facets={facets} filters={state.filters} onChange={(filters) => set({ filters })} />
        <section className="results-pane" aria-live="polite" aria-busy={loading} data-testid="results-pane" data-query={forText ?? ''}>
          {results && (
            <p className="results-summary" data-testid="search-summary">
              {t('search.results', { count: results.total })} · {t('search.took', { ms: Math.round(results.tookMs) })}
            </p>
          )}
          {results && results.hits.length > 0 && <ResultList hits={results.hits} />}
          {results && results.hits.length > 0 && results.total > results.hits.length && (
            <button type="button" onClick={() => setState((s) => ({ ...s, limit: s.limit + PAGE_SIZE }))} data-testid="search-more">
              {t('search.more')}
            </button>
          )}
          {results && results.hits.length === 0 && !loading && (
            <p className="empty" data-testid="search-empty">
              {state.text.trim() === '' && !hasFilters(state.filters) ? t('search.emptyLibrary') : t('search.none')}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
