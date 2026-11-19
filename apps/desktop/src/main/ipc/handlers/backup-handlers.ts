/** The logic is loaded on the first call. Phase 8: backup and restore (D-255, D-256) and maintenance (D-258). Contracts in `ipc/channels/backup.ts` and `maintenance.ts`; the logic lives in `main/backup/` and `main/maintenance/`. */
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const backupMod = () => import('../../backup/service.js');
const maintenanceMod = () => import('../../maintenance/service.js');

export const backupHandlers = (s: MainServices): DomainHandlers<'backup'> => ({
  'backup:settings': async () => (await backupMod()).getSettings(s),
  'backup:chooseDestination': async () => (await backupMod()).chooseDestination(s),
  'backup:configure': async (req) => (await backupMod()).configure(s, req),
  'backup:preview': async (req) => (await backupMod()).preview(s, req),
  'backup:create': async (req) => (await backupMod()).create(s, req),
  'backup:list': async () => (await backupMod()).list(s),
  'backup:inspect': async (req) => (await backupMod()).inspect(s, req),
  'backup:verify': async (req) => (await backupMod()).verify(s, req),
  'backup:restore': async (req) => (await backupMod()).restore(s, req),
  'backup:status': async ({ jobId }) => (await backupMod()).status(s, jobId),
  'backup:cancel': async ({ jobId }) => (await backupMod()).cancel(s, jobId),
  'backup:reveal': async (req) => (await backupMod()).reveal(s, req),
  'backup:remove': async (req) => (await backupMod()).remove(s, req),
});

export const maintenanceHandlers = (s: MainServices): DomainHandlers<'maintenance'> => ({
  'maintenance:report': async (req) => (await maintenanceMod()).report(s, req),
  'maintenance:clean': async (req) => (await maintenanceMod()).clean(s, req),
  'maintenance:openLogs': async () => (await maintenanceMod()).openLogs(s),
  'maintenance:copyDiagnostics': async () => (await maintenanceMod()).diagnostics(s),
});
