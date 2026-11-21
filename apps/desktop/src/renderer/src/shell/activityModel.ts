import { useSyncExternalStore } from 'react';

/**
 * What the Activity chip and popover show (design 4.10, 7.4), as plain data so that it is tested without a window: every
 * source (the scan, the AI job, the citation refresh, and any other job through `publishActivity`) lands in one of three
 * groups. Nothing is polled: the sources are the providers that already follow the events.
 */
export type ActivityGroup = 'running' | 'attention' | 'recent';

/** A job another part of the app wants listed (a backup, the annotation check of the PDFs, an export...). */
export interface GenericActivity {
  id: string;
  group: ActivityGroup;
  text: string;
  detail?: string;
  /** 0..1 when known. */
  progress?: number;
  action?: { label: string; run(): void };
  /** A second action next to `action` (the Undo of the field vocabulary notice). */
  alt?: { label: string; run(): void };
  /** Shown as a small x when present; removes the row. */
  dismiss?: () => void;
}

const rows = new Map<string, readonly GenericActivity[]>();
const listeners = new Set<() => void>();
let snapshot: readonly GenericActivity[] = [];

/** Replaces the rows of one source (pass [] to clear it). The popover lists them with the built-in ones; the chip counts them. */
export function publishActivity(source: string, items: readonly GenericActivity[]): void {
  if (items.length === 0) rows.delete(source);
  else rows.set(source, items);
  snapshot = [...rows.values()].flat();
  for (const l of listeners) l();
}

export function useGenericActivity(): readonly GenericActivity[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}

interface JobLike {
  state: string;
  done: number;
  failed: number;
}

/** A job that is queued or running is in progress; one that failed, or ended with failures, needs a look; the rest is a result. */
export function jobGroup(j: JobLike): ActivityGroup {
  if (j.state === 'queued' || j.state === 'running') return 'running';
  if (j.state === 'failed' || (j.state === 'done' && j.failed > 0)) return 'attention';
  return 'recent';
}

export const scanGroup = (s: { state: string } | null): ActivityGroup | null => (!s ? null : s.state === 'running' ? 'running' : s.state === 'failed' ? 'attention' : s.state === 'idle' ? null : 'recent');

export interface ActivityInput {
  scan: { state: string; phase?: string | undefined; processed: number; total?: number | undefined } | null;
  job: JobLike | null;
  citation: JobLike | null;
  generic: readonly GenericActivity[];
}

export interface ActivitySummary {
  running: number;
  attention: number;
  /** 0..1 of the scan or of the first generic job with a known progress; undefined when none is known. */
  progress: number | undefined;
  /** What the chip names: the thing in progress (`scan`, `job`, `citations`, `other`), or none. */
  main: 'scan' | 'job' | 'citations' | 'other' | null;
}

export function summarize(i: ActivityInput): ActivitySummary {
  const groups: Array<[NonNullable<ActivitySummary['main']>, ActivityGroup | null]> = [
    ['scan', scanGroup(i.scan)],
    ['job', i.job ? jobGroup(i.job) : null],
    ['citations', i.citation ? jobGroup(i.citation) : null],
  ];
  for (const g of i.generic) groups.push(['other', g.group]);
  const running = groups.filter(([, g]) => g === 'running');
  const attention = groups.filter(([, g]) => g === 'attention').length;
  const scanning = i.scan?.state === 'running';
  const knownGeneric = i.generic.find((g) => g.group === 'running' && g.progress !== undefined)?.progress;
  const progress = scanning && i.scan?.total ? Math.min(1, i.scan.processed / i.scan.total) : !scanning ? knownGeneric : undefined;
  return { running: running.length, attention, progress, main: running[0]?.[0] ?? null };
}

/** Rows of a group shown before "Show all". */
export const RECENT_LIMIT = 5;
