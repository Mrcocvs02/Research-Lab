/** Phase 8: backup and restore (D-255, D-256) and maintenance (D-258). Contracts in `ipc/channels/backup.ts` and `maintenance.ts`; the logic lives in `main/backup/` and `main/maintenance/`. */
import * as backup from '../../backup/service.js';
import * as maintenance from '../../maintenance/service.js';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

export const backupHandlers = (s: MainServices): DomainHandlers<'backup'> => ({
  'backup:settings': () => backup.getSettings(s),
  'backup:chooseDestination': () => backup.chooseDestination(s),
  'backup:configure': (req) => backup.configure(s, req),
  'backup:preview': (req) => backup.preview(s, req),
  'backup:create': (req) => backup.create(s, req),
  'backup:list': () => backup.list(s),
  'backup:inspect': (req) => backup.inspect(s, req),
  'backup:verify': (req) => backup.verify(s, req),
  'backup:restore': (req) => backup.restore(s, req),
  'backup:status': ({ jobId }) => backup.status(s, jobId),
  'backup:cancel': ({ jobId }) => backup.cancel(s, jobId),
  'backup:reveal': (req) => backup.reveal(s, req),
  'backup:remove': (req) => backup.remove(s, req),
});

export const maintenanceHandlers = (s: MainServices): DomainHandlers<'maintenance'> => ({
  'maintenance:report': (req) => maintenance.report(s, req),
  'maintenance:clean': (req) => maintenance.clean(s, req),
  'maintenance:openLogs': () => maintenance.openLogs(s),
  'maintenance:copyDiagnostics': () => maintenance.diagnostics(s),
});
