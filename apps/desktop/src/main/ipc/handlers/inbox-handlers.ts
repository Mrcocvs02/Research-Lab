/**
 * Phase 4, wave 4.2: contract in `packages/core/src/ipc/channels/inbox.ts`. Stub until the main side is merged.
 */
import { AppError } from '@rl/core';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const todo = (): never => {
  throw new AppError('NOT_IMPLEMENTED', 'Not implemented yet');
};

export const inboxHandlers = (_s: MainServices): DomainHandlers<'inbox'> => ({
  'inbox:list': todo,
  'inbox:add': todo,
  'inbox:choose': todo,
  'inbox:lookup': todo,
  'inbox:previewTags': todo,
  'inbox:proposeTags': todo,
  'inbox:confirm': todo,
  'inbox:dismiss': todo,
});
