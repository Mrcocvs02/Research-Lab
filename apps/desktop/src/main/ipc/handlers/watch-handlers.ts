/** Phase 5: contract in `packages/core/src/ipc/channels/watch.ts`. Stub until the main side is merged. */
import { AppError } from '@rl/core';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const todo = (): never => {
  throw new AppError('NOT_IMPLEMENTED', 'Not implemented yet');
};

export const watchHandlers = (_s: MainServices): DomainHandlers<'watch'> => ({
  'watch:list': todo,
  'watch:saveSource': todo,
  'watch:removeSource': todo,
  'watch:check': todo,
  'watch:items': todo,
  'watch:dismiss': todo,
  'watch:checkPublished': todo,
  'watch:applyPublished': todo,
});
