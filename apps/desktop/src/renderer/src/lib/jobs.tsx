import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { useApp } from '../state/app-context';
import { useAiUi } from './aiUi';
import { useNotify } from './notify';
import { rl } from './rl';

export type JobStatus = ResponseOf<Channels, 'jobs:list'>['items'][number];

interface JobsValue {
  /** The newest job of this session that was not dismissed, or null. */
  job: JobStatus | null;
  refresh(): Promise<void>;
  cancel(): Promise<void>;
  dismiss(): void;
}
const NONE: JobsValue = { job: null, refresh: async () => {}, cancel: async () => {}, dismiss() {} };
const Ctx = createContext<JobsValue>(NONE);
export const useJobs = () => useContext(Ctx);

const live = (j: JobStatus) => j.state === 'queued' || j.state === 'running';

/** Follows `jobs:progress` for the status bar indicator (the dialog and the review are loaded on demand). */
export function JobsProvider({ children }: { children: ReactNode }) {
  const { activeLibraryId } = useApp();
  const { reportError } = useNotify();
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setJobs((await rl.invoke('jobs:list', {})).items);
    } catch {
      /* the indicator simply stays hidden */
    }
  }, []);

  useEffect(() => {
    setJobs([]);
    if (!activeLibraryId) return;
    void refresh();
    return rl.on('jobs:progress', (s) => setJobs((cur) => [s, ...cur.filter((j) => j.jobId !== s.jobId)]));
  }, [activeLibraryId, refresh]);

  const newest = jobs[0] ?? null;
  const job = newest && newest.jobId !== dismissed ? newest : null;
  const cancel = useCallback(async () => {
    if (!newest) return;
    try {
      await rl.invoke('jobs:cancel', { jobId: newest.jobId });
    } catch (e) {
      reportError(e);
    }
  }, [newest, reportError]);
  const dismiss = useCallback(() => setDismissed(newest?.jobId ?? null), [newest]);
  const value = useMemo(() => ({ job, refresh, cancel, dismiss }), [job, refresh, cancel, dismiss]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Status bar piece: progress of the running AI job, cancel, and a link to the review when it ends. */
export function JobIndicator() {
  const { t } = useTranslation();
  const { job, cancel, dismiss } = useJobs();
  const { openReview } = useAiUi();
  if (!job) return null;
  const running = live(job);
  const usd = job.usd > 0 && job.usd < 0.01 ? '<$0.01' : `$${job.usd.toFixed(2)}`;
  const total = job.total + job.skipped;
  const text = running ? t('jobs.running', { done: job.done, total, usd }) : t(`jobs.ended_${job.state}`, { done: job.done, total, failed: job.failed, usd });
  return (
    <span className="job-indicator" data-testid="job-indicator" data-state={job.state} role="status" aria-label={t('jobs.label')}>
      <span data-testid="job-text">{text}</span>
      {job.state === 'failed' && job.error && <span data-testid="job-error">{t(`errors.${job.error.code}`, { defaultValue: t('errors.INTERNAL') })}</span>}
      {running ? (
        <button type="button" className="link" onClick={() => void cancel()} data-testid="job-cancel">
          {t('jobs.cancel')}
        </button>
      ) : (
        <>
          {job.done > job.failed && (
            <button type="button" className="link" onClick={openReview} data-testid="job-review">
              {t('jobs.review')}
            </button>
          )}
          <button type="button" className="link" onClick={dismiss} data-testid="job-dismiss">
            {t('jobs.dismiss')}
          </button>
        </>
      )}
    </span>
  );
}
