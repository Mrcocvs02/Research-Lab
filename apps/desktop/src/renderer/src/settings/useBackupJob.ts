import { useCallback, useEffect, useState } from 'react';
import type { BackupJobStatus } from '@rl/core';
import { rl } from '../lib/rl';

export const TERMINAL_STATES = new Set(['done', 'cancelled', 'failed']);

interface Job {
  id: string;
  status: BackupJobStatus | null;
}

/**
 * One backup job (create, verify or restore) at a time, like the export dialog: `start` takes the call that returns the
 * `jobId`; progress comes from `backup:progress`, plus one read of `backup:status` in case the job ended before the
 * listener was in place. `cancel` asks main to stop (nothing partial is left); `reset` forgets a finished job.
 */
export function useBackupJob() {
  const [job, setJob] = useState<Job | null>(null);
  const jobId = job?.id;

  useEffect(() => {
    if (!jobId) return;
    let live = true;
    const apply = (s: BackupJobStatus) => live && s.jobId === jobId && setJob((cur) => (cur && cur.id === jobId ? { id: jobId, status: s } : cur));
    const off = rl.on('backup:progress', apply);
    rl.invoke('backup:status', { jobId }).then(apply, () => {});
    return () => {
      live = false;
      off();
    };
  }, [jobId]);

  const start = useCallback(async (call: () => Promise<{ jobId: string }>) => {
    const { jobId: id } = await call();
    setJob({ id, status: null });
    return id;
  }, []);
  const cancel = useCallback(() => {
    if (jobId) void rl.invoke('backup:cancel', { jobId }).catch(() => {});
  }, [jobId]);
  const reset = useCallback(() => setJob(null), []);

  const status = job?.status ?? null;
  const running = job !== null && (status === null || status.state === 'running');
  return { job, jobId, status, running, finished: status !== null && TERMINAL_STATES.has(status.state), start, cancel, reset };
}
