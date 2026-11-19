import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lazy, lazyView } from '../../components/Lazy';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { AddMenu } from './AddMenu';
import { EmptyState } from '../../components/EmptyState';
import { IconLibrary } from '../../components/icons-shell';
import { Tabs, tabIds } from '../../components/Tabs';
import { ErrorNote } from '../../components/ui';
import { useAiUi } from '../../lib/aiUi';
import { errorMessage } from '../../lib/errors';
import { useChangeVersion } from '../../lib/events';
import { setSearchText, useSearchText } from '../../lib/librarySearch';
import { takeLibraryIntent } from '../../lib/libraryIntent';
import { useLocalChoice } from '../../lib/useLocalString';
import { useLocalFlag } from '../../lib/useLocalFlag';
import { useNotify } from '../../lib/notify';
import { useApp } from '../../state/app-context';
import { CARD_SIZES, DocViews, type CardSize, type ViewMode } from './DocViews';
import { browseFromIntent, hasAnyCondition, initialBrowse, planQuery, setTagFilter, withMissing, type BrowseState } from './docQuery';
import { FacetBar } from './FacetBar';
import { LibraryHeader } from './LibraryHeader';
import { FolderPane, TagTreePane } from './NavPanes';
import { SelectionBar } from './SelectionBar';
import { emptySelection, type SelectionState } from './selection';
import { useDocumentList, type DocRow } from './useDocumentList';
import { useScanStatus } from './useScanStatus';
import { TaxonomyProvider } from './useTaxonomy';
import './library.css';

// The detail panel, the selection summary, the taxonomy manager and the project dialog load when they are first used.
const DocumentCard = lazyView(() => import('./DocPanel').then((m) => ({ default: m.DocumentCard })), ['doc', 'library', 'doc-projects-reader', 'doc-reader', 'doc-review']);
const SelectionSummary = lazyView(() => import('./selection/SelectionSummary'), ['doc', 'library']);
const TaxonomyManager = lazyView(() => import('./TaxonomyManager').then((m) => ({ default: m.TaxonomyManager })), ['taxonomy']);
const LiteratureDialog = lazyView(() => import('../literature/LiteratureNote').then((m) => ({ default: m.LiteratureDialog })), ['literature', 'reader']);
const JobDialog = lazyView(() => import('../ai/JobDialog').then((m) => ({ default: m.JobDialog })), ['jobs']);
const ResourcesPane = lazyView(() => import('../resources/ResourcesPane'), ['resources', 'library']);
const AddToProject = lazyView(() => import('./AddToProject').then((m) => ({ default: m.AddToProject })), ['addToProject', 'projects']);

type PaneTab = 'folders' | 'tags';
const TABS: PaneTab[] = ['folders', 'tags'];

/**
 * The Library section: folder and tag pane, the one row of filters (or the selection bar), the documents as list or grid,
 * the document card on the right, and the taxonomy manager. The search box is in the top bar (D-441): its text comes from
 * `lib/librarySearch`.
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
  const { status, start, cancel } = useScanStatus();
  const docsVersion = useChangeVersion('documents');
  const text = useSearchText();

  const [state, setState] = useState<BrowseState>(() => browseFromIntent(takeLibraryIntent()));
  const [cleanupFirst] = useState(() => takeLibraryIntent()?.cleanup === true);
  const browse = useMemo<BrowseState>(() => ({ ...state, text }), [state, text]);
  const [view, setView] = useLocalChoice<ViewMode>('rl.libraryView', ['list', 'grid'], 'list');
  const [cardSize, setCardSize] = useLocalChoice<CardSize>('rl.cardSize', CARD_SIZES, 'm');
  const [tab, setTab] = useLocalChoice<PaneTab>('rl.libraryTab', TABS, 'folders');
  const [selection, setSelection] = useState<SelectionState>(emptySelection);
  const [detailOpen, setDetailOpen] = useLocalFlag('rl.detailOpen', false);
  const [navOpen, setNavOpen] = useState(false);
  const [mode, setMode] = useState<'browse' | 'taxonomy'>(cleanupFirst ? 'taxonomy' : 'browse');
  const [addOpen, setAddOpen] = useState(false);
  const [showResources, setShowResources] = useState(false);
  const [jobOpen, setJobOpen] = useState(false);
  const [litOpen, setLitOpen] = useState(false);
  const set = (patch: Partial<Omit<BrowseState, 'text'>>) => setState((b) => ({ ...b, ...patch }));

  // The text of the search box is the view's own while it lives: it goes away with the view.
  useEffect(() => () => setSearchText(''), []);

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
  const { publishSelection } = useAiUi();
  useEffect(() => {
    publishSelection(selectedIds);
  }, [selectedIds, publishSelection]);
  useEffect(() => () => publishSelection([]), [publishSelection]);
  const loadAll = list.loadAll;
  const needRows = useCallback(() => void loadAll().catch(() => {}), [loadAll]);
  const single = selection.ids.size === 1 ? selectedIds[0]! : null;
  const many = selection.ids.size > 1;
  const anything = hasAnyCondition(browse);

  const setIncludeSub = (v: boolean) => setState((b) => ({ ...b, includeSub: v, folder: v && b.folder === '' ? null : b.folder }));
  // "Show missing documents" is a view option, not a filter: clearing the filters leaves it as it is.
  const clearAll = () => {
    setSearchText('');
    setState((b) => ({ ...initialBrowse(), includeSub: b.includeSub, sort: b.sort, filters: withMissing({}, b.filters.includeMissing === true) }));
  };
  const openDetail = useCallback(
    (docId: string) => {
      setSelection((s) => (s.ids.has(docId) ? s : { ids: new Set([docId]), anchor: s.active, active: s.active }));
      setDetailOpen(true);
    },
    [setDetailOpen],
  );
  const onDeleteKey = useCallback(() => {
    // Nothing is deleted from the keyboard: the key opens the place where tags can be removed, after a confirmation.
    setDetailOpen(true);
    info(t('docs.deleteHint'));
  }, [info, t, setDetailOpen]);

  const ids = tabIds('library-nav', tab);
  return (
    <div className="view library-page" data-testid="section-library">
      {mode !== 'taxonomy' && (
      <LibraryHeader
        count={list.total}
        view={view}
        onView={setView}
        cardSize={cardSize}
        onCardSize={setCardSize}
        sort={browse.sort}
        hasText={browse.text.trim() !== ''}
        onSort={(sort) => set({ sort })}
        scanning={running}
        onScan={() => void start().catch(() => {})}
        onCancelScan={() => void cancel()}
        onManageTags={() => setMode('taxonomy')}
        detailOpen={detailOpen}
        onDetail={setDetailOpen}
        navOpen={navOpen}
        onNav={setNavOpen}
      />
      )}

      {mode === 'taxonomy' ? (
        <Lazy>
          <TaxonomyManager onBack={() => setMode('browse')} startCleanup={cleanupFirst} />
        </Lazy>
      ) : (
        <>
          {many ? (
            <SelectionBar
              ids={selectedIds}
              rows={selectedRows}
              onProject={() => setAddOpen(true)}
              onPropose={() => setJobOpen(true)}
              onLiterature={() => setLitOpen(true)}
              onClear={() => setSelection(emptySelection())}
              tagEditor={(close) => <SelectionSummary docIds={selectedIds} rows={selectedRows} onNeedRows={needRows} onProject={() => { close(); setAddOpen(true); }} onClose={close} />}
            />
          ) : (
            <FacetBar facets={list.facets} browse={browse} anything={anything} onFilters={(filters) => set({ filters })} onTags={(tags) => set({ tags })} onFolder={(folder) => set({ folder })} onClearAll={clearAll} resources={showResources} onResources={setShowResources} />
          )}
          <div className={`library-grid${detailOpen ? ' with-detail' : ''}${navOpen ? ' nav-open' : ''}`}>
            <aside className="library-nav" aria-label={t('docs.navigation')}>
              <Tabs
                label={t('docs.navigation')}
                idBase="library-nav"
                value={tab}
                onChange={(id) => setTab(id as PaneTab)}
                tabs={TABS.map((id) => ({ id, label: t(`docs.tabs.${id}`) }))}
              />
              <div role="tabpanel" id={ids.panelId} aria-labelledby={ids.tabId}>
                {tab === 'folders' && (
                  <FolderPane
                    folder={browse.folder}
                    includeSub={browse.includeSub}
                    onSelect={(path) => {
                      set({ folder: path });
                      setNavOpen(false);
                    }}
                    onIncludeSub={setIncludeSub}
                    reloadKey={refreshKey}
                  />
                )}
                {tab === 'tags' && (
                  <TagTreePane
                    include={browse.tags.include}
                    exclude={browse.tags.exclude}
                    onInclude={(id) => set({ tags: setTagFilter(browse.tags, id, browse.tags.include.includes(id) ? null : 'include') })}
                    onExclude={(id) => set({ tags: setTagFilter(browse.tags, id, browse.tags.exclude.includes(id) ? null : 'exclude') })}
                    onManage={() => setMode('taxonomy')}
                  />
                )}
              </div>
            </aside>

            <section className="results-pane" aria-live="polite" aria-busy={list.loading} data-testid="results-pane" data-query={list.forText ?? ''}>
              {list.error ? <ErrorNote testId="search-error">{errorMessage(list.error, t)}</ErrorNote> : null}
              {showResources && (
                <Lazy>
                  <ResourcesPane />
                </Lazy>
              )}
              {!showResources && list.total > 0 && (
                <DocViews
                  list={list}
                  view={view}
                  cardSize={cardSize}
                  searching={searching}
                  selection={selection}
                  onSelection={setSelection}
                  onOpenDetail={openDetail}
                  onDeleteKey={onDeleteKey}
                  ariaLabel={t('docs.listLabel')}
                  showSize={browse.sort === 'size-desc' || browse.sort === 'size-asc'}
                />
              )}
              {!showResources && list.total === 0 && !list.loading && list.forText !== undefined && (
                <div className="library-empty" data-testid="search-empty">
                  {anything ? (
                    <EmptyState icon={<IconLibrary size={24} />} title={t('library.noResultsTitle')} action={<Button onClick={clearAll}>{t('library.clear')}</Button>}>
                      {t('search.none')}
                    </EmptyState>
                  ) : (
                    <EmptyState
                      icon={<IconLibrary size={24} />}
                      title={t('library.emptyTitle')}
                      action={<AddMenu />}
                    >
                      {t('search.emptyLibrary')}
                    </EmptyState>
                  )}
                </div>
              )}
            </section>

            {detailOpen && (
              <aside className="detail-pane" aria-label={t('docs.details')} data-testid="detail-pane" onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.rl-popover') && setDetailOpen(false)}>
                <Lazy>
                  {single ? (
                    <DocumentCard key={single} docId={single} onClose={() => setDetailOpen(false)} />
                  ) : many ? (
                    <SelectionSummary docIds={selectedIds} rows={selectedRows} onNeedRows={needRows} onProject={() => setAddOpen(true)} onClose={() => setDetailOpen(false)} />
                  ) : (
                    <p className="hint detail-empty" data-testid="detail-empty">
                      {t('library.detailEmpty')}
                    </p>
                  )}
                </Lazy>
              </aside>
            )}
          </div>
        </>
      )}
      {jobOpen && (
        <Lazy>
          <JobDialog docIds={selectedIds} onClose={() => setJobOpen(false)} />
        </Lazy>
      )}
      {litOpen && (
        <Lazy>
          <LiteratureDialog docIds={selectedIds} onClose={() => setLitOpen(false)} />
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
