/** Phase 7: contract in `packages/core/src/ipc/channels/export.ts`. Stub until the main side is merged. */
import { AppError } from '@rl/core';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const todo = (): never => {
  throw new AppError('NOT_IMPLEMENTED', 'Not implemented yet');
};

export const exportHandlers = (_s: MainServices): DomainHandlers<'export'> => ({
  'export:preview': todo,
  'export:run': todo,
  'export:status': todo,
  'export:cancel': todo,
  'export:reveal': todo,
});
