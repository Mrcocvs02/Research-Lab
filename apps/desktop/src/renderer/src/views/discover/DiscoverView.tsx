import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, DiscoverKind, ResponseOf } from '@rl/core';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { IconChevronDown, IconMore } from '../../components/icons';
import { IconButton } from '../../components/IconButton';
import { Lazy, lazyRetry, lazyView } from '../../components/Lazy';
import { Menu, type MenuGroups } from '../../components/Menu';
import { Tabs, tabIds } from '../../components/Tabs';
import { useCitationJob } from '../../lib/citationJobs';
import { takeDiscoverIntent } from '../../lib/discoverIntent';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { RlError } from '../../lib/rl-error';
import { useApp } from '../../state/app-context';
import { ViewHead } from '../projects/ViewHead';
import { NewItems } from './NewItems';
import { Published } from './Published';
import { ReadNext } from './ReadNext';
import type { Launch } from './Searches';
import { useRefreshCitations } from './refreshCitations';
import './discover.css';

export type WatchSource = ResponseOf<Channels, 'watch:list'>['sources'][number];
/** The tabs of the design (4 with "Searches", which a later wave adds first); "Followed sources" is managed from the row of "New". */
export type DiscoverTab = 'searches' | 'readnext' | 'new' | 'published';
const TABS: DiscoverTab[] = ['readnext', 'new', 'published'];
const WITH_SEARCHES: DiscoverTab[] = ['searches', ...TABS];

// The sources editor is loaded when someone opens it.
const Sources = lazyRetry(() => import('./Sources').then((m) => ({ default: m.Sources })));
// The searches (feature 41, 42) and the dialog that asks for one load when first used; the cost dialog needs the reader strings.
const Searches = lazyView(() => import('./Searches').then((m) => ({ default: m.Searches })), ['discover', 'reader']);
const NewSearchDialog = lazyView(() => import('./NewSearchDialog').then((m) => ({ default: m.NewSearchDialog })), ['discover']);

/**
 * The Discover section (lazy): what to read next (computed locally from stored citations), new works from followed
 * sources, and published versions of preprints. Nothing here touches the network until the user presses a button that
 * says so ("Check now", "Look for published versions", "Refresh citations").
 */
export function DiscoverView() {
  const { t } = useTranslation();
  const { activeLibraryId } = useApp();
  const [tab, setTab] = useState<DiscoverTab>('readnext');
  // Saved searches: their tab is the first one only when there is at least one (and then Discover opens there).
  const [runCount, setRunCount] = useState(0);
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [asking, setAsking] = useState<DiscoverKind | null>(null);
  const [pruning, setPruning] = useState<number | null>(null);
  const picked = useRef(false);
  const newAnchor = useRef<HTMLSpanElement>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [sources, setSources] = useState<WatchSource[] | null>(null);
  const [managing, setManaging] = useState(false);
  // Moves whenever the watch data changed (after a check, a dismissal or a source edit): the tabs reload their lists.
  const [nonce, setNonce] = useState(0);
  const citations = useCitationJob();
  const refresh = useRefreshCitations();
  const { info, reportError } = useNotify();
  const moreAnchor = useRef<HTMLSpanElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  // `watch.json` cannot be read: the user may set it aside (a copy is kept) and start again.
  const [damaged, setDamaged] = useState(false);

  const reload = useCallback(() => {
    rl.invoke('watch:list', {}).then(
      (r) => {
        setDamaged(false);
        setSources(r.sources);
      },
      (e: unknown) => {
        setDamaged(RlError.from(e).code === 'SCHEMA_INVALID');
        setSources((cur) => cur ?? []);
      },
    );
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!activeLibraryId) return;
    reload();
    return rl.on('watch:changed', reload);
  }, [activeLibraryId, reload]);

  const begin = useCallback((l: Omit<Launch, 'nonce'>) => {
    picked.current = true;
    setAsking(null);
    setLaunch({ ...l, nonce: Date.now() });
    setTab('searches');
  }, []);

  // A search started from the selection bar of the Library (a one-slot mailbox).
  useEffect(() => {
    const i = takeDiscoverIntent();
    if (i && i.kind === 'extend') begin({ kind: 'extend', a: { docIds: i.docIds } });
    else if (i && i.docIds.length === 2) begin({ kind: 'bridge', a: { docIds: [i.docIds[0]!] }, b: { docIds: [i.docIds[1]!] } });
  }, [begin]);

  useEffect(() => {
    if (!activeLibraryId) return;
    rl.invoke('discover:list', {}).then(
      (r) => {
        setRunCount(r.items.length);
        if (r.items.length > 0 && !picked.current) setTab('searches');
      },
      () => undefined,
    );
  }, [activeLibraryId]);

  const askPrune = () => void rl.invoke('discover:prune', { days: 90, dryRun: true }).then((r) => (r.count === 0 ? info(t('discover.pruneNone')) : setPruning(r.count)), reportError);
  const prune = () =>
    void rl.invoke('discover:prune', { days: 90, dryRun: false }).then(() => {
      setPruning(null);
      setLaunch(null);
      void rl.invoke('discover:list', {}).then((r) => setRunCount(r.items.length), () => undefined);
      setTab('readnext');
    }, reportError);

  const newMenu: MenuGroups = [
    { id: 'question', label: t('discover.new.hint_question'), items: [{ id: 'question', testId: 'new-search-question', label: t('discover.new.kind_question'), onSelect: () => setAsking('question') }] },
    { id: 'extend', label: t('discover.new.hint_extend'), items: [{ id: 'extend', testId: 'new-search-extend', label: t('discover.new.kind_extend'), onSelect: () => setAsking('extend') }] },
    { id: 'bridge', label: t('discover.new.hint_bridge'), items: [{ id: 'bridge', testId: 'new-search-bridge', label: t('discover.new.kind_bridge'), onSelect: () => setAsking('bridge') }] },
  ];

  const more: MenuGroups = [
    {
      id: 'discover',
      // The sentence under the entry (D-427): what it does and that it goes online.
      label: t('discover.refreshHint'),
      items: [refresh.busy ? { id: 'refresh', testId: 'discover-refresh', label: t('discover.refresh'), disabled: true, disabledReason: t('citations.alreadyRunning'), onSelect: () => {} } : { id: 'refresh', testId: 'discover-refresh', label: t('discover.refresh'), onSelect: () => void refresh.start() }],
    },
    { id: 'prune', items: [{ id: 'prune', testId: 'discover-prune', label: t('discover.pruneOld'), onSelect: askPrune }] },
  ];

  const ids = (id: string) => tabIds('discover', id);
  return (
    <div className="view discover-page" data-testid="section-discover">
      <ViewHead title={t('discover.title')}>
        <span ref={newAnchor}>
          <Button variant="primary" aria-haspopup="menu" aria-expanded={newOpen} onClick={() => setNewOpen(!newOpen)} data-testid="discover-new-search">
            {t('discover.new.button')}
            <IconChevronDown size={16} />
          </Button>
        </span>
        <Menu anchor={newAnchor} open={newOpen} onClose={() => setNewOpen(false)} groups={newMenu} label={t('discover.new.button')} width={340} />
        <span ref={moreAnchor}>
          <IconButton label={t('discover.more')} variant="secondary" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)} data-testid="discover-more">
            <IconMore size={20} />
          </IconButton>
        </span>
        <Menu anchor={moreAnchor} open={moreOpen} onClose={() => setMoreOpen(false)} groups={more} label={t('discover.more')} width={300} />
      </ViewHead>
      {damaged && (
        <div data-testid="watch-damaged">
          <Banner tone="error">
            <p>{t('discover.damaged')}</p>
            <Button size="sm" onClick={() => void rl.invoke('watch:reset', {}).then(reload, reportError)} data-testid="watch-reset">
              {t('discover.reset')}
            </Button>
          </Banner>
        </div>
      )}
      <Tabs tabs={(runCount > 0 || tab === 'searches' ? WITH_SEARCHES : TABS).map((id) => ({ id, label: t(`discover.tab_${id}`) }))} value={tab} onChange={(id) => {
          picked.current = true;
          setTab(id as DiscoverTab);
        }} label={t('discover.tabs')} idBase="discover" testIdBase="discover-tab" />
      <div className="discover-panel" role="tabpanel" id={ids(tab).panelId} aria-labelledby={ids(tab).tabId}>
        {tab === 'searches' && (
          <Lazy>
            <Searches launch={launch} onCount={setRunCount} onStarted={() => setLaunch(null)} />
          </Lazy>
        )}
        {tab === 'readnext' && <ReadNext reloadKey={citations.version} />}
        {tab === 'new' && <NewItems sources={sources} nonce={nonce} onChanged={reload} onManage={() => setManaging(true)} />}
        {tab === 'published' && <Published />}
      </div>
      {asking && (
        <Lazy>
          <NewSearchDialog kind={asking} onStart={begin} onClose={() => setAsking(null)} />
        </Lazy>
      )}
      {pruning !== null && (
        <Dialog title={t('discover.pruneOld')} onClose={() => setPruning(null)} testId="discover-prune-dialog">
          <p>{t('discover.pruneConfirm', { count: pruning })}</p>
          <div className="actions dlg-foot">
            <Button onClick={() => setPruning(null)}>{t('discover.cancel')}</Button>
            <Button variant="danger" onClick={prune} data-testid="discover-prune-confirm">
              {t('discover.pruneOld')}
            </Button>
          </div>
        </Dialog>
      )}
      {managing && (
        <Dialog title={t('discover.sources.title')} onClose={() => setManaging(false)} testId="watch-sources-dialog">
          <Lazy>
            <Sources sources={sources} onChanged={reload} />
          </Lazy>
        </Dialog>
      )}
    </div>
  );
}
