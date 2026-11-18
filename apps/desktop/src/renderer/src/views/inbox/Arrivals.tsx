import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModelConfig, ReasoningLevel } from '@rl/core';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { IconCheck } from '../../components/icons';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useLibraryEvents } from '../../lib/events';
import { useInbox } from '../../lib/inbox';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import { useFolderOptions } from '../library/useFolderOptions';
import { InboxCard, initialMeta, metaPayload } from './InboxCard';
import type { InboxItem } from './InboxView';
import './inbox.css';

/** A file the bulk confirm can take as proposed: no duplicate, no sync-conflict mark (those need a look). */
const plain = (i: InboxItem) => i.duplicate === null && !i.conflictOf;

/** "New files": what arrived from outside (to add) and what the scan found in the library (to check), two groups. */
export function Arrivals({ model, reasoning, models }: { model: string; reasoning: ReasoningLevel; models: ModelConfig[] }) {
  const { t } = useTranslation();
  const inbox = useInbox();
  const { info, reportError } = useNotify();
  const { invalidate } = useLibraryEvents();
  const folders = useFolderOptions();
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

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
  const groups = useMemo(() => {
    const all = items ?? [];
    return { dropped: all.filter((i) => i.kind === 'dropped'), library: all.filter((i) => i.kind === 'library') };
  }, [items]);
  const livePicked = useMemo(() => (items ?? []).filter((i) => picked.has(i.id) && plain(i)), [items, picked]);
  const pickable = groups.dropped.filter(plain);
  const toggle = (id: string, on: boolean) => setPicked((cur) => new Set(on ? [...cur, id] : [...cur].filter((x) => x !== id)));

  const confirmPicked = async () => {
    setBusy(true);
    let done = 0;
    for (const item of livePicked) {
      try {
        await rl.invoke('inbox:confirm', {
          id: item.id,
          name: item.proposal.name ?? item.fileName,
          folder: item.proposal.folder ?? '',
          tagIds: item.proposal.tagIds,
          newTags: item.proposal.newTags,
          metadata: metaPayload(initialMeta(item)),
          allowDuplicate: false,
        });
        done++;
      } catch (e) {
        reportError(e);
        break;
      }
    }
    if (done > 0) {
      invalidate('documents');
      invalidate('taxonomy');
      info(t('inbox.confirmedMany', { count: done }));
    }
    setPicked(new Set());
    setBusy(false);
    void load();
  };

  const markSeen = async () => {
    setBusy(true);
    try {
      for (const item of groups.library) await rl.invoke('inbox:dismiss', { id: item.id });
      info(t('inbox.seenMany', { count: groups.library.length }));
    } catch (e) {
      reportError(e);
    }
    setBusy(false);
    void load();
  };

  const row = (item: InboxItem, canPick: boolean) => (
    <InboxCard key={item.id} item={item} folders={folders} model={model} reasoning={reasoning} models={models} onItem={replace} onGone={() => void load()} {...(canPick && plain(item) ? { selected: picked.has(item.id), onSelect: (on: boolean) => toggle(item.id, on) } : {})} />
  );

  return (
    <div className="inbox" data-testid="inbox-view">
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
        <EmptyState icon={<IconCheck size={24} />} title={t('inbox.emptyTitle')} className="rh-empty">
          <span data-testid="inbox-empty">{t('inbox.empty')}</span>
        </EmptyState>
      )}
      {groups.dropped.length > 0 && (
        <section className="rh-group" aria-label={t('inbox.groupNew')}>
          <header className="rh-group__head">
            <div>
              <p className="rh-caption">{t('inbox.groupNew')}</p>
              <p className="hint">{t('inbox.groupNewHelp')}</p>
            </div>
            {pickable.length > 1 && (
              <label className="rh-all">
                <input type="checkbox" checked={livePicked.length === pickable.length} onChange={(e) => setPicked(new Set(e.target.checked ? pickable.map((i) => i.id) : []))} data-testid="inbox-select-all" />
                {t('inbox.selectAll')}
              </label>
            )}
            {livePicked.length > 0 && (
              <Button variant="primary" size="sm" busy={busy} onClick={() => void confirmPicked()} data-testid="inbox-confirm-selected">
                {t('inbox.confirmSelected', { count: livePicked.length })}
              </Button>
            )}
          </header>
          <ul className="inbox-list" aria-label={t('inbox.listLabel')}>
            {groups.dropped.map((i) => row(i, true))}
          </ul>
        </section>
      )}
      {groups.library.length > 0 && (
        <section className="rh-group" aria-label={t('inbox.groupLib')}>
          <header className="rh-group__head">
            <div>
              <p className="rh-caption">{t('inbox.groupLib')}</p>
              <p className="hint">{t('inbox.groupLibHelp')}</p>
            </div>
            <Button size="sm" busy={busy} onClick={() => void markSeen()} data-testid="inbox-mark-seen">
              {t('inbox.markSeen')}
            </Button>
          </header>
          <ul className="inbox-list" aria-label={t('inbox.listLabelLib')}>
            {groups.library.map((i) => row(i, false))}
          </ul>
        </section>
      )}
    </div>
  );
}
