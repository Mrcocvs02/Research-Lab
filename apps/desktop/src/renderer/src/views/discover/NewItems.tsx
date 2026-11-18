import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { WorkRow } from '../citations/WorkRow';
import { safeText } from '../library/safeText';
import type { WatchSource } from './DiscoverView';
import { sourceName } from './sourceName';
import { useWatchOp } from './watchOps';
import '../citations/citations.css';
import './discover.css';

type Items = ResponseOf<Channels, 'watch:items'>;
type Item = Items['items'][number];
type CheckResult = ResponseOf<Channels, 'watch:check'>;

const PAGE = 100;

/** "New": works found by the followed sources. The only network use is "Check now". */
export function NewItems({ sources, nonce, onChanged }: { sources: WatchSource[] | null; nonce: number; onChanged(): void }) {
  const { t } = useTranslation();
  const { reportError } = useNotify();
  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<Item[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const op = useWatchOp<CheckResult>('check');
  const { running: checking, result } = op;
  const filterId = useId();

  useEffect(() => {
    let live = true;
    setError(null);
    rl.invoke('watch:items', { limit: PAGE, ...(filter ? { sourceId: filter } : {}) }).then(
      (r) => {
        if (!live) return;
        setItems(r.items);
        setTotal(r.total);
      },
      (e: unknown) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, [filter, nonce]);

  const more = useCallback(async () => {
    try {
      const r = await rl.invoke('watch:items', { limit: PAGE, offset: items?.length ?? 0, ...(filter ? { sourceId: filter } : {}) });
      setItems((cur) => [...(cur ?? []), ...r.items]);
      setTotal(r.total);
    } catch (e) {
      reportError(e);
    }
  }, [filter, items?.length, reportError]);

  const check = () => {
    setError(null);
    void op.run(() => rl.invoke('watch:check', {}), onChanged);
  };

  const dismiss = async (item: Item) => {
    try {
      await rl.invoke('watch:dismiss', { sourceId: item.sourceId, externalId: item.externalId });
      setItems((cur) => (cur ?? []).filter((i) => !(i.sourceId === item.sourceId && i.externalId === item.externalId)));
      setTotal((n) => Math.max(0, n - 1));
      onChanged();
    } catch (e) {
      reportError(e);
    }
  };

  const nameOf = (id: string) => sources?.find((s) => s.id === id);
  const label = (id: string) => {
    const s = nameOf(id);
    return s ? safeText(sourceName(s, t(`discover.sources.kind_${s.kind}`))) : t('discover.unknownSource');
  };

  return (
    <div data-testid="discover-new">
      <p className="hint">{t('discover.watch.intro')}</p>
      <div className="discover-bar">
        <div className="field">
          <label htmlFor={filterId}>{t('discover.watch.filter')}</label>
          <select id={filterId} value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="watch-filter">
            <option value="">{t('discover.watch.allSources')}</option>
            {(sources ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {safeText(sourceName(s, t(`discover.sources.kind_${s.kind}`)))}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="primary" onClick={check} disabled={checking || (sources !== null && sources.length === 0)} data-testid="watch-check">
          {checking ? t('discover.watch.checking') : t('discover.watch.checkNow')}
        </button>
      </div>
      {checking && (
        <p role="status" data-testid="watch-progress">
          {op.progress ? t('discover.watch.progress', { done: op.progress.done, total: op.progress.total }) : t('discover.watch.checking')}{' '}
          <button type="button" className="link" onClick={() => void op.cancel()} disabled={op.cancelling} data-testid="watch-cancel">
            {t('discover.cancel')}
          </button>
        </p>
      )}
      {sources !== null && sources.length === 0 && <p className="hint">{t('discover.watch.noSources')}</p>}
      {result && (
        <div role="status" data-testid="watch-result">
          <p>{t('discover.watch.checked', { count: result.checked, newItems: result.newItems })}</p>
          {result.failed.length > 0 && (
            <ul>
              {result.failed.map((f) => (
                <li key={f.sourceId} className="error-note" data-testid="watch-failed" data-code={f.code}>
                  {t('discover.watch.failedSource', { source: label(f.sourceId), reason: t(`errors.${f.code}`, { defaultValue: t('errors.INTERNAL') }) })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {(error ?? (checking ? null : op.error)) !== null && <ErrorNote testId="watch-error">{errorMessage(error ?? op.error, t)}</ErrorNote>}
      {items === null && error === null && <p className="hint">{t('discover.watch.loading')}</p>}
      {items && items.length === 0 && (
        <p className="empty" data-testid="watch-empty">
          {t('discover.watch.empty')}
        </p>
      )}
      {items && items.length > 0 && (
        <ul className="work-list" aria-label={t('discover.tab_new')}>
          {items.map((item) => (
            <WorkRow
              key={`${item.sourceId}:${item.externalId}`}
              testId="watch-item"
              title={item.title}
              authors={item.authors}
              year={item.year}
              venue={item.venue}
              ids={item}
              matched={item.inLibrary ? { docId: item.inLibrary, title: item.title ?? null } : null}
            >
              <span className="hint" data-testid="watch-item-source">
                {label(item.sourceId)}
              </span>
              <span className="hint">{item.publishedOn ? t('discover.watch.published', { date: item.publishedOn }) : t('discover.watch.firstSeen', { date: item.firstSeenAt.slice(0, 10) })}</span>
              <button type="button" className="link" onClick={() => void dismiss(item)} aria-label={`${t('discover.dismiss')}: ${safeText(item.title ?? '')}`} data-testid="watch-dismiss">
                {t('discover.dismiss')}
              </button>
            </WorkRow>
          ))}
        </ul>
      )}
      {items && total > items.length && (
        <button type="button" className="link" onClick={() => void more()} data-testid="watch-more">
          {t('citations.more', { count: total - items.length })}
        </button>
      )}
    </div>
  );
}
