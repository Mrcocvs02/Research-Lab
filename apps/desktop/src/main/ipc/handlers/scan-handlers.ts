import { AppError, scanReportSchema, type ScanReport } from '@rl/core';
import { readJsonFile } from '@rl/core/node';
import { scanReportFile } from '../../library/library-runtime.js';
import { clearThumbs } from '../../thumbs.js';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

/** Background scan of the active library: start, cancel, status. Progress is pushed as `scan:progress`. */
export const scanHandlers = (s: MainServices): DomainHandlers<'scan'> => ({
  'scan:start': async ({ libraryId, full }) => (await s.runtime.require(libraryId, { retry: true })).startScan({ full }),
  'scan:cancel': async ({ libraryId }) => (await s.runtime.require(libraryId)).cancel(),
  // The report of the last finished scan, written by the library runtime; none yet (or unreadable): the empty report.
  'scan:report': async ({ libraryId }) => {
    const id = libraryId ?? (await s.settings.get()).activeLibraryId;
    const empty: ScanReport = { finishedAt: null, summary: null, firstScan: false, added: [], changed: [], moved: [], missing: [], failed: [], truncated: false };
    if (!id) return empty;
    return readJsonFile(scanReportFile(s.localDataDir, id), scanReportSchema).catch(() => empty);
  },
  'scan:status': async ({ libraryId }) => {
    await s.runtime.sync();
    const status = s.runtime.status();
    if (libraryId !== undefined && status.libraryId !== libraryId) throw new AppError('LIBRARY_NOT_ACTIVE', 'This library is not the active one');
    return status;
  },
});

export const indexHandlers = (s: MainServices): DomainHandlers<'index'> => ({
  'index:rebuild': async ({ libraryId }) => {
    const rt = await s.runtime.require(libraryId, { retry: true });
    // The grid thumbnails are a cache of the same kind: a rebuild starts them over (they are drawn again when seen).
    void clearThumbs(s.localDataDir, rt.libraryId);
    return rt.rebuild();
  },
});
