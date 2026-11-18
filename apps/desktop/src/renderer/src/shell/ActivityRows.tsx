import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import '../components/controls.css';
import { useAiUi } from '../lib/aiUi';
import { live as citationLive, useCitationJob } from '../lib/citationJobs';
import { live as jobLive, useJobs } from '../lib/jobs';
import { ProgressRing } from '../components/Progress';
import { jobGroup, type ActivityGroup } from './activityModel';
import { Icon } from './shellIcons';

/** One line of the Activity popover: a status icon, the text (and a second line), then the action(s). */
export function ActivityRow({ group, children, actions, testId, state, label }: { group: ActivityGroup; children: ReactNode; actions?: ReactNode; testId?: string | undefined; state?: string | undefined; label?: string | undefined }) {
  return (
    <li className="act-row" data-group={group} {...(testId ? { 'data-testid': testId } : {})} {...(state ? { 'data-state': state } : {})} role="status" {...(label ? { 'aria-label': label } : {})}>
      <span className="act-row__icon" data-tone={group}>
        {group === 'running' ? <ProgressRing /> : group === 'attention' ? <Icon name="alert" size={16} /> : <Icon name="check" size={16} />}
      </span>
      <div className="act-row__body">{children}</div>
      {actions && <div className="act-row__actions">{actions}</div>}
    </li>
  );
}

/** The row of the Activity popover for the AI proposals job: progress, cancel, then Review and Hide when it ends. */
export function JobIndicator() {
  const { t } = useTranslation();
  const { job, cancel, dismiss } = useJobs();
  const { openReview, setActivityOpen } = useAiUi();
  if (!job) return null;
  const running = jobLive(job);
  const usd = job.usd > 0 && job.usd < 0.01 ? '<$0.01' : `$${job.usd.toFixed(2)}`;
  const total = job.total + job.skipped;
  const text = running ? t('jobs.running', { done: job.done, total, usd }) : t(`jobs.ended_${job.state}`, { done: job.done, total, failed: job.failed, usd });
  const btn = 'rl-btn rl-btn--sm';
  return (
    <ActivityRow
      group={jobGroup(job)}
      testId="job-indicator"
      state={job.state}
      label={t('jobs.label')}
      actions={
        running ? (
          <button type="button" className={`${btn} rl-btn--ghost`} onClick={() => void cancel()} data-testid="job-cancel">
            {t('jobs.cancel')}
          </button>
        ) : (
          <>
            {job.done > job.failed && (
              <button
                type="button"
                className={`${btn} rl-btn--secondary`}
                onClick={() => {
                  setActivityOpen(false);
                  openReview();
                }}
                data-testid="job-review"
              >
                {t('jobs.review')}
              </button>
            )}
            <button type="button" className={`${btn} rl-btn--ghost`} onClick={dismiss} data-testid="job-dismiss">
              {t('jobs.dismiss')}
            </button>
          </>
        )
      }
    >
      <span data-testid="job-text">{text}</span>
      {job.state === 'failed' && job.error && (
        <span className="act-row__detail" data-testid="job-error">
          {t(`errors.${job.error.code}`, { defaultValue: t('errors.INTERNAL') })}
        </span>
      )}
    </ActivityRow>
  );
}

/** The row of the Activity popover for the citation refresh: progress, cancel, hide when it ends. */
export function CitationIndicator() {
  const { t } = useTranslation();
  const { job, cancel, dismiss } = useCitationJob();
  if (!job) return null;
  const running = citationLive(job);
  const text = running
    ? t('citations.job.running', { done: job.done, total: job.total })
    : t(`citations.job.ended_${job.state}`, { done: job.done, total: job.total, failed: job.failed, skipped: job.skipped, notFound: job.notFound });
  return (
    <ActivityRow
      group={jobGroup(job)}
      testId="citations-indicator"
      state={job.state}
      label={t('citations.job.label')}
      actions={
        running ? (
          <button type="button" className="rl-btn rl-btn--sm rl-btn--ghost" onClick={() => void cancel()} data-testid="citations-cancel">
            {t('citations.job.cancel')}
          </button>
        ) : (
          <button type="button" className="rl-btn rl-btn--sm rl-btn--ghost" onClick={dismiss} data-testid="citations-dismiss">
            {t('citations.job.dismiss')}
          </button>
        )
      }
    >
      <span data-testid="citations-text">{text}</span>
      {job.state === 'failed' && job.error && (
        <span className="act-row__detail" data-testid="citations-error">
          {t(`errors.${job.error.code}`, { defaultValue: t('errors.INTERNAL') })}
        </span>
      )}
    </ActivityRow>
  );
}
