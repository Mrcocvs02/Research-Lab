/**
 * Bulk AI jobs (phase 4, wave 4.2): contract in `packages/core/src/ipc/channels/jobs.ts`, logic in `main/ai/jobs.ts`.
 */
import { cancelJob, estimateJob, listJobs, restartJob, startJob } from '../../ai/jobs.js';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

export const jobsHandlers = (s: MainServices): DomainHandlers<'jobs'> => ({
  'jobs:estimate': (req) => estimateJob(s, req),
  'jobs:start': (req) => startJob(s, req),
  'jobs:restart': ({ jobId }) => restartJob(s, jobId),
  'jobs:taxonomy': async (req) => (await import('../../analysis/taxonomy-job.js')).runTaxonomyJob(s, req),
  'jobs:cancel': async ({ jobId }) => ({ cancelled: cancelJob(jobId) }),
  'jobs:list': async () => ({ items: listJobs() }),
});
