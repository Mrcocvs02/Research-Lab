/**
 * Phase 8 placeholders: the contracts (`packages/core/src/ipc/channels/backup.ts`, `maintenance.ts`, D-255..D-258) are
 * in place and every channel answers NOT_IMPLEMENTED until `p8-main` replaces these handlers with the real ones
 * (`main/backup/`, `main/maintenance/`). Delete this file when that is done.
 */
import { AppError } from '@rl/core';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const notYet = (): never => {
  throw new AppError('NOT_IMPLEMENTED', 'Not available yet');
};

export const backupHandlers = (_s: MainServices): DomainHandlers<'backup'> => ({
  'backup:settings': notYet,
  'backup:chooseDestination': notYet,
  'backup:configure': notYet,
  'backup:preview': notYet,
  'backup:create': notYet,
  'backup:list': notYet,
  'backup:inspect': notYet,
  'backup:verify': notYet,
  'backup:restore': notYet,
  'backup:status': notYet,
  'backup:cancel': notYet,
  'backup:reveal': notYet,
  'backup:remove': notYet,
});

export const maintenanceHandlers = (_s: MainServices): DomainHandlers<'maintenance'> => ({
  'maintenance:report': notYet,
  'maintenance:clean': notYet,
  'maintenance:openLogs': notYet,
  'maintenance:copyDiagnostics': notYet,
});
