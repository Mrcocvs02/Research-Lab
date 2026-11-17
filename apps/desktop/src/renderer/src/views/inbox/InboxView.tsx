import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ReasoningLevel, ResponseOf } from '@rl/core';
import { Lazy, lazyRetry } from '../../components/Lazy';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useInbox } from '../../lib/inbox';
import { rl } from '../../lib/rl';
import { useApp } from '../../state/app-context';
import { safeText } from '../library/safeText';
import { TaxonomyProvider } from '../library/useTaxonomy';
import { InboxCard } from './InboxCard';

const ReviewView = lazyRetry(() => import('../review/ReviewView').then((m) => ({ default: m.ReviewView })));

export type InboxItem = ResponseOf<Channels, 'inbox:list'>['items'][number];
type Tab = 'arrivals' | 'proposals';
const TABS: Tab[] = ['arrivals', 'proposals'];
const MAX_FOLDERS = 400;

/** Folders of the library a file can be copied to (breadth first, capped), without the excluded ones. */
function useFolderOptions(): string[] {
  const { config, activeLibraryId } = useApp();
  const [folders, setFolders] = useState<string[]>([]);
  const excluded = config?.excludedFolders;
  useEffect(() => {
    if (!activeLibraryId) return;
    let live = true;
    void (async () => {
      const out: string[] = [];
      const skip = (p: string) => (excluded ?? []).some((x) => p === x || p.startsWith(`${x}/`));
      const queue = [''];
      try {
        while (queue.length > 0 && out.length < MAX_FOLDERS) {
          const parent = queue.shift()!;
          const r = await rl.invoke('library:listFolders', { libraryId: activeLibraryId, ...(parent ? { parent } : {}) });
          for (const f of r.folders) {
            if (skip(f.path)) continue;
            out.push(f.path);
            if (f.hasChildren) queue.push(f.path);
          }
        }
      } catch {
        /* the select keeps what was found */
      }
      if (live) setFolders(out.sort());
    })();
    return () => {
      live = false;
    };
  }, [activeLibraryId, excluded]);
  return folders;
}

const REASONING: ReasoningLevel[] = ['low', 'medium', 'high'];

/** The Inbox section (lazy): files that arrived (dropped or found by the scan) and the AI proposals to review. */
export function InboxView({ tab, onTab }: { tab: Tab; onTab(t: Tab): void }) {
  const { t } = useTranslation();
  return (
    <TaxonomyProvider>
      <div className="page inbox-page" data-testid="section-inbox">
        <header className="library-head">
          <h1>{t('sections.inbox')}</h1>
        </header>
        <div className="tabs" role="tablist" aria-label={t('inbox.tabs')}>
          {TABS.map((id) => (
            <button key={id} type="button" role="tab" id={`inbox-tab-${id}`} aria-selected={tab === id} aria-controls={`inbox-panel-${id}`} className={tab === id ? 'tab on' : 'tab'} onClick={() => onTab(id)} data-testid={`inbox-tab-${id}`}>
              {t(`inbox.tab_${id}`)}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`inbox-panel-${tab}`} aria-labelledby={`inbox-tab-${tab}`}>
          {tab === 'arrivals' ? (
            <Arrivals />
          ) : (
            <Lazy>
              <ReviewView />
            </Lazy>
          )}
        </div>
      </div>
    </TaxonomyProvider>
  );
}

function Arrivals() {
  const { t } = useTranslation();
  const { config } = useApp();
  const inbox = useInbox();
  const ids = { model: useId(), reasoning: useId() };
  const folders = useFolderOptions();
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const models = config?.ai.models ?? [];
  const [model, setModel] = useState(config?.ai.defaultModel ?? models[0]?.id ?? '');
  const [reasoning, setReasoning] = useState<ReasoningLevel>(config?.ai.defaultReasoning ?? 'low');

  const load = useCallback(async () => {
    try {
      setItems((await rl.invoke('inbox:list', {})).items);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    void load();
    return rl.on('inbox:changed', () => void load());
  }, [load]);

  const replace = useCallback((item: InboxItem) => setItems((cur) => cur?.map((x) => (x.id === item.id ? item : x)) ?? cur), []);

  return (
    <div className="inbox" data-testid="inbox-view">
      <div className="library-tools">
        <button type="button" className="primary" onClick={() => void inbox.choose()} data-testid="inbox-add">
          {t('inbox.add')}
        </button>
        <span className="hint">{t('inbox.dropHelp')}</span>
        <span className="spacer" />
        <label htmlFor={ids.model}>{t('chat.model')}</label>
        <select id={ids.model} value={model} onChange={(e) => setModel(e.target.value)} data-testid="inbox-model">
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label || m.id}
            </option>
          ))}
        </select>
        <label htmlFor={ids.reasoning}>{t('chat.reasoning')}</label>
        <select id={ids.reasoning} value={reasoning} onChange={(e) => setReasoning(e.target.value as ReasoningLevel)} data-testid="inbox-reasoning">
          {REASONING.map((r) => (
            <option key={r} value={r}>
              {t(`settings.library.reasoning${r === 'low' ? 'Low' : r === 'medium' ? 'Medium' : 'High'}`)}
            </option>
          ))}
        </select>
      </div>
      {inbox.refused.length > 0 && (
        <div className="callout" role="alert" data-testid="inbox-refused">
          <p>{t('inbox.refusedTitle', { count: inbox.refused.length })}</p>
          <ul>
            {inbox.refused.map((r, i) => (
              <li key={i} data-testid="inbox-refused-item" data-reason={r.reason}>
                {safeText(r.name)} — {t(`inbox.refused_${r.reason}`)}
              </li>
            ))}
          </ul>
          <button type="button" className="link" onClick={inbox.clearRefused} data-testid="inbox-refused-dismiss">
            {t('common.close')}
          </button>
        </div>
      )}
      {error ? <ErrorNote>{errorMessage(error, t)}</ErrorNote> : null}
      {items && items.length === 0 && (
        <p className="empty" data-testid="inbox-empty">
          {t('inbox.empty')}
        </p>
      )}
      <ul className="inbox-list" aria-label={t('inbox.listLabel')}>
        {items?.map((item) => (
          <InboxCard key={item.id} item={item} folders={folders} model={model} reasoning={reasoning} models={models} onItem={replace} onGone={() => void load()} />
        ))}
      </ul>
    </div>
  );
}
