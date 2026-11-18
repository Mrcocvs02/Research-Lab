import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { IconMore } from '../../components/icons';
import { IconButton } from '../../components/IconButton';
import { Lazy, lazyRetry } from '../../components/Lazy';
import { Menu, type MenuGroups } from '../../components/Menu';
import { Tabs, tabIds } from '../../components/Tabs';
import { useCitationJob } from '../../lib/citationJobs';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { RlError } from '../../lib/rl-error';
import { useApp } from '../../state/app-context';
import { ViewHead } from '../projects/ViewHead';
import { NewItems } from './NewItems';
import { Published } from './Published';
import { ReadNext } from './ReadNext';
import { useRefreshCitations } from './refreshCitations';
import './discover.css';

export type WatchSource = ResponseOf<Channels, 'watch:list'>['sources'][number];
/** The tabs of the design (4 with "Searches", which a later wave adds first); "Followed sources" is managed from the row of "New". */
export type DiscoverTab = 'readnext' | 'new' | 'published';
const TABS: DiscoverTab[] = ['readnext', 'new', 'published'];

// The sources editor is loaded when someone opens it.
const Sources = lazyRetry(() => import('./Sources').then((m) => ({ default: m.Sources })));

/**
 * The Discover section (lazy): what to read next (computed locally from stored citations), new works from followed
 * sources, and published versions of preprints. Nothing here touches the network until the user presses a button that
 * says so ("Check now", "Look for published versions", "Refresh citations").
 */
export function DiscoverView() {
  const { t } = useTranslation();
  const { activeLibraryId } = useApp();
  const [tab, setTab] = useState<DiscoverTab>('readnext');
  const [sources, setSources] = useState<WatchSource[] | null>(null);
  const [managing, setManaging] = useState(false);
  // Moves whenever the watch data changed (after a check, a dismissal or a source edit): the tabs reload their lists.
  const [nonce, setNonce] = useState(0);
  const citations = useCitationJob();
  const refresh = useRefreshCitations();
  const { reportError } = useNotify();
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

  const more: MenuGroups = [
    {
      id: 'discover',
      // The sentence under the entry (D-427): what it does and that it goes online.
      label: t('discover.refreshHint'),
      items: [refresh.busy ? { id: 'refresh', testId: 'discover-refresh', label: t('discover.refresh'), disabled: true, disabledReason: t('citations.alreadyRunning'), onSelect: () => {} } : { id: 'refresh', testId: 'discover-refresh', label: t('discover.refresh'), onSelect: () => void refresh.start() }],
    },
  ];

  const ids = (id: string) => tabIds('discover', id);
  return (
    <div className="view discover-page" data-testid="section-discover">
      <ViewHead title={t('discover.title')}>
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
      <Tabs tabs={TABS.map((id) => ({ id, label: t(`discover.tab_${id}`) }))} value={tab} onChange={(id) => setTab(id as DiscoverTab)} label={t('discover.tabs')} idBase="discover" testIdBase="discover-tab" />
      <div className="discover-panel" role="tabpanel" id={ids(tab).panelId} aria-labelledby={ids(tab).tabId}>
        {tab === 'readnext' && <ReadNext reloadKey={citations.version} />}
        {tab === 'new' && <NewItems sources={sources} nonce={nonce} onChanged={reload} onManage={() => setManaging(true)} />}
        {tab === 'published' && <Published />}
      </div>
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
