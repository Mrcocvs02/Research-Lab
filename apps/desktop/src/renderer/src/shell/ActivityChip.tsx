import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lazy, lazyView } from '../components/Lazy';
import { useAiUi } from '../lib/aiUi';
import { useCitationJob } from '../lib/citationJobs';
import { rl } from '../lib/rl';
import { useJobs } from '../lib/jobs';
import { scanText } from '../views/library/ScanStatusText';
import type { useScanStatus } from '../views/library/useScanStatus';
import { jobGroup, scanGroup, summarize, useGenericActivity } from './activityModel';
import { useHaikuActivity } from './useHaikuActivity';
import { useVocabPackNotice } from './useVocabPackNotice';

// The list of activities is only needed when the chip is clicked.
const ScanReport = lazyView(() => import('../views/library/ScanReport').then((m) => ({ default: m.ScanReport })), ['library']);
const ActivityPopover = lazyView(() => import('./ActivityPopover').then((m) => ({ default: m.ActivityPopover })), ['activity']);

/** The ring of the chip: full when idle, an arc of `value` (0..1) while a job reports progress, spinning when it does not. */
function Ring({ value }: { value: number | undefined }) {
  const v = value === undefined ? 0.28 : Math.min(1, Math.max(0, value));
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" className={value === undefined ? 'rl-ring rl-ring--spin' : 'rl-ring'} aria-hidden="true" focusable="false">
      <circle className="rl-ring__track" cx="8" cy="8" r="7" />
      <circle className="rl-ring__arc" cx="8" cy="8" r="7" strokeDasharray={`${44 * v} 44`} transform="rotate(-90 8 8)" />
    </svg>
  );
}

/** The short text of the chip (4.10): what is going on in a few words; the full sentence is the tooltip and the popover. Pure, so it is tested. */
export function shortScanText(scan: { state: string; phase?: string | undefined; processed: number; total?: number | undefined; seen?: number | undefined }, t: ReturnType<typeof useTranslation>['t']): string {
  if (scan.state === 'running') {
    const total = scan.phase === 'hashing' ? (scan.total as number | undefined) : scan.total;
    const done = scan.phase === 'hashing' ? (scan.seen ?? 0) : scan.processed;
    return total ? t('activity.chip.progress', { pct: Math.min(100, Math.round((done / total) * 100)) }) : t('activity.chip.scanning');
  }
  if (scan.state === 'failed') return t('activity.chip.failed');
  if (scan.state === 'cancelled') return t('activity.chip.cancelled');
  return t('activity.chip.ready');
}

const usdText = (usd: number) => (usd > 0 && usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`);

/**
 * The one chip of the top bar (D-358, 4.10): a ring and a short text for what is going on (scan, AI job, citations, any
 * other job), a red dot when something needs a look and a quiet dot when a result arrived that was not seen yet. A click
 * opens the popover. It keeps the `scan-status` test id and attributes of the old status bar.
 */
export function ActivityChip({ scan: scanApi }: { scan: ReturnType<typeof useScanStatus> }) {
  const { t } = useTranslation();
  const { activityOpen, setActivityOpen } = useAiUi();
  const { status: scan, start, cancel } = scanApi;
  const { job } = useJobs();
  const { job: citations } = useCitationJob();
  useHaikuActivity();
  useVocabPackNotice();
  const generic = useGenericActivity();
  const anchor = useRef<HTMLButtonElement>(null);
  const [unseen, setUnseen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const sum = useMemo(() => summarize({ scan, job, citation: citations, generic }), [scan, job, citations, generic]);

  // A result that arrives while the popover is closed leaves a quiet dot until it is opened.
  const before = useRef(new Map<string, string>());
  useEffect(() => {
    const now = new Map<string, string>();
    const scanning = scanGroup(scan);
    if (scanning) now.set('scan', scanning);
    if (job) now.set(`job:${job.jobId}`, jobGroup(job));
    if (citations) now.set(`cit:${citations.jobId}`, jobGroup(citations));
    for (const g of generic) now.set(`g:${g.id}`, g.group);
    for (const [k, g] of now) {
      if (before.current.get(k) !== 'running' || g === 'running') continue;
      // The first scan of a library is the library itself, not a result to look at (W17, as the badge of 'To review', 7.1).
      if (k === 'scan') void rl.invoke('scan:report', {}).then((r) => !r.firstScan && setUnseen(true), () => setUnseen(true));
      else setUnseen(true);
    }
    before.current = now;
  }, [scan, job, citations, generic]);
  useEffect(() => {
    if (activityOpen) setUnseen(false);
  }, [activityOpen]);

  // `full` is the tooltip and the accessible name; `text` is the short text the chip shows.
  let full: string;
  let text: string;
  if (sum.main === 'scan' && scan) (full = scanText(scan, t)), (text = shortScanText(scan, t));
  else if (sum.main === 'job' && job) (full = t('jobs.running', { done: job.done, total: job.total + job.skipped, usd: usdText(job.usd) })), (text = t('activity.chip.proposals', { done: job.done, total: job.total + job.skipped }));
  else if (sum.main === 'citations' && citations) (full = t('citations.job.running', { done: citations.done, total: citations.total })), (text = t('activity.chip.citations', { done: citations.done, total: citations.total }));
  else if (sum.main === 'other') text = full = generic.find((g) => g.group === 'running')?.text ?? '';
  else if (sum.attention > 0) text = full = t('activity.attention', { count: sum.attention });
  else if (scan) (full = scanText(scan, t)), (text = shortScanText(scan, t));
  else text = full = t('activity.idle');

  const tone = sum.running > 0 ? 'busy' : sum.attention > 0 ? 'bad' : 'ok';
  const extra = sum.running > 1 ? ` (+${sum.running - 1})` : '';
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="act-chip"
        data-tone={tone}
        data-testid="scan-status"
        {...(scan ? { 'data-state': scan.state } : {})}
        {...(scan?.phase ? { 'data-phase': scan.phase } : {})}
        aria-haspopup="dialog"
        aria-expanded={activityOpen}
        aria-label={`${t('activity.title')}: ${full}${extra}`}
        title={`${t('activity.title')}: ${full}${extra}`}
        onClick={() => setActivityOpen(!activityOpen)}
      >
        <Ring value={sum.running > 0 ? sum.progress : 1} />
        <span className="act-chip__text">{text + extra}</span>
        {(sum.attention > 0 || unseen) && <span className={sum.attention > 0 ? 'act-chip__dot act-chip__dot--bad' : 'act-chip__dot'} data-testid="activity-dot" aria-hidden="true" />}
      </button>
      {activityOpen && (
        <Lazy>
          <ActivityPopover anchor={anchor} onClose={() => setActivityOpen(false)} scan={scan} startScan={() => void start(false)} cancelScan={() => void cancel()} onReport={() => { setActivityOpen(false); setReportOpen(true); }} />
        </Lazy>
      )}
      {reportOpen && (
        <Lazy>
          <ScanReport onClose={() => setReportOpen(false)} />
        </Lazy>
      )}
    </>
  );
}
