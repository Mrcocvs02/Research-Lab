import { useCallback } from 'react';
import { REFRESH_MANY_MAX, useCitationJob } from '../../lib/citationJobs';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';

/**
 * "Refresh citations" for the whole library, from the Discover menu and from its empty states: the ids of every document (up to what
 * one refresh accepts) go to the background job, which is the only place the network is used.
 */
export function useRefreshCitations(): { busy: boolean; start(): Promise<void> } {
  const job = useCitationJob();
  const { reportError } = useNotify();
  const { start: startJob } = job;
  const start = useCallback(async () => {
    try {
      const { ids } = await rl.invoke('documents:ids', {});
      if (ids.length > 0) await startJob(ids.slice(0, REFRESH_MANY_MAX));
    } catch (e) {
      reportError(e);
    }
  }, [startJob, reportError]);
  return { busy: job.busy, start };
}
