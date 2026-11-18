/**
 * Phase 3 (study): the in-app reader, notes per file and per page, PDF annotations (D-184, D-185..).
 * Contracts: `packages/core/src/ipc/channels/{reader,notes,annotations}.ts`.
 * Everything is written to the data folder of the library; the PDF itself is only ever read.
 */
import { randomUUID } from 'node:crypto';
import { AppError, STUDY_LIMITS, annotationFileSchema, contentHashOf, type Annotation, type DocumentId, type Note } from '@rl/core';
import type { LibraryRuntime } from '../../library/library-runtime.js';
import type { DomainHandlers } from '../types.js';

import { listThumbs, nativeThumb, pruneThumbs, putThumb } from '../../thumbs.js';
import { getPdfSync } from '../../study/pdf-sync.js';
import { scheduleRepairJob } from '../../study/repair-job.js';
import { openPdfHandle, presentPdf } from './doc-files.js';
import type { MainServices } from './services.js';

export const readerHandlers = (s: MainServices): DomainHandlers<'reader'> => ({
  'reader:open': async ({ docId }) => {
    const pdf = await presentPdf(s, docId as DocumentId);
    // The file must also look like a PDF (a renamed file is refused here, not by the viewer).
    const opened = await openPdfHandle(pdf.abs, pdf.root);
    if (typeof opened === 'string') {
      const message = opened === 'missing' ? 'The file of this document is missing' : opened === 'outside' ? 'The file is outside the library' : 'Only PDF files open in the reader';
      throw new AppError('PERMISSION_DENIED', message, { reason: opened });
    }
    await opened.fh.close().catch(() => {});
    return { url: `rl-doc://doc/${docId}?v=${pdf.hash.slice(0, 8)}`, hash: pdf.hash, title: pdf.title };
  },
  'reader:openLink': async ({ url }) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new AppError('PERMISSION_DENIED', 'Only http and https links open in the browser');
    }
    // A link with credentials is a classic way to dress up a hostile address.
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) throw new AppError('PERMISSION_DENIED', 'Only http and https links open in the browser');
    await s.shell.openExternal(u.href).catch(() => {
      throw new AppError('IO_ERROR', 'The system could not open the link');
    });
    return { ok: true as const };
  },
});

/** Runs the tasks of one key one after the other; a failed task does not stop the next. */
class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(task, task);
    const tail = next.catch(() => {});
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}

/** Markdown to a short plain text: no markers, one line. */
export function plainExcerpt(markdown: string, max: number = STUDY_LIMITS.excerpt): string {
  const t = markdown
    .replace(/```[^\n]*\n?/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...t].slice(0, max).join('');
}

const noteView = (n: Note) => ({
  docId: n.frontmatter.docId,
  ...(n.frontmatter.scope === 'page' && n.frontmatter.page !== undefined ? { page: n.frontmatter.page } : {}),
  body: n.body,
  createdAt: n.frontmatter.createdAt,
  updatedAt: n.frontmatter.updatedAt,
});

/** The document must exist in the active library; unknown ids are NOT_FOUND before anything is read or written. */
async function activeDocument(s: MainServices, docId: string): Promise<LibraryRuntime> {
  const rt = await s.runtime.require();
  await rt.getDocument(docId as DocumentId);
  return rt;
}

/** The index refresh never fails a change that is already on disk: the next scan finds the stale entry. */
async function refreshIndex(s: MainServices, rt: LibraryRuntime, docId: string): Promise<void> {
  await rt.reindexDocuments([docId as DocumentId]).catch((e: unknown) => s.log.warn('index refresh after a note or annotation change failed', { error: e }));
}

export const notesHandlers = (s: MainServices): DomainHandlers<'notes'> => {
  const queue = new KeyedQueue();
  return {
    'notes:get': async ({ docId, page }) => {
      const rt = await activeDocument(s, docId);
      const note = await rt.store.notes.get(docId as DocumentId, page);
      return { note: note ? noteView(note) : null };
    },
    'notes:list': async ({ docId }) => {
      const rt = await activeDocument(s, docId);
      const notes = await rt.store.notes.listForDocument(docId as DocumentId);
      // The store already lists the file note first, then the page notes by page.
      const items = notes.map((n) => ({
        page: n.frontmatter.scope === 'page' ? (n.frontmatter.page ?? null) : null,
        updatedAt: n.frontmatter.updatedAt,
        excerpt: plainExcerpt(n.body),
      }));
      return { items };
    },
    'notes:save': async ({ docId, page, body, expectedUpdatedAt }) => {
      const rt = await activeDocument(s, docId);
      // One queue per note file (and library): the read, the conflict check and the write are one step.
      const key = `${rt.libraryId}|${docId}|${page ?? 'file'}`;
      const result = await queue.run(key, async () => {
        const store = rt.store;
        const cur = await store.notes.get(docId as DocumentId, page);
        if ((cur?.frontmatter.updatedAt ?? null) !== expectedUpdatedAt) {
          throw new AppError('CONFLICT', 'The note was changed somewhere else', { current: cur ? noteView(cur) : null });
        }
        if (body.trim() === '') {
          if (!cur) return { note: null, changed: false };
          await store.notes.remove(docId as DocumentId, page);
          return { note: null, changed: true };
        }
        // `updatedAt` always moves forward, so a stale editor can never match a newer note by chance.
        const prev = cur ? Date.parse(cur.frontmatter.updatedAt) : 0;
        const stamp = new Date(Math.max(Date.now(), prev + 1)).toISOString();
        const note: Note = {
          frontmatter: {
            docId: docId as DocumentId,
            scope: page === undefined ? 'file' : 'page',
            ...(page === undefined ? {} : { page }),
            createdAt: cur?.frontmatter.createdAt ?? stamp,
            updatedAt: stamp,
          },
          body,
        };
        await store.notes.put(note);
        return { note: noteView(note), changed: true };
      });
      if (result.changed) {
        await refreshIndex(s, rt, docId);
        s.emit('library:changed', { kind: 'notes', ids: [docId] });
      }
      return { note: result.note };
    },
  };
};

type Underlined = { value: boolean; origin: 'annotations' | 'manual' };

export const annotationsHandlers = (s: MainServices): DomainHandlers<'annotations'> => {
  const queue = new KeyedQueue();
  // Annotations saved while the page was stretched are measured again in the background (D-373), once per library.
  scheduleRepairJob(s);
  // Writing into the PDFs (D-316): the moments of writing, consent, restore. Off while `PDF_WRITE_ENABLED` is off.
  const pdf = getPdfSync(s);
  /** The annotations of one document change one at a time, together with the flag that follows them. */
  const change = async <T>(docId: string, fn: (rt: LibraryRuntime) => Promise<{ value: T; changed: boolean; flagChanged: boolean; underlined: Underlined }>) => {
    const rt = await activeDocument(s, docId);
    const r = await queue.run(`${rt.libraryId}|${docId}`, () => fn(rt));
    if (r.changed) {
      await refreshIndex(s, rt, docId);
      s.emit('library:changed', { kind: 'annotations', ids: [docId] });
      pdf.touch(rt.libraryId, docId);
      // The "underlined" flag lives in the document record: lists showing it reload that document.
      if (r.flagChanged) s.emit('library:changed', { kind: 'documents', ids: [docId] });
    }
    return r;
  };
  return {
    'annotations:list': async ({ docId }) => {
      const rt = await activeDocument(s, docId);
      const file = await rt.store.annotations.get(docId as DocumentId);
      const rec = await rt.getDocument(docId as DocumentId);
      // Each annotation counts with its own hash; old files (no per-annotation hash) inherit the file-level one (D-198).
      const staleIds = (file?.annotations ?? []).filter((a) => {
        const h = a.forHash ?? file?.forHash;
        return h !== undefined && h !== contentHashOf(rec);
      }).map((a) => a.id);
      return { annotations: file?.annotations ?? [], stale: staleIds.length > 0, staleIds };
    },
    'annotations:save': async ({ docId, annotation }) => {
      const r = await change(docId, async (rt) => {
        const rec = await rt.getDocument(docId as DocumentId);
        const now = new Date().toISOString();
        let saved!: Annotation;
        const file = await rt.store.annotations.update(docId as DocumentId, (current) => {
          const base = current ?? annotationFileSchema.parse({ docId });
          const list = [...base.annotations];
          const { id, geom, ...fields } = annotation;
          if (id !== undefined) {
            const i = list.findIndex((a) => a.id === id);
            const old = list[i];
            if (!old) throw new AppError('NOT_FOUND', 'Unknown annotation');
            // Absent fields keep their stored value; the hash is re-stamped (this is how an annotation is re-confirmed).
            saved = {
              ...old,
              kind: fields.kind,
              page: fields.page,
              rects: fields.rects,
              ...(fields.text !== undefined ? { text: fields.text } : {}),
              ...(fields.color !== undefined ? { color: fields.color } : {}),
              ...(fields.crop !== undefined ? { crop: fields.crop } : {}),
              ...(geom === 2 ? { geom } : {}),
              forHash: contentHashOf(rec),
              updatedAt: now,
            };
            if (geom === null) delete saved.geom;
            if (fields.comment === undefined) delete saved.comment;
            else saved.comment = fields.comment;
            list[i] = saved;
          } else {
            if (list.length >= STUDY_LIMITS.annotationsPerDoc) {
              throw new AppError('INVALID_REQUEST', 'Too many annotations on this document', { reason: 'annotations-limit', limit: STUDY_LIMITS.annotationsPerDoc });
            }
            saved = { ...fields, ...(geom === 2 ? { geom } : {}), text: fields.text ?? '', color: fields.color ?? 'yellow', forHash: contentHashOf(rec), id: `a-${randomUUID().replace(/-/g, '').slice(0, 20)}`, createdAt: now, updatedAt: now } as Annotation;
            list.push(saved);
          }
          // The file-level hash stays as first written; each annotation carries its own.
          const next = { ...base, forHash: base.forHash ?? contentHashOf(rec), annotations: list };
          // Refused before anything is written: a file above the cap would make list and save fail for good.
          if (Buffer.byteLength(JSON.stringify(next, null, 2)) > STUDY_LIMITS.annotationsFileBytes) {
            throw new AppError('INVALID_REQUEST', 'The annotations of this document are too large', { reason: 'annotations-size', limit: STUDY_LIMITS.annotationsFileBytes });
          }
          return next;
        });
        // A crop (`area`) is not an underline: only highlights and underlines set the flag.
        const u = await rt.organizer.syncUnderlined(docId, file.annotations.some((x) => x.kind !== 'area'));
        return { value: saved, changed: true, flagChanged: u.changed, underlined: u.underlined };
      });
      return { annotation: r.value, underlined: r.underlined };
    },
    'annotations:remove': async ({ docId, id }) => {
      const r = await change(docId, async (rt) => {
        const current = await rt.store.annotations.get(docId as DocumentId);
        const list = (current?.annotations ?? []).filter((a) => a.id !== id);
        const removed = current !== null && list.length !== current.annotations.length;
        // Nothing to remove: nothing is written (not even an empty file).
        if (current && removed) await rt.store.annotations.put({ ...current, annotations: list });
        const u = await rt.organizer.syncUnderlined(docId, list.some((x) => x.kind !== 'area'));
        return { value: removed, changed: removed || u.changed, flagChanged: u.changed, underlined: u.underlined };
      });
      return { removed: r.value, underlined: r.underlined };
    },
    'annotations:pdfState': async ({ docId, inspect }) => pdf.state(docId, inspect === true),
    'annotations:writeNow': async ({ docId }) => pdf.writeNow(docId),
    'annotations:setPdfMode': async ({ docId, mode }) => pdf.setMode(docId, mode),
    'annotations:confirmPdfWrite': async ({ choice }) => pdf.confirm(choice),
    'annotations:removeFromPdf': async ({ docId }) => pdf.removeFromPdf(docId),
    'annotations:restoreOriginal': async ({ docId }) => pdf.restoreOriginal(docId),
    'annotations:resolveMissing': async ({ docId, choice, ids }) => pdf.resolveMissing(docId, choice, ids),
    'annotations:migrate': async () => pdf.migrate(),
    'annotations:restoreAll': async () => pdf.restoreAll(),
    'annotations:jobCancel': async ({ jobId }) => (pdf.cancel(jobId), {}),
    'annotations:backups': async () => pdf.backups(),
    'annotations:deleteBackups': async () => pdf.deleteBackups(),
    'annotations:migrationPlan': async () => pdf.migrationPlan(),
    'annotations:exportCopy': async ({ docId, destination }) => pdf.exportCopy(docId, destination),
    'annotations:externalList': async ({ docId }) => pdf.externalList(docId),
    'annotations:externalImport': async ({ docId, keys }) => pdf.externalImport(docId, keys),
  };
};

/** Grid thumbnails (D-194, D-196): the renderer draws, main stores and serves (`thumbs.ts`, `thumb-protocol.ts`). */
export const thumbsHandlers = (s: MainServices): DomainHandlers<'thumbs'> => {
  const pruned = new Set<string>();
  return {
    'thumbs:list': async ({ docIds }) => {
      const rt = await s.runtime.require();
      const items = await listThumbs(s, docIds);
      // Once per library and session, in the background: thumbnails of documents that no longer exist go away.
      if (!pruned.has(rt.libraryId)) {
        pruned.add(rt.libraryId);
        void pruneThumbs(s.localDataDir, rt.libraryId, (id) => rt.getDocument(id as DocumentId).then(() => true, (e: unknown) => !(e instanceof AppError && e.code === 'NOT_FOUND'))).catch((e: unknown) =>
          s.log.warn('thumbnail cleanup failed', { error: e }),
        );
      }
      return { items };
    },
    'thumbs:native': ({ docId }) => nativeThumb(s, docId),
    'thumbs:put': async ({ docId, hash, webp }) => ({ url: await putThumb(s, docId, hash, webp) }),
  };
};
