/** Phase 6: contract in `packages/core/src/ipc/channels/graph.ts`. Stub until the main side is merged. */
import { AppError } from '@rl/core';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const todo = (): never => {
  throw new AppError('NOT_IMPLEMENTED', 'Not implemented yet');
};

export const exploreHandlers = (_s: MainServices): DomainHandlers<'explore'> => ({
  'explore:level': todo,
  'explore:documents': todo,
  'explore:related': todo,
});
