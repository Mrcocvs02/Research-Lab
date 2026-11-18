import { useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScanStatus } from '@rl/core';
import { Button } from '../components/Button';
import { Popover } from '../components/Popover';
import { ProgressBar } from '../components/Progress';
import { useCitationJob } from '../lib/citationJobs';
import { useJobs } from '../lib/jobs';
import { scanText } from '../views/library/ScanStatusText';
import { RECENT_LIMIT, jobGroup, scanGroup, useGenericActivity, type ActivityGroup, type GenericActivity } from './activityModel';
import { ActivityRow, CitationIndicator, JobIndicator } from './ActivityRows';

interface Props {
  anchor: RefObject<HTMLElement | null>;
  onClose(): void;
  scan: ScanStatus | null;
  startScan(): void;
  cancelScan(): void;
  /** Opens the report of the last scan (4.9): the chip hosts the dialog, so that the popover can close. */
  onReport(): void;
}

/**
 * The Activity popover (4.10): three fixed groups (in progress, to look at, recent), each row with its action, and under them
 * the outcome of the last scan with "Scan now". Every source is a provider that already follows its events; nothing is polled.
 * Other jobs appear through `publishActivity`.
 */
export function ActivityPopover({ anchor, onClose, scan, startScan, cancelScan, onReport }: Props) {
  const { t, i18n } = useTranslation();
  const jobs = useJobs();
  const cit = useCitationJob();
  const generic = useGenericActivity();
  const [all, setAll] = useState(false);

  const rows: Record<ActivityGroup, ReactNode[]> = { running: [], attention: [], recent: [] };
  const sg = scanGroup(scan);
  if (scan && sg === 'running') {
    const v = scan.total ? Math.min(1, scan.processed / scan.total) : undefined;
    rows.running.push(
      <ActivityRow key="scan" group="running" actions={<Button size="sm" variant="ghost" onClick={cancelScan}>{t('scan.cancel')}</Button>}>
        <span>{t('activity.scan')}</span>
        <span className="act-row__detail">{scanText(scan, t)}</span>
        <ProgressBar value={v} label={t('scan.label')} />
      </ActivityRow>,
    );
  } else if (scan && sg === 'attention') {
    rows.attention.push(
      <ActivityRow key="scan" group="attention" actions={<Button size="sm" onClick={startScan}>{t('activity.retry')}</Button>}>
        <span>{t('scan.failed')}</span>
      </ActivityRow>,
    );
  }

  if (jobs.job) rows[jobGroup(jobs.job)].push(<JobIndicator key="job" />);
  if (cit.job) rows[jobGroup(cit.job)].push(<CitationIndicator key="citations" />);

  for (const g of generic as readonly GenericActivity[]) {
    rows[g.group].push(
      <ActivityRow
        key={`g:${g.id}`}
        group={g.group}
        testId="activity-row"
        actions={
          <>
            {g.action && <Button size="sm" onClick={g.action.run}>{g.action.label}</Button>}
            {g.dismiss && <Button size="sm" variant="ghost" onClick={g.dismiss}>{t('jobs.dismiss')}</Button>}
          </>
        }
      >
        <span>{g.text}</span>
        {g.detail && <span className="act-row__detail">{g.detail}</span>}
        {g.group === 'running' && <ProgressBar value={g.progress} label={g.text} />}
      </ActivityRow>,
    );
  }

  const groups: Array<[ActivityGroup, string]> = [
    ['running', t('activity.running')],
    ['attention', t('activity.attention_title')],
    ['recent', t('activity.recent')],
  ];
  const empty = groups.every(([g]) => rows[g].length === 0);
  const finished = scan?.finishedAt ? new Date(scan.finishedAt) : null;
  const when = finished && !Number.isNaN(finished.getTime()) ? finished.toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }) : null;
  const s = scan?.summary;
  const scanning = scan?.state === 'running';

  return (
    <Popover anchor={anchor} open onClose={onClose} label={t('activity.title')} placement="bottom-end" width={400} className="act-popover">
      <div data-testid="activity-popover">
        <h2 className="act-title">{t('activity.title')}</h2>
        {empty && <p className="act-empty">{t('activity.none')}</p>}
        {groups.map(([g, label]) => {
          if (rows[g].length === 0) return null;
          const list = g === 'recent' && !all ? rows[g].slice(0, RECENT_LIMIT) : rows[g];
          return (
            <section key={g} aria-label={label} data-group={g}>
              <h3 className="act-group">{label}</h3>
              <ul className="act-list">{list}</ul>
              {g === 'recent' && !all && rows[g].length > RECENT_LIMIT && (
                <Button size="sm" variant="ghost" onClick={() => setAll(true)}>{t('activity.showAll')}</Button>
              )}
            </section>
          );
        })}
        <div className="act-foot" data-testid="activity-scan">
          {when ? <b>{t('activity.lastScan', { when })}</b> : <b>{t('activity.noScan')}</b>}
          {s && <span className="act-row__detail">{t('activity.scanSummary', { added: s.added, changed: s.changed, missing: s.missing })}</span>}
          <div className="act-foot__actions">
            {s && (
              <Button size="sm" variant="ghost" onClick={onReport} data-testid="activity-scan-report">
                {t('activity.seeReport')}
              </Button>
            )}
            <Button size="sm" variant="primary" disabled={scanning || !scan} disabledReason={scanning ? t('activity.scanRunning') : t('activity.needsLibrary')} onClick={startScan} data-testid="activity-scan-now">
              {t('scan.start')}
            </Button>
          </div>
        </div>
      </div>
    </Popover>
  );
}
