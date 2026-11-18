import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { IconCheck } from '../../components/icons';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useChangeVersion } from '../../lib/events';
import { useJobs } from '../../lib/jobs';
import { rl } from '../../lib/rl';
import { DocChip } from '../chat/ChatParts';
import { safeText } from '../library/safeText';
import { AiMark, ReviewItemView, type ReviewItemData } from './ReviewItem';
import { useDecide, type ReviewField } from './useDecide';
import '../inbox/inbox.css';

type Stats = ResponseOf<Channels, 'review:stats'>;
const PAGE = 50;
const CONFIRM_OVER = 20;
type Bulk = 'accept' | 'reject';
/** A running job writes a proposal per document: the queue (a pass over every document) follows it at most this often. */
const JOB_RELOAD_MS = 2000;

/** `value`, but taking a new one at most every `ms` (the first change at once, the last one always arrives). */
function useThrottled<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const wait = last.current + ms - Date.now();
    if (wait <= 0) {
      last.current = Date.now();
      setOut(value);
      return;
    }
    const t = setTimeout(() => {
      last.current = Date.now();
      setOut(value);
    }, wait);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}
const FIELDS: ReviewField[] = ['tags', 'newTags', 'description', 'summary', 'keywords', 'synonyms', 'relations'];

/**
 * Review of what the AI proposed (lazy): the queue of proposed fields grouped by document, with statistics, paging,
 * per-field decisions and "accept all" / "reject all" for the page. Needs a `TaxonomyProvider` above it.
 */
export function ReviewView() {
  const { t } = useTranslation();
  const filterId = useId();
  const docsVersion = useChangeVersion('documents');
  const { job } = useJobs();
  const { decideMany } = useDecide();
  const [field, setField] = useState<ReviewField | ''>('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ items: ReviewItemData[]; total: number } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  // A bulk decision over more than CONFIRM_OVER elements asks for a second click on the same button.
  const [armed, setArmed] = useState<Bulk | null>(null);
  // A running job writes proposals as they arrive: the queue follows its progress.
  const jobKey = job ? `${job.jobId}:${job.done}:${job.state}` : '';
  // Progress and the change events of each written proposal arrive together: one throttled trigger for both.
  const followKey = useThrottled(`${docsVersion}|${jobKey}`, JOB_RELOAD_MS);

  useEffect(() => {
    let live = true;
    Promise.all([
      rl.invoke('review:list', { status: 'proposed', limit: PAGE, offset: page * PAGE, ...(field ? { fields: [field] } : {}) }),
      rl.invoke('review:stats', {}),
    ]).then(
      ([list, s]) => {
        if (!live) return;
        if (list.items.length === 0 && page > 0) return setPage(page - 1);
        setData(list);
        setStats(s);
        setError(null);
      },
      (e: unknown) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, [field, page, followKey, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const groups = useMemo(() => {
    const map = new Map<string, ReviewItemData[]>();
    for (const it of data?.items ?? []) map.set(it.docId, [...(map.get(it.docId) ?? []), it]);
    return [...map.values()];
  }, [data]);

  const bulk = async (decision: Bulk, only?: ReviewItemData[]) => {
    const list = only ?? data?.items ?? [];
    if (list.length === 0) return;
    setBusy(true);
    setArmed(null);
    await decideMany(
      list.map((i) => ({ docId: i.docId, field: i.field, metaDate: i.meta.date })),
      decision,
    );
    setBusy(false);
    reload();
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const rate = stats?.tags.rate;
  const n = data?.items.length ?? 0;
  const ask = (d: Bulk) => (n > CONFIRM_OVER && armed !== d ? setArmed(d) : void bulk(d));
  const bulkLabel = (d: Bulk) => (armed === d ? t('review.confirmMany', { count: n }) : t(d === 'accept' ? 'review.acceptAll' : 'review.rejectAll'));
  return (
    <div className='review' data-testid='review-view'>
      <div className='rh-bar'>
        <label htmlFor={filterId} className='sr-only'>
          {t('review.filter')}
        </label>
        <select
          id={filterId}
          value={field}
          onChange={(e) => {
            setField(e.target.value as ReviewField | '');
            setPage(0);
            setArmed(null);
          }}
          data-testid='review-filter'
        >
          <option value=''>{t('review.allFields')}</option>
          {FIELDS.map((f) => (
            <option key={f} value={f}>
              {t(`review.fields.${f}`)}
            </option>
          ))}
        </select>
        <span className='rh-rate' data-testid='review-rate'>
          {rate === null || rate === undefined ? t('review.rateNone') : t('review.rate', { percent: Math.round(rate * 100) })}
        </span>
        <span className='spacer' />
        <Button size='sm' disabled={busy || n === 0} onClick={() => ask('accept')} variant={armed === 'accept' ? 'primary' : 'secondary'} data-testid='review-accept-all'>
          {bulkLabel('accept')}
        </Button>
        <Button size='sm' disabled={busy || n === 0} onClick={() => ask('reject')} variant={armed === 'reject' ? 'primary' : 'secondary'} data-testid='review-reject-all'>
          {bulkLabel('reject')}
        </Button>
      </div>
      {error ? <ErrorNote testId='review-error'>{errorMessage(error, t)}</ErrorNote> : null}
      {data && data.items.length === 0 && (
        <EmptyState icon={<IconCheck size={24} />} title={t('review.emptyTitle')} className='rh-empty'>
          <span data-testid='review-empty'>{t('review.empty')}</span>
        </EmptyState>
      )}
      <ul className='review-groups' aria-label={t('review.listLabel')}>
        {groups.map((items) => {
          const first = items[0]!;
          return (
            <li key={first.docId} className='review-group' data-testid='review-group' data-doc-id={first.docId}>
              <header className='review-group-head'>
                <div className='rh-title'>
                  <p className='rh-name' data-testid='review-doc-title'>
                    {safeText(first.title?.trim() || first.path.split('/').pop() || first.path)}
                  </p>
                  <p className='hint'>{safeText(first.path)}</p>
                </div>
                <span data-testid='review-open-doc'>
                  <DocChip docId={first.docId} />
                </span>
                <Button size='sm' disabled={busy} onClick={() => void bulk('accept', items)} data-testid='review-accept-doc'>
                  {t('review.acceptDoc')}
                </Button>
              </header>
              <ul className='review-items'>
                {items.map((it) => (
                  <ReviewItemView key={`${it.field}:${it.revision}:${it.meta.date}`} item={it} onDone={reload} />
                ))}
              </ul>
              <AiMark meta={first.meta} />
            </li>
          );
        })}
      </ul>
      {data && data.total > PAGE && (
        <nav className='pager' aria-label={t('review.pages')}>
          <button type='button' disabled={page === 0} onClick={() => setPage(page - 1)} data-testid='review-page-prev'>
            {t('review.prev')}
          </button>
          <span data-testid='review-page'>{t('review.pageOf', { page: page + 1, pages })}</span>
          <button type='button' disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} data-testid='review-page-next'>
            {t('review.next')}
          </button>
        </nav>
      )}
    </div>
  );
}
