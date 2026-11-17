/** Phase 7: second-brain export (D-241). Contract in `packages/core/src/ipc/channels/export.ts`; the logic lives in `main/export/`. */
import { cancel, preview, reveal, run, status } from '../../export/service.js';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

export const exportHandlers = (s: MainServices): DomainHandlers<'export'> => ({
  'export:preview': (req) => preview(s, req),
  'export:run': (req) => run(s, req),
  'export:status': ({ jobId }) => status(s, jobId),
  'export:cancel': ({ jobId }) => cancel(s, jobId),
  'export:reveal': ({ jobId }) => reveal(s, jobId),
});
