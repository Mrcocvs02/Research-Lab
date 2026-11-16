import { AppError } from '@rl/core';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const notYet = async (): Promise<never> => {
  throw new AppError('NOT_IMPLEMENTED', 'Not implemented yet');
};

/** Contract-only placeholders (replaced by the real handlers in the next commit). */
export const taxonomyHandlers = (_s: MainServices): DomainHandlers<'taxonomy'> => ({ 'taxonomy:get': notYet, 'taxonomy:apply': notYet });
export const historyHandlers = (_s: MainServices): DomainHandlers<'history'> => ({ 'history:list': notYet, 'history:undo': notYet, 'history:redo': notYet });
export const projectsHandlers = (_s: MainServices): DomainHandlers<'projects'> => ({
  'projects:list': notYet,
  'projects:get': notYet,
  'projects:create': notYet,
  'projects:update': notYet,
  'projects:delete': notYet,
  'projects:restore': notYet,
  'projects:addMembers': notYet,
  'projects:removeMembers': notYet,
  'projects:setReadingPlan': notYet,
});
export const organizeDocumentsHandlers = (_s: MainServices) => ({
  'documents:update': notYet,
  'documents:tag': notYet,
  'documents:open': notYet,
  'documents:reveal': notYet,
  'library:tree': notYet,
});
