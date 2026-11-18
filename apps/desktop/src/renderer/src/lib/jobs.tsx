import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Channels, ResponseOf } from '@rl/core';
import { useApp } from '../state/app-context';
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

export const live = (j: JobStatus) => j.state === 'queued' || j.state === 'running';

/** Follows `jobs:progress` for the Activity chip and popover (`shell/ActivityPopover.tsx`; the dialog and the review load on demand). */
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
