import { basename } from 'node:path';
import { AppError, type ImportJobStatus } from '@rl/core';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

export const appHandlers = (s: MainServices): DomainHandlers<'app'> => ({
  'app:info': () => s.appInfo(),
});

export const settingsHandlers = (s: MainServices): DomainHandlers<'settings'> => ({
  'settings:get': () => s.settings.get(),
  'settings:set': (patch) =>
    s.settings.update((cur) => {
      if (patch.uiLanguage) cur.uiLanguage = patch.uiLanguage;
      if (patch.firstRunDone !== undefined) cur.firstRunDone = patch.firstRunDone;
      if (patch.user) cur.user = { ...cur.user, ...Object.fromEntries(Object.entries(patch.user).filter(([, v]) => v !== undefined)) };
    }),
});

export const libraryHandlers = (s: MainServices): DomainHandlers<'library'> => ({
  'library:create': (req) => s.libraries.create(req),
  'library:list': () => s.libraries.list(),
  'library:setActive': async ({ libraryId }) => ({ activeLibraryId: await s.libraries.setActive(libraryId) }),
  'library:forget': async ({ libraryId }) => ({ activeLibraryId: await s.libraries.forget(libraryId) }),
  'library:getConfig': ({ libraryId }) => s.libraries.getConfig(libraryId),
  'library:setConfig': ({ libraryId, patch }) => s.libraries.setConfig(patch, libraryId),
});

export const dialogHandlers = (s: MainServices): DomainHandlers<'dialog'> => ({
  'dialog:chooseFolder': async ({ purpose, title }) => {
    const picked = await s.pickFolder(purpose, title);
    if (!picked) return null;
    s.approved.add(picked);
    return { path: picked, name: basename(picked) || picked };
  },
});

export const secretsHandlers = (s: MainServices): DomainHandlers<'secrets'> => ({
  'secrets:set': async ({ scope, name, value }) => {
    await s.secrets.set(scope, name, value);
    return {};
  },
  'secrets:has': async ({ scope, name }) => ({ exists: await s.secrets.has(scope, name) }),
  'secrets:delete': async ({ scope, name }) => {
    await s.secrets.delete(scope, name);
    return {};
  },
});

/** Job table for the one-shot legacy import. The actual work is `@rl/data`'s LegacyImporter. */
export const importHandlers = (s: MainServices): DomainHandlers<'import'> => {
  const jobs = new Map<string, ImportJobStatus>();
  let counter = 0;
  const publish = (status: ImportJobStatus) => {
    jobs.set(status.jobId, status);
    s.emit('import:progress', status);
  };

  return {
    'import:startLegacy': async ({ libraryId, sourcePath }) => {
      if (!s.approved.has(sourcePath)) throw new AppError('PERMISSION_DENIED', 'The source folder must be chosen with the folder dialog');
      const profile = await s.libraries.profile(libraryId);
      const dataDir = await s.libraries.dataDir(libraryId);
      const settings = await s.settings.get();
      let importer;
      try {
        importer = s.createImporter();
      } catch {
        throw new AppError('NOT_IMPLEMENTED', 'The importer is not available yet');
      }
      const jobId = `import-${Date.now().toString(36)}-${++counter}`;
      publish({ jobId, state: 'running', processed: 0 });
      void importer
        .run({
          sourceDir: sourcePath,
          libraryRoot: profile.rootPath,
          dataDir,
          deviceId: settings.deviceId,
          onProgress: (p) => publish({ ...p, jobId, state: 'running' }),
        })
        .then((report) => publish({ jobId, state: 'done', processed: report.documents, report }))
        .catch((e: unknown) => {
          s.log.error('legacy import failed', { error: e });
          publish({ jobId, state: 'failed', processed: 0, error: AppError.from(e).toJSON() });
        });
      return { jobId };
    },
    'import:status': ({ jobId }) => {
      const status = jobs.get(jobId);
      if (!status) throw new AppError('NOT_FOUND', 'Unknown import job');
      return status;
    },
  };
};
