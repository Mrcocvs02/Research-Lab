import { abortAllJobs } from '../../ai/jobs.js';
import { abortChatTurnsAndWait } from '../../ai/service.js';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { AppError, applyPatch, legacyTaxonomySchema, type ImportJobStatus } from '@rl/core';
import { DEFAULT_MAX_READ_BYTES, readTextFileLimited } from '@rl/core/node';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

export const appHandlers = (s: MainServices): DomainHandlers<'app'> => ({
  'app:info': () => s.appInfo(),
  'app:notices': async () => {
    await s.settings.get(); // notices are raised while the settings load
    return { notices: s.settings.notices() };
  },
  'app:dismissNotice': ({ id }) => {
    s.settings.dismissNotice(id);
    return {};
  },
});

export const settingsHandlers = (s: MainServices): DomainHandlers<'settings'> => ({
  'settings:get': () => s.settings.get(),
  // Only the fields present in the patch change (see `applyPatch`); the rest keeps its value.
  'settings:set': (patch) => s.settings.update((cur) => applyPatch(cur, patch)),
});

export const libraryHandlers = (s: MainServices): Omit<DomainHandlers<'library'>, 'library:tree'> => ({
  'library:create': (req) => s.libraries.create(req),
  'library:list': () => s.libraries.list(),
  'library:setActive': async ({ libraryId }) => {
    // Jobs of the library being left stop (they also check the active library before each document).
    abortAllJobs();
    // A running chat turn stops and writes its log entry in its own library before the switch.
    await abortChatTurnsAndWait();
    const activeLibraryId = await s.libraries.setActive(libraryId);
    await s.runtime.sync({ autoScan: true });
    return { activeLibraryId };
  },
  'library:forget': async ({ libraryId }) => {
    abortAllJobs();
    await abortChatTurnsAndWait();
    const activeLibraryId = await s.libraries.forget(libraryId);
    await s.runtime.sync({ autoScan: true });
    return { activeLibraryId };
  },
  'library:rename': ({ libraryId, name }) => s.libraries.rename(libraryId, name),
  'library:listFolders': async ({ rootPath, libraryId, parent }) => ({
    folders: await s.libraries.listFolders({ rootPath, libraryId }, parent),
  }),
  'library:getConfig': ({ libraryId }) => s.libraries.getConfig(libraryId),
  'library:setConfig': ({ libraryId, patch }) => s.libraries.setConfig(patch, libraryId),
});

export const dialogHandlers = (s: MainServices): DomainHandlers<'dialog'> => ({
  'dialog:chooseFolder': async ({ purpose, title }) => {
    const picked = await s.pickFolder(purpose, title);
    if (!picked) return null;
    s.approved.add(picked, purpose);
    return { path: picked, name: basename(picked) || picked };
  },
  'dialog:chooseFile': async ({ purpose, title }) => {
    const picked = await s.pickFile(purpose, title);
    if (!picked) return null;
    s.approved.add(picked, purpose);
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
  /** Libraries with an import in progress: a second start would run two importers on the same files. */
  const running = new Set<string>();
  let counter = 0;
  const publish = (status: ImportJobStatus) => {
    jobs.set(status.jobId, status);
    s.emit('import:progress', status);
  };

  return {
    'import:probeLegacy': async ({ rootPath }) => {
      // The old index lives inside the library root, so the folder is the one picked as library root.
      const root = s.approved.resolve(rootPath, 'library-root');
      if (root === null) throw new AppError('PERMISSION_DENIED', 'The folder must be chosen with the folder dialog');
      return probeLegacyIndex(root);
    },
    'import:startLegacy': async ({ libraryId, sourcePath }) => {
      // Claim the library synchronously, before any await, so two concurrent starts cannot both pass.
      if (running.has(libraryId)) throw new AppError('ALREADY_EXISTS', 'An import is already running for this library');
      running.add(libraryId);
      // No scan of this library while the importer writes its records (released when the job ends): a scan in
      // progress is cancelled and awaited before anything is written (D-073).
      const releaseScan = s.runtime.hold(libraryId);
      let started = false;
      try {
        await releaseScan.ready;
        const profile = await s.libraries.profile(libraryId);
        // The source is a folder picked for this purpose or, as in the first-run wizard, the
        // library's own root (where the old index sits). Never a folder approved for something else.
        const picked = s.approved.resolve(sourcePath, 'legacy-index');
        const own = s.approved.resolve(sourcePath, 'library-root');
        const sameRoot = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
        const source = picked ?? (own !== null && sameRoot(own, profile.rootPath) ? own : null);
        if (source === null) throw new AppError('PERMISSION_DENIED', 'The source folder must be chosen with the folder dialog');
        const dataDir = await s.libraries.dataDir(libraryId);
        const settings = await s.settings.get();
        let importer;
        try {
          // library.json is only written through LibraryService's serialised queue (D-020, D-044).
          importer = s.createImporter({ updateConfig: (fn) => s.libraries.updateConfig(fn, libraryId) });
        } catch {
          throw new AppError('NOT_IMPLEMENTED', 'The importer is not available yet');
        }
        const jobId = `import-${Date.now().toString(36)}-${++counter}`;
        publish({ jobId, state: 'running', processed: 0 });
        started = true;
        void s
          .backupDataDir(libraryId, dataDir)
          .then((backup) => {
            if (backup) s.log.info('data folder backed up before import', { files: backup.files });
            return importer.run({
              sourceDir: source,
              libraryRoot: profile.rootPath,
              dataDir,
              deviceId: settings.deviceId,
              onProgress: (p) => publish({ ...p, jobId, state: 'running' }),
            });
          })
          .then((report) => publish({ jobId, state: 'done', processed: report.documents, report }))
          .catch((e: unknown) => {
            s.log.error('legacy import failed', { error: e });
            publish({ jobId, state: 'failed', processed: 0, error: AppError.from(e).toJSON() });
          })
          .finally(() => {
            running.delete(libraryId);
            releaseScan();
          });
        return { jobId };
      } finally {
        if (!started) {
          running.delete(libraryId);
          releaseScan();
        }
      }
    },
    'import:status': ({ jobId }) => {
      const status = jobs.get(jobId);
      if (!status) throw new AppError('NOT_FOUND', 'Unknown import job');
      return status;
    },
  };
};

/** Name of the folder the old index tool created inside a library root. */
const LEGACY_INDEX_DIR = '.phd_index';

export interface ProbeLimits {
  /** files.jsonl is only streamed, never held in memory; a file bigger than this is refused. Default 256 MiB. */
  maxIndexBytes?: number;
  /** taxonomy.json is parsed whole; bigger files count as "no taxonomy". Default 16 MiB. */
  maxTaxonomyBytes?: number;
}

/** Counts non-blank lines of a file in constant memory (no line buffer, no per-line size to exceed). */
async function countNonBlankLines(file: string, maxBytes: number): Promise<number> {
  let lines = 0;
  let total = 0;
  let sawContent = false;
  const stream = createReadStream(file);
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      total += chunk.length;
      if (total > maxBytes) throw new AppError('INVALID_REQUEST', 'The index file is too large to preview', { maxBytes });
      for (const byte of chunk) {
        if (byte === 0x0a) {
          if (sawContent) lines++;
          sawContent = false;
        } else if (byte > 0x20) {
          sawContent = true;
        }
      }
    }
  } finally {
    stream.destroy();
  }
  return sawContent ? lines + 1 : lines;
}

/** Counts what an old index holds, read-only, bounded in memory and tolerant of broken lines. */
export async function probeLegacyIndex(
  rootPath: string,
  limits: ProbeLimits = {},
): Promise<{ found: boolean; documents: number; taxonomyNodes: number }> {
  const { maxIndexBytes = 256 * 1024 * 1024, maxTaxonomyBytes = DEFAULT_MAX_READ_BYTES } = limits;
  const dir = join(rootPath, LEGACY_INDEX_DIR);
  const filesJsonl = join(dir, 'files.jsonl');
  const isFile = await stat(filesJsonl).then(
    (st) => st.isFile(),
    () => false,
  );
  if (!isFile) return { found: false, documents: 0, taxonomyNodes: 0 };

  const documents = await countNonBlankLines(filesJsonl, maxIndexBytes);

  let taxonomyNodes = 0;
  try {
    const parsed = legacyTaxonomySchema.safeParse(JSON.parse(await readTextFileLimited(join(dir, 'taxonomy.json'), maxTaxonomyBytes)));
    if (parsed.success) {
      const t = parsed.data;
      taxonomyNodes = Object.keys(t.macro ?? {}).length + Object.keys(t.micro ?? {}).length + Object.keys(t.extra ?? {}).length;
    }
  } catch {
    // no taxonomy file, unreadable or too large: count stays 0
  }
  return { found: true, documents, taxonomyNodes };
}
