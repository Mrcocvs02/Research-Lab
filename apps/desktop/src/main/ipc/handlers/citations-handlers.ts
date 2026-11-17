/** Citations (phase 5): contract in `packages/core/src/ipc/channels/citations.ts`, logic in `main/citations/`. */
import type { DocumentId } from '@rl/core';
import { cancelCitationJob, citationView, refreshCitations, startRefreshMany } from '../../citations/refresh.js';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

export const citationsHandlers = (s: MainServices): DomainHandlers<'citations'> => ({
  'citations:get': async ({ docId }) => citationView(await s.runtime.require(), docId as DocumentId),
  'citations:refresh': ({ docId, what }) => refreshCitations(s, docId as DocumentId, what),
  'citations:refreshMany': ({ docIds }) => startRefreshMany(s, docIds as DocumentId[]),
  'citations:cancel': async ({ jobId }) => ({ cancelled: cancelCitationJob(jobId, s) }),
});
