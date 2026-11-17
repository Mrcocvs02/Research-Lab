/** Phase 5: contract in `packages/core/src/ipc/channels/citations.ts`. Stub until the main side is merged. */
import { AppError } from '@rl/core';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const todo = (): never => {
  throw new AppError('NOT_IMPLEMENTED', 'Not implemented yet');
};

export const citationsHandlers = (_s: MainServices): DomainHandlers<'citations'> => ({
  'citations:get': todo,
  'citations:refresh': todo,
  'citations:refreshMany': todo,
  'citations:cancel': todo,
});
