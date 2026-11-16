/**
 * Phase 3 (study): the in-app reader, notes per file and per page, PDF annotations.
 * Contracts: `packages/core/src/ipc/channels/{reader,notes,annotations}.ts`. Until a domain is implemented its
 * channels answer NOT_IMPLEMENTED.
 */
import { AppError } from '@rl/core';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const notYet = (channel: string) => () => {
  throw new AppError('NOT_IMPLEMENTED', `${channel} is not implemented yet`);
};

export const readerHandlers = (_s: MainServices): DomainHandlers<'reader'> => ({
  'reader:open': notYet('reader:open'),
  'reader:openLink': notYet('reader:openLink'),
});

export const notesHandlers = (_s: MainServices): DomainHandlers<'notes'> => ({
  'notes:get': notYet('notes:get'),
  'notes:list': notYet('notes:list'),
  'notes:save': notYet('notes:save'),
});

export const annotationsHandlers = (_s: MainServices): DomainHandlers<'annotations'> => ({
  'annotations:list': notYet('annotations:list'),
  'annotations:save': notYet('annotations:save'),
  'annotations:remove': notYet('annotations:remove'),
});
