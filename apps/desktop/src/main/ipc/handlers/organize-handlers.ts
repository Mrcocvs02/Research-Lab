import { stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError, type DocumentId } from '@rl/core';
import { resolveInRoot } from '@rl/core/node';
import type { LibraryRuntime } from '../../library/library-runtime.js';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

/**
 * Pushes `library:changed` and refreshes the search index of the documents a change touched. An index failure never
 * fails the change (it is on disk): the next scan finds the stale entries by their record stamp and refreshes them.
 */
async function settle(s: MainServices, rt: LibraryRuntime, touched: { reindex: string[] }, events: Array<{ kind: 'documents' | 'taxonomy' | 'projects'; ids?: string[] | undefined }>): Promise<void> {
  if (touched.reindex.length > 0) {
    await rt.reindexDocuments(touched.reindex as DocumentId[]).catch((e: unknown) => s.log.warn('index refresh after a change failed', { error: e }));
  }
  for (const e of events) s.emit('library:changed', e.ids ? { kind: e.kind, ids: e.ids } : { kind: e.kind });
}

/** Ids go into the event only when few (the interface reloads everything otherwise). */
const fewIds = (xs: string[]): string[] | undefined => (xs.length <= 500 ? xs : undefined);

export const taxonomyHandlers = (s: MainServices): DomainHandlers<'taxonomy'> => ({
  'taxonomy:get': async () => (await s.runtime.require()).organizer.taxonomy(),
  'taxonomy:apply': async ({ ops, expectedRevision }) => {
    const rt = await s.runtime.require();
    const r = await rt.organizer.applyTaxonomy(ops, expectedRevision);
    await settle(s, rt, r, [{ kind: 'taxonomy' }, ...(r.reindex.length > 0 ? [{ kind: 'documents' as const, ids: fewIds(r.reindex) }] : [])]);
    return { taxonomy: r.taxonomy, changeId: r.changeId, created: r.created, documentsChanged: r.documentsChanged };
  },
});

export const historyHandlers = (s: MainServices): DomainHandlers<'history'> => {
  const done = async (rt: LibraryRuntime, r: Awaited<ReturnType<LibraryRuntime['organizer']['undo']>>) => {
    await settle(s, rt, r, [
      ...(r.touched.taxonomy ? [{ kind: 'taxonomy' as const }] : []),
      ...(r.reindex.length > 0 ? [{ kind: 'documents' as const, ids: fewIds(r.reindex) }] : []),
      ...(r.touched.projects ? [{ kind: 'projects' as const }] : []),
    ]);
    return { target: r.target, changeId: r.changeId, summary: r.summary, documentsChanged: r.documentsChanged };
  };
  return {
    'history:list': async ({ limit }) => ({ items: await (await s.runtime.require()).organizer.listHistory(limit) }),
    'history:undo': async ({ changeId }) => {
      const rt = await s.runtime.require();
      return done(rt, await rt.organizer.undo(changeId));
    },
    'history:redo': async ({ changeId }) => {
      const rt = await s.runtime.require();
      return done(rt, await rt.organizer.redo(changeId));
    },
  };
};

export const projectsHandlers = (s: MainServices): DomainHandlers<'projects'> => {
  const org = async () => (await s.runtime.require()).organizer;
  const changed = (r: { changeId: string | null }, projectId: string) => {
    if (r.changeId !== null) s.emit('library:changed', { kind: 'projects', ids: [projectId] });
  };
  return {
    'projects:list': async (q) => ({ items: await (await org()).listProjects(q) }),
    'projects:get': async ({ id }) => (await org()).getProject(id),
    'projects:create': async (input) => {
      const r = await (await org()).createProject(input);
      changed(r, r.detail.project.id);
      return r.detail;
    },
    'projects:update': async ({ id, patch, expectedRevision }) => {
      const r = await (await org()).updateProject(id, patch, expectedRevision);
      changed(r, id);
      return r.detail;
    },
    'projects:delete': async ({ id }) => {
      const r = await (await org()).archiveProject(id);
      changed(r, id);
      return r.detail;
    },
    'projects:restore': async ({ id }) => {
      const r = await (await org()).restoreProject(id);
      changed(r, id);
      return r.detail;
    },
    'projects:addMembers': async ({ projectId, docIds, note }) => {
      const r = await (await org()).addProjectMembers(projectId, docIds, note);
      changed(r, projectId);
      return r.detail;
    },
    'projects:removeMembers': async ({ projectId, docIds }) => {
      const r = await (await org()).removeProjectMembers(projectId, docIds);
      changed(r, projectId);
      return r.detail;
    },
    'projects:setReadingPlan': async ({ projectId, items, expectedRevision }) => {
      const r = await (await org()).setReadingPlan(projectId, items, expectedRevision);
      changed(r, projectId);
      return r.detail;
    },
  };
};

/** File types that would run code when "opened" by the system: refused by `documents:open` (the file can still be revealed). */
const RUNNABLE = new Set(['.exe', '.com', '.bat', '.cmd', '.msi', '.scr', '.pif', '.lnk', '.url', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta', '.cpl', '.reg', '.jar', '.sh', '.app', '.command', '.appimage', '.dll']);

const missingFile = () => new AppError('NOT_FOUND', 'The file of this document is missing', { reason: 'missing' });

/**
 * Absolute path of a present document, resolved and confined to the library root. Only the id comes from the
 * renderer. Errors never carry the path.
 */
async function documentFile(s: MainServices, docId: DocumentId): Promise<string> {
  const rt = await s.runtime.require();
  const rec = await rt.getDocument(docId); // NOT_FOUND for an unknown id
  if (rec.missing) throw missingFile();
  const profile = await s.libraries.profile(rt.libraryId);
  const abs = await resolveInRoot(profile.rootPath, rec.path).catch((e: unknown) => {
    if (e instanceof AppError && (e.code === 'PATH_OUTSIDE_ROOT' || e.code === 'INVALID_PATH')) throw new AppError(e.code, 'The file is outside the library');
    throw missingFile();
  });
  const st = await stat(abs).catch(() => null);
  if (!st?.isFile()) throw missingFile();
  return abs;
}

export const organizeDocumentsHandlers = (
  s: MainServices,
): Pick<DomainHandlers<'documents'>, 'documents:update' | 'documents:tag' | 'documents:open' | 'documents:reveal'> & Pick<DomainHandlers<'library'>, 'library:tree'> => ({
  'documents:update': async ({ docId, patch, expectedRevision }) => {
    const rt = await s.runtime.require();
    const r = await rt.organizer.updateDocument(docId, patch, expectedRevision);
    await settle(s, rt, r, r.reindex.length > 0 ? [{ kind: 'documents', ids: r.reindex }] : []);
    // `legacy` (verbatim leftovers of the old index, may hold absolute paths) never reaches the renderer.
    const { legacy: _legacy, ...document } = r.record;
    return { document, changeId: r.changeId };
  },
  'documents:tag': async ({ docIds, add, remove }) => {
    const rt = await s.runtime.require();
    const r = await rt.organizer.tagDocuments(docIds, add, remove);
    await settle(s, rt, r, r.reindex.length > 0 ? [{ kind: 'documents', ids: fewIds(r.reindex) }] : []);
    return { changeId: r.changeId, changed: r.changed, unchanged: r.unchanged };
  },
  'documents:open': async ({ docId }) => {
    const abs = await documentFile(s, docId as DocumentId);
    if (RUNNABLE.has(path.extname(abs).toLowerCase())) throw new AppError('PERMISSION_DENIED', 'This kind of file is not opened from the app');
    const err = await s.shell.openPath(abs);
    if (err) throw new AppError('IO_ERROR', 'The system could not open the file');
    return { ok: true as const };
  },
  'documents:reveal': async ({ docId }) => {
    s.shell.showItemInFolder(await documentFile(s, docId as DocumentId));
    return { ok: true as const };
  },
  'library:tree': async () => (await s.runtime.require()).organizer.folderTree(),
});
