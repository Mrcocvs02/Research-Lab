/** Phase 6: contract in `packages/core/src/ipc/channels/graph.ts`. Stub until the main side is merged. */
import { AppError } from '@rl/core';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const todo = (): never => {
  throw new AppError('NOT_IMPLEMENTED', 'Not implemented yet');
};

export const graphHandlers = (_s: MainServices): DomainHandlers<'graph'> => ({
  'graph:status': todo,
  'graph:build': todo,
  'graph:cancel': todo,
  'graph:map': todo,
  'graph:similar': todo,
  'graph:surprising': todo,
  'graph:neighbors': todo,
  'graph:previewLabels': todo,
  'graph:labelClusters': todo,
});
