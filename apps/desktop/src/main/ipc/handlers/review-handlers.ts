/**
 * Phase 4, wave 4.2: contract in `packages/core/src/ipc/channels/review.ts`. Stub until the main side is merged.
 */
import { AppError } from '@rl/core';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const todo = (): never => {
  throw new AppError('NOT_IMPLEMENTED', 'Not implemented yet');
};

export const reviewHandlers = (_s: MainServices): DomainHandlers<'review'> => ({
  'review:list': todo,
  'review:decide': todo,
  'review:decideMany': todo,
  'review:stats': todo,
});
