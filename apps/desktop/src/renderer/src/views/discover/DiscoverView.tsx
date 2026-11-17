import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { useCitationJob } from '../../lib/citationJobs';
import { rl } from '../../lib/rl';
import { useApp } from '../../state/app-context';
import { NewItems } from './NewItems';
import { Published } from './Published';
import { ReadNext } from './ReadNext';
import { Sources } from './Sources';

export type WatchSource = ResponseOf<Channels, 'watch:list'>['sources'][number];
export type DiscoverTab = 'readnext' | 'new' | 'published' | 'sources';
const TABS: DiscoverTab[] = ['readnext', 'new', 'published', 'sources'];

/**
 * The Discover section (lazy): what to read next (computed locally from stored citations), new works from followed
 * sources, published versions of preprints, and the sources themselves. Nothing here touches the network until the
 * user presses a button that says so ("Check now", "Look for published versions").
 */
export function DiscoverView() {
  const { t } = useTranslation();
  const { activeLibraryId } = useApp();
  const [tab, setTab] = useState<DiscoverTab>('readnext');
  const [sources, setSources] = useState<WatchSource[] | null>(null);
  // Moves whenever the watch data changed (after a check, a dismissal or a source edit): the tabs reload their lists.
  const [nonce, setNonce] = useState(0);
  const citations = useCitationJob();

  const reload = useCallback(() => {
    rl.invoke('watch:list', {}).then(
      (r) => setSources(r.sources),
      () => setSources((cur) => cur ?? []),
    );
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!activeLibraryId) return;
    reload();
    return rl.on('watch:changed', reload);
  }, [activeLibraryId, reload]);

  return (
    <div className="page discover-page" data-testid="section-discover">
      <header className="library-head">
        <h1>{t('discover.title')}</h1>
      </header>
      <div className="tabs" role="tablist" aria-label={t('discover.tabs')}>
        {TABS.map((id) => (
          <button key={id} type="button" role="tab" id={`discover-tab-${id}`} aria-selected={tab === id} aria-controls={`discover-panel-${id}`} className={tab === id ? 'tab on' : 'tab'} onClick={() => setTab(id)} data-testid={`discover-tab-${id}`}>
            {t(`discover.tab_${id}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`discover-panel-${tab}`} aria-labelledby={`discover-tab-${tab}`}>
        {tab === 'readnext' && <ReadNext reloadKey={citations.version} />}
        {tab === 'new' && <NewItems sources={sources} nonce={nonce} onChanged={reload} />}
        {tab === 'published' && <Published />}
        {tab === 'sources' && <Sources sources={sources} onChanged={reload} />}
      </div>
    </div>
  );
}
