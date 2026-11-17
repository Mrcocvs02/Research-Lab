import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Lazy, lazyView } from '../../components/Lazy';
import { useTranslation } from 'react-i18next';
import { ErrorNote } from '../../components/ui';
import { useAiUi } from '../../lib/aiUi';
import { errorMessage } from '../../lib/errors';
import { useChangeVersion } from '../../lib/events';
import { HistoryControls } from '../../lib/history';
import { useCitationJob } from '../../lib/citationJobs';
import { useNotify } from '../../lib/notify';
import { useLocalChoice } from '../../lib/useLocalString';
import { useApp } from '../../state/app-context';
import { DocViews, type ViewMode } from './DocViews';
import { hasAnyCondition, initialBrowse, planQuery, SORTS, setTagFilter, withMissing, type BrowseState } from './docQuery';
import { Facets } from './Facets';
import { ActiveFilters, TagFilterBar } from './FilterBar';
import { FolderPane, TagTreePane } from './NavPanes';
import { emptySelection, type SelectionState } from './selection';
import { useDocumentList, type DocRow } from './useDocumentList';
import { useScanStatus } from './useScanStatus';
import { TaxonomyProvider } from './useTaxonomy';

// The detail panel, the bulk tag editor, the taxonomy manager and the project dialog load when they are first used.
const DocumentCard = lazyView(() => import('./DocPanel').then((m) => ({ default: m.DocumentCard })), ['doc', 'doc-projects-reader', 'doc-reader', 'doc-review']);
const BulkTagEditor = lazyView(() => import('./DocPanel').then((m) => ({ default: m.BulkTagEditor })), ['doc', 'doc-projects-reader', 'doc-reader', 'doc-review']);
const TaxonomyManager = lazyView(() => import('./TaxonomyManager').then((m) => ({ default: m.TaxonomyManager })), ['taxonomy']);
const JobDialog = lazyView(() => import('../ai/JobDialog').then((m) => ({ default: m.JobDialog })), ['jobs']);
const AdvancedSearchDialog = lazyView(() => import('../ai/AdvancedSearchDialog').then((m) => ({ default: m.AdvancedSearchDialog })), ['advSearch']);
const AddToProject = lazyView(() => import('./AddToProject').then((m) => ({ default: m.AddToProject })), ['addToProject']);

type PaneTab = 'folders' | 'tags' | 'filters';
const TABS: PaneTab[] = ['folders', 'tags', 'filters'];

/**
 * The Library section (phase 2): folder tree, tag and facet filters, the documents as list or grid, the
 * document card and bulk tag editor on the right, and the taxonomy manager. The phase 1 search is the text box.
 */
export function LibraryView() {
  return (
    <TaxonomyProvider>
      <LibraryInner />
    </TaxonomyProvider>
  );
}

function LibraryInner() {
  const { t } = useTranslation();
  const app = useApp();
  const { info } = useNotify();
  const inputId = useId();
  const helpId = useId();
  const sortId = useId();
  const missingId = useId();
  const { status, start, cancel, rebuild } = useScanStatus();
  const docsVersion = useChangeVersion('documents');
  const citationJob = useCitationJob();

  const [browse, setBrowse] = useState<BrowseState>(initialBrowse);
  const [view, setView] = useLocalChoice<ViewMode>('rl.libraryView', ['list', 'grid'], 'list');
  const [tab, setTab] = useLocalChoice<PaneTab>('rl.libraryTab', TABS, 'folders');
  const [selection, setSelection] = useState<SelectionState>(emptySelection);
  const [detailOpen, setDetailOpen] = useState(false);
  const [mode, setMode] = useState<'browse' | 'taxonomy'>('browse');
  const [addOpen, setAddOpen] = useState(false);
  const [jobOpen, setJobOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const set = (patch: Partial<BrowseState>) => setBrowse((b) => ({ ...b, ...patch }));

  // Scan on opening the view when nothing ran in this session (a new library, for instance).
  const startedFor = useRef<string | null>(null);
  useEffect(() => {
    if (status?.state === 'idle' && app.activeLibraryId && startedFor.current !== app.activeLibraryId) {
      startedFor.current = app.activeLibraryId;
      void start().catch(() => {});
    }
  }, [status?.state, app.activeLibraryId, start]);

  // The detail panel is the most used part loaded on demand: fetch it once the first screen is idle, so that the
  // first click on a document shows it at once (functionality before lightness, docs/RULES.md).
  useEffect(() => {
    if (typeof requestIdleCallback !== 'function') return; // test DOMs have no idle callbacks
    const id = requestIdleCallback(() => void import('./DocPanel').catch(() => {}));
    return () => cancelIdleCallback(id);
  }, []);

  const refreshKey = `${status?.state ?? 'none'}:${status?.indexed ?? 0}:${docsVersion}`;
  const plan = useMemo(() => planQuery(browse), [browse]);
  const list = useDocumentList(plan, Boolean(app.activeLibraryId), refreshKey);
  const running = status?.state === 'running';
  const searching = (list.forText ?? '').trim() !== '';
  const shownSort = browse.sort === 'relevance' && browse.text.trim() === '' ? 'title' : browse.sort;

  // A different query is a different list: the selection and the card do not follow it.
  useEffect(() => {
    setSelection(emptySelection());
  }, [plan.key]);

  const selectedRows = useMemo<DocRow[]>(() => {
    if (selection.ids.size === 0) return [];
    const ids = list.ids();
    const out: DocRow[] = [];
    for (let i = 0; i < ids.length && out.length < selection.ids.size; i++) {
      const id = ids[i];
      if (id !== undefined && selection.ids.has(id)) {
        const row = list.rowAt(i);
        if (row) out.push(row);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, list.version]);

  const selectedIds = useMemo(() => [...selection.ids], [selection]);
  // The chat panel uses the selection as context; it is withdrawn when the library view goes away.
  const { publishSelection, openExport } = useAiUi();
  useEffect(() => {
    publishSelection(selectedIds);
  }, [selectedIds, publishSelection]);
  useEffect(() => () => publishSelection([]), [publishSelection]);
  const loadAll = list.loadAll;
  const needRows = useCallback(() => void loadAll().catch(() => {}), [loadAll]);
  const single = selection.ids.size === 1 ? selectedIds[0]! : null;
  const showPanel = detailOpen && selection.ids.size > 0;
  const anything = hasAnyCondition(browse);

  const setIncludeSub = (v: boolean) => setBrowse((b) => ({ ...b, includeSub: v, folder: v && b.folder === '' ? null : b.folder }));
  // "Show missing documents" is a view option, not a filter: clearing the filters leaves it as it is.
  const clearAll = () => setBrowse((b) => ({ ...initialBrowse(), includeSub: b.includeSub, filters: withMissing({}, b.filters.includeMissing === true) }));
  const openDetail = useCallback((docId: string) => {
    setSelection((s) => (s.ids.has(docId) ? s : { ids: new Set([docId]), anchor: s.active, active: s.active }));
    setDetailOpen(true);
  }, []);
  const onDeleteKey = useCallback(() => {
    // Nothing is deleted from the keyboard: the key opens the place where tags can be removed, after a confirmation.
    setDetailOpen(true);
    info(t('docs.deleteHint'));
  }, [info, t]);

  return (
    <div className="page library-page" data-testid="section-library">
      <header className="library-head">
        <h1>{t('sections.library')}</h1>
        <div className="search-bar" role="search">
          <label htmlFor={inputId}>{t('search.label')}</label>
          <div className="search-row">
            <input
              id={inputId}
              type="search"
              value={browse.text}
              maxLength={500}
              placeholder={t('search.placeholder')}
              aria-describedby={helpId}
              onChange={(e) => set({ text: e.target.value })}
              data-testid="search-input"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" onClick={() => setAdvOpen(true)} title={t('advSearch.buttonHint')} data-testid="adv-search">
              {t('advSearch.button')}
            </button>
          </div>
          <p className="hint" id={helpId}>
            {t('search.help')}
          </p>
        </div>
        <HistoryControls />
      </header>

      <div className="library-tools">
        <div className="radio-row" role="group" aria-label={t('docs.view')}>
          {(['list', 'grid'] as ViewMode[]).map((v) => (
            <button key={v} type="button" className={view === v ? 'toggle on' : 'toggle'} aria-pressed={view === v} onClick={() => setView(v)} data-testid={`view-${v}`}>
              {t(`docs.view_${v}`)}
            </button>
          ))}
        </div>
        <label htmlFor={sortId}>{t('search.sort')}</label>
        <select id={sortId} value={shownSort} onChange={(e) => set({ sort: e.target.value as BrowseState['sort'] })} data-testid="search-sort">
          {SORTS.filter((s) => s !== 'relevance' || browse.text.trim() !== '').map((s) => (
            <option key={s} value={s}>
              {t(`search.sorts.${s}`)}
            </option>
          ))}
        </select>
        <div className="check">
          <input
            id={missingId}
            type="checkbox"
            checked={browse.filters.includeMissing === true}
            onChange={(e) => set({ filters: withMissing(browse.filters, e.target.checked) })}
            data-testid="show-missing"
          />
          <label htmlFor={missingId}>{t('search.showMissing')}</label>
        </div>
        <span className="spacer" />
        <button type="button" onClick={() => setMode(mode === 'taxonomy' ? 'browse' : 'taxonomy')} aria-pressed={mode === 'taxonomy'} data-testid="open-taxonomy">
          {t('tax.title')}
        </button>
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

      {mode === 'taxonomy' ? (
        <Lazy>
          <TaxonomyManager onBack={() => setMode('browse')} />
        </Lazy>
      ) : (
        <div className={showPanel ? 'library-grid with-detail' : 'library-grid'}>
          <aside className="library-nav" aria-label={t('docs.navigation')}>
            <div className="tabs" role="tablist" aria-label={t('docs.navigation')}>
              {TABS.map((id) => (
                <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`tabpanel-${id}`} className={tab === id ? 'tab on' : 'tab'} onClick={() => setTab(id)} data-testid={`tab-${id}`}>
                  {t(`docs.tabs.${id}`)}
                </button>
              ))}
            </div>
            <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
              {tab === 'folders' && <FolderPane folder={browse.folder} includeSub={browse.includeSub} onSelect={(path) => set({ folder: path })} onIncludeSub={setIncludeSub} reloadKey={refreshKey} />}
              {tab === 'tags' && (
                <TagTreePane
                  include={browse.tags.include}
                  exclude={browse.tags.exclude}
                  onInclude={(id) => set({ tags: setTagFilter(browse.tags, id, browse.tags.include.includes(id) ? null : 'include') })}
                  onExclude={(id) => set({ tags: setTagFilter(browse.tags, id, browse.tags.exclude.includes(id) ? null : 'exclude') })}
                  onManage={() => setMode('taxonomy')}
                />
              )}
              {tab === 'filters' && <Facets facets={list.facets} filters={browse.filters} onChange={(filters) => set({ filters })} />}
            </div>
          </aside>

          <section className="results-pane" aria-live="polite" aria-busy={list.loading} data-testid="results-pane" data-query={list.forText ?? ''}>
            <TagFilterBar tags={browse.tags} onChange={(tags) => set({ tags })} />
            <ActiveFilters
              filters={browse.filters}
              folder={browse.folder}
              includeSub={browse.includeSub}
              onFilters={(filters) => set({ filters })}
              onFolder={(folder) => set({ folder })}
              onClearAll={clearAll}
              anything={anything}
            />
            {list.error ? <ErrorNote testId="search-error">{errorMessage(list.error, t)}</ErrorNote> : null}
            <div className="results-bar">
              <p className="results-summary" data-testid="search-summary">
                {t('search.results', { count: list.total })}
              </p>
              {selection.ids.size > 0 && (
                <div className="selection-bar" data-testid="selection-bar">
                  <span data-testid="selection-count">{t('docs.selected', { count: selection.ids.size })}</span>
                  <button type="button" onClick={() => setDetailOpen(true)} data-testid="selection-details">
                    {single ? t('docs.details') : t('bulk.editTags')}
                  </button>
                  <button type="button" onClick={() => setAddOpen(true)} data-testid="add-to-project-button">
                    {t('projects.addToProject')}
                  </button>
                  <button type="button" onClick={() => setJobOpen(true)} data-testid="bulk-ai-propose">
                    {t('jobs.propose')}
                  </button>
                  <button type="button" onClick={() => void citationJob.start(selectedIds)} disabled={citationJob.busy} title={citationJob.busy ? t('citations.alreadyRunning') : t('citations.bulkHint')} data-testid="bulk-citations">
                    {t('citations.bulk')}
                  </button>
                  <button type="button" onClick={() => openExport({ docIds: selectedIds })} data-testid="bulk-export">
                    {t('secondBrain.button')}
                  </button>
                  <button type="button" className="link" onClick={() => setSelection(emptySelection())} data-testid="selection-clear">
                    {t('docs.clearSelection')}
                  </button>
                </div>
              )}
            </div>
            {list.total > 0 && <DocViews list={list} view={view} searching={searching} selection={selection} onSelection={setSelection} onOpenDetail={openDetail} onDeleteKey={onDeleteKey} ariaLabel={t('docs.listLabel')} />}
            {list.total === 0 && !list.loading && list.forText !== undefined && (
              <p className="empty" data-testid="search-empty">
                {anything ? t('search.none') : t('search.emptyLibrary')}
              </p>
            )}
          </section>

          {showPanel && (
            <aside className="detail-pane" aria-label={t('docs.details')} data-testid="detail-pane" onKeyDown={(e) => e.key === 'Escape' && setDetailOpen(false)}>
              <Lazy>
                {single ? <DocumentCard key={single} docId={single} onClose={() => setDetailOpen(false)} /> : <BulkTagEditor docIds={selectedIds} rows={selectedRows} onNeedRows={needRows} onClose={() => setDetailOpen(false)} />}
              </Lazy>
            </aside>
          )}
        </div>
      )}
      {advOpen && (
        <Lazy>
          <AdvancedSearchDialog initialText={browse.text} onClose={() => setAdvOpen(false)} />
        </Lazy>
      )}
      {jobOpen && (
        <Lazy>
          <JobDialog docIds={selectedIds} onClose={() => setJobOpen(false)} />
        </Lazy>
      )}
      {addOpen && (
        <Lazy>
          <AddToProject docIds={selectedIds} onClose={() => setAddOpen(false)} />
        </Lazy>
      )}
    </div>
  );
}
