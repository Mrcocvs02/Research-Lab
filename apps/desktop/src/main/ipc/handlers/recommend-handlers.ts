/** Phase 5: contract in `packages/core/src/ipc/channels/citations.ts`. Stub until the main side is merged. */
import { AppError } from '@rl/core';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const todo = (): never => {
  throw new AppError('NOT_IMPLEMENTED', 'Not implemented yet');
};

export const recommendHandlers = (_s: MainServices): DomainHandlers<'recommend'> => ({
  'recommend:readNext': todo,
  'recommend:dismiss': todo,
});
