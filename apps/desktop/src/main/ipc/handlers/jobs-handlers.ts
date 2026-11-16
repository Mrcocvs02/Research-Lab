/**
 * Phase 4, wave 4.2: contract in `packages/core/src/ipc/channels/jobs.ts`. Stub until the main side is merged.
 */
import { AppError } from '@rl/core';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const todo = (): never => {
  throw new AppError('NOT_IMPLEMENTED', 'Not implemented yet');
};

export const jobsHandlers = (_s: MainServices): DomainHandlers<'jobs'> => ({
  'jobs:estimate': todo,
  'jobs:start': todo,
  'jobs:cancel': todo,
  'jobs:list': todo,
});
