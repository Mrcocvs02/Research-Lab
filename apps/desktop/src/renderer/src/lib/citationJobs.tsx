import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { EventPayload, Events } from '@rl/core';
import { useApp } from '../state/app-context';
import { useNotify } from './notify';
import { rl } from './rl';

export type CitationJob = EventPayload<Events, 'citations:progress'>;

interface Value {
  /** The citation refresh of this session (the newest), or null. */
  job: CitationJob | null;
  /** A refresh is running or queued: a new one is refused until it ends (the older one could not be followed or cancelled). */
  busy: boolean;
  /** Moves when a refresh ends (the stored citations changed). */
  version: number;
  /** Starts a background refresh of these documents (the network is used from here on, never before). */
  start(docIds: readonly string[]): Promise<boolean>;
  cancel(): Promise<void>;
  dismiss(): void;
}
const NONE: Value = { job: null, busy: false, version: 0, start: async () => false, cancel: async () => {}, dismiss() {} };
const Ctx = createContext<Value>(NONE);
export const useCitationJob = () => useContext(Ctx);

/** `citations:refreshMany` accepts at most this many documents (`CITATION_LIMITS.refreshMany`; a test keeps the two equal). */
export const REFRESH_MANY_MAX = 2000;

const live = (j: CitationJob) => j.state === 'queued' || j.state === 'running';

/**
 * Follows `citations:progress` for the status bar indicator. Nothing is fetched here: a job exists only after the user
 * asked for one, and the event is ignored until then (a job of an earlier session is not shown).
 */
export function CitationJobsProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { activeLibraryId } = useApp();
  const { info, fail, reportError } = useNotify();
  const [job, setJob] = useState<CitationJob | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const jobId = useRef<string | null>(null);
  // Events of jobs we do not follow (yet): `refreshMany` may answer after its first event.
  const seen = useRef(new Map<string, CitationJob>());
  // Set while the request that starts a job is in flight, and while the job lives.
  const starting = useRef(false);
  const liveJob = useRef(false);
  liveJob.current = job !== null && live(job);

  useEffect(() => {
    setJob(null);
    jobId.current = null;
    seen.current.clear();
    if (!activeLibraryId) return;
    return rl.on('citations:progress', (s) => {
      if (seen.current.size > 8) seen.current.clear();
      seen.current.set(s.jobId, s);
      if (jobId.current === s.jobId) setJob(s);
    });
  }, [activeLibraryId]);

  // Counts the jobs that ended: views that show stored citations reload when it moves.
  const [version, setVersion] = useState(0);
  const ended = job && !live(job) ? job.jobId : null;
  useEffect(() => {
    if (ended) setVersion((v) => v + 1);
  }, [ended]);

  const start = useCallback(
    async (docIds: readonly string[]) => {
      if (starting.current || liveJob.current) {
        info(t('citations.alreadyRunning'));
        return false;
      }
      if (docIds.length > REFRESH_MANY_MAX) {
        fail(t('citations.tooMany', { limit: REFRESH_MANY_MAX, n: docIds.length }));
        return false;
      }
      starting.current = true;
      try {
        const r = await rl.invoke('citations:refreshMany', { docIds: [...docIds] });
        jobId.current = r.jobId;
        setJob(seen.current.get(r.jobId) ?? null);
        setDismissed(null);
        info(t('citations.started'));
        return true;
      } catch (e) {
        reportError(e);
        return false;
      } finally {
        starting.current = false;
      }
    },
    [fail, info, reportError, t],
  );
  const cancel = useCallback(async () => {
    if (!jobId.current) return;
    try {
      await rl.invoke('citations:cancel', { jobId: jobId.current });
    } catch (e) {
      reportError(e);
    }
  }, [reportError]);
  const dismiss = useCallback(() => setDismissed(jobId.current), []);
  const shown = job && job.jobId !== dismissed ? job : null;
  const busy = job !== null && live(job);
  const value = useMemo(() => ({ job: shown, busy, version, start, cancel, dismiss }), [shown, busy, version, start, cancel, dismiss]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Status bar piece: progress of the running citation refresh, cancel, and hide when it ends. */
export function CitationIndicator() {
  const { t } = useTranslation();
  const { job, cancel, dismiss } = useCitationJob();
  if (!job) return null;
  const running = live(job);
  const text = running
    ? t('citations.job.running', { done: job.done, total: job.total })
    : t(`citations.job.ended_${job.state}`, { done: job.done, total: job.total, failed: job.failed, skipped: job.skipped, notFound: job.notFound });
  return (
    <span className="job-indicator" data-testid="citations-indicator" data-state={job.state} role="status" aria-label={t('citations.job.label')}>
      <span data-testid="citations-text">{text}</span>
      {job.state === 'failed' && job.error && <span data-testid="citations-error">{t(`errors.${job.error.code}`, { defaultValue: t('errors.INTERNAL') })}</span>}
      {running ? (
        <button type="button" className="link" onClick={() => void cancel()} data-testid="citations-cancel">
          {t('citations.job.cancel')}
        </button>
      ) : (
        <button type="button" className="link" onClick={dismiss} data-testid="citations-dismiss">
          {t('citations.job.dismiss')}
        </button>
      )}
    </span>
  );
}
