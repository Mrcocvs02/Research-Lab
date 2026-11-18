/**
 * J5 (ARCHITETTURA-UI §8.3.14): "Export an annotated copy" and the import of the highlights other programs made. Lazy chunk, loaded by
 * `pdf-sync.ts` at the first use. SECURITY-SENSITIVE like the writer:
 *  - the ORIGINAL is only read: the copy is built in our own local folder (temporary, journaled), verified by the worker (original
 *    bytes as exact prefix, structure, pdf.js), and only then moved into the folder the user picked; a name that exists is never replaced;
 *  - the destination is a folder approved for `export-destination` (never the renderer's spelling of a path), outside the library root;
 *  - it needs no consent and does not depend on `PDF_WRITE_ENABLED`: it writes nothing but the copy, on an explicit gesture;
 *  - the import creates app annotations only (no PDF is written); the keys come from the renderer, the data from a fresh read of the file.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  AppError,
  PDF_WRITE_LIMITS as L,
  STUDY_LIMITS,
  annotationFileSchema,
  contentHashOf,
  type Annotation,
  type AnnotationFile,
  type DocumentId,
  type DocumentRecord,
  type ExternalItem,
} from '@rl/core';
import { sha256File } from '@rl/core/node';
import type { PlanAnnot } from '@rl/data/pdf-annot';
import { isInsideLibrary } from '../export/target.js';
import type { LibraryRuntime } from '../library/library-runtime.js';
import type { MainServices } from '../ipc/handlers/services.js';
import { fingerprint, sameFingerprint, writeTempWithAppend, type Journal } from './pdf-files.js';

export interface CopyContext {
  s: MainServices;
  rt: LibraryRuntime;
  rec: DocumentRecord;
  abs: string;
  /** The annotations that may be written (geom 2, aligned with the file), without their marks: all of them are new in the copy. */
  plan: PlanAnnot[];
  skipped: number;
  author?: string | undefined;
  /** Our own local folder (temporaries) and the journal that lists them. */
  dir: string;
  journal: Journal;
  destination: string;
}

/** `Name (annotated).pdf`, then `Name (annotated 2).pdf`...: the first name that does not exist in the folder. */
async function freeName(dir: string, original: string): Promise<string> {
  const base =
    path
      .basename(original)
      .replace(/\.pdf$/i, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/, '')
      .slice(0, 120) || 'document';
  for (let i = 1; i < 100; i++) {
    const name = `${base} (annotated${i > 1 ? ` ${i}` : ''}).pdf`;
    if (!(await stat(path.join(dir, name)).then(() => true, () => false))) return name;
  }
  throw new AppError('CONFLICT', 'Too many copies with this name in the folder', { reason: 'name-taken' });
}

export async function exportCopy(c: CopyContext): Promise<{ file: string; annotations: number; skipped: number }> {
  const { s, rt, rec, abs } = c;
  const dest = s.approved.resolve(c.destination, 'export-destination');
  if (dest === null) throw new AppError('INVALID_REQUEST', 'The destination folder was not chosen with the folder dialog', { reason: 'destination-not-approved' });
  if (!(await stat(dest).then((x) => x.isDirectory(), () => false))) throw new AppError('INVALID_REQUEST', 'The destination is not a folder', { reason: 'destination-missing' });
  if (await isInsideLibrary(rt.store.rootPath, dest)) throw new AppError('CONFLICT', 'The copy cannot go inside the library folder', { reason: 'inside-library' });
  if (rec.missing || !/\.pdf$/i.test(abs)) throw new AppError('INVALID_REQUEST', 'The PDF is not available', { reason: 'unavailable' });
  if (c.plan.length === 0 && !rec.pdfWrite) throw new AppError('INVALID_REQUEST', 'There is nothing to write into a copy', { reason: 'no-annotations' });

  const st = await stat(abs);
  if (st.size > L.maxBytes) throw new AppError('PERMISSION_DENIED', 'The file is too large', { reason: 'too-large' });
  const before = await fingerprint(abs);
  const hash = await sha256File(abs);
  if (hash !== rec.hash || st.size !== rec.size) throw new AppError('CONFLICT', 'The file changed meanwhile', { reason: 'changed' });

  const plan = await rt.pdf.pdfSync({ path: abs, mode: 'sync', annotations: c.plan, otherIds: [], known: {}, ...(c.author ? { author: c.author } : {}), now: new Date().toISOString(), forCopy: true });
  if (!plan.ok) {
    s.log.warn('annotated copy refused', { reason: plan.reason, detail: plan.detail });
    throw new AppError('PERMISSION_DENIED', 'The PDF cannot be annotated', { reason: plan.reason });
  }
  if (plan.size !== st.size) throw new AppError('CONFLICT', 'The file changed meanwhile', { reason: 'changed' });

  await mkdir(c.dir, { recursive: true });
  const stamp = randomBytes(4).toString('hex');
  const tmp = path.join(c.dir, `.copy-${stamp}.pdf.rl-${stamp}.tmp`);
  const out = path.join(dest, `.${randomUUID().slice(0, 8)}.pdf.rl-${stamp}.tmp`);
  await c.journal.add({ tmp, docId: rec.id, libraryId: rt.libraryId, at: new Date().toISOString() });
  try {
    let finalHash = hash;
    if (plan.update) {
      await writeTempWithAppend(abs, tmp, plan.update.bytes, plan.update.oldSize);
      const byId = new Map(c.plan.map((a) => [a.id, a]));
      const deep = plan.marks.flatMap((m) => {
        const a = byId.get(m.id);
        return a ? [{ page: a.page - 1, objNum: m.objNum, gen: m.gen, subtype: a.kind === 'underline' ? 'Underline' : 'Highlight' }] : [];
      });
      const v = await rt.pdf.pdfVerify({ path: tmp, oldSize: plan.update.oldSize, oldHash: hash, expect: plan.expect, pages: plan.pages, deep });
      if (!v.ok) {
        s.log.warn('annotated copy verification failed', { detail: v.detail });
        throw new AppError('PERMISSION_DENIED', 'The copy did not pass the check', { reason: 'verify-failed' });
      }
      finalHash = v.sha256;
    } else {
      // Nothing to add (the file already holds them): the copy is the file as it is.
      await copyFile(abs, tmp, constants.COPYFILE_EXCL);
      if ((await sha256File(tmp)) !== hash) throw new AppError('CONFLICT', 'The file changed meanwhile', { reason: 'changed' });
    }
    // The original must be what it was: nothing of ours touched it, and nobody else did while the copy was built.
    if (!sameFingerprint(before, await fingerprint(abs))) throw new AppError('CONFLICT', 'The file changed meanwhile', { reason: 'changed' });
    // Into the folder the user picked: first under a hidden random name, then renamed; across volumes it is copied.
    await rename(tmp, out).catch(async (e: NodeJS.ErrnoException) => {
      if (e.code !== 'EXDEV') throw new AppError('IO_ERROR', 'Cannot write into the folder', { code: e.code ?? 'unknown' });
      await copyFile(tmp, out, constants.COPYFILE_EXCL).catch((x: NodeJS.ErrnoException) => {
        throw new AppError('IO_ERROR', 'Cannot write into the folder', { code: x.code ?? 'unknown' });
      });
    });
    if ((await sha256File(out)) !== finalHash) throw new AppError('IO_ERROR', 'The copy was not written correctly', { reason: 'verify-failed' });
    const file = await freeName(dest, rec.path);
    await rename(out, path.join(dest, file));
    return { file, annotations: c.plan.length, skipped: c.skipped };
  } finally {
    await unlink(tmp).catch(() => {});
    await unlink(out).catch(() => {});
    await c.journal.remove(tmp);
  }
}

/* ----------------------------------------------------------------- annotations of other programs */

const near = (a: number, b: number) => Math.abs(a - b) <= 0.004;
const sameBox = (a: ExternalItem['rects'], b: ExternalItem['rects']) => a.length === b.length && a.every((r, i) => near(r.x, b[i]!.x) && near(r.y, b[i]!.y) && near(r.w, b[i]!.w) && near(r.h, b[i]!.h));
const equalInApp = (it: Pick<ExternalItem, 'page' | 'kind' | 'rects'>, file: AnnotationFile | null) => (file?.annotations ?? []).some((a) => a.page === it.page && a.kind === it.kind && sameBox(a.rects, it.rects));

/** Reads the highlights and underlines of other programs in the PDF (in the worker) and marks those the app already has. */
export async function externalList(rt: LibraryRuntime, abs: string, file: AnnotationFile | null): Promise<{ items: ExternalItem[]; truncated: boolean }> {
  const r = await rt.pdf.pdfInspect({ path: abs, list: true }).catch(() => null);
  if (!r?.ok || !r.items) throw new AppError('PERMISSION_DENIED', 'The PDF cannot be read', { reason: 'damaged' });
  const items = r.items.map((it): ExternalItem => {
    const { comment, author, color, ...rest } = it;
    return { ...rest, ...(color ? { color } : {}), ...(comment ? { comment: comment.slice(0, STUDY_LIMITS.annotationComment) } : {}), ...(author ? { author: author.slice(0, 200) } : {}), inApp: equalInApp(it, file) };
  });
  return { items, truncated: r.truncated === true };
}

/** Creates app annotations for the chosen items of a fresh read of the file. Items already in the app, and unknown keys, are skipped. */
export async function externalImport(rt: LibraryRuntime, rec: DocumentRecord, abs: string, keys: string[]): Promise<{ imported: number; skipped: number }> {
  const want = new Set(keys);
  const { items } = await externalList(rt, abs, await rt.store.annotations.get(rec.id as DocumentId));
  const hash = contentHashOf(rec);
  let imported = 0;
  await rt.store.annotations.update(rec.id as DocumentId, (cur) => {
    imported = 0;
    const base = cur ?? annotationFileSchema.parse({ docId: rec.id });
    const list = [...base.annotations];
    const now = new Date().toISOString();
    for (const it of items) {
      if (!want.has(it.key) || equalInApp(it, { ...base, annotations: list })) continue;
      if (list.length >= STUDY_LIMITS.annotationsPerDoc) throw new AppError('INVALID_REQUEST', 'Too many annotations on this document', { reason: 'annotations-limit', limit: STUDY_LIMITS.annotationsPerDoc });
      // The rectangles were measured on the page as the reader shows it (geometry of the writer), hence `geom: 2`; the text is not known.
      const a: Annotation = { id: `a-${randomUUID().replace(/-/g, '').slice(0, 20)}`, kind: it.kind, page: it.page, rects: it.rects, text: '', color: it.color ?? 'yellow', geom: 2, forHash: hash, createdAt: now, updatedAt: now };
      if (it.comment) a.comment = it.comment;
      list.push(a);
      imported++;
    }
    const next = { ...base, forHash: base.forHash ?? hash, annotations: list };
    if (Buffer.byteLength(JSON.stringify(next, null, 2)) > STUDY_LIMITS.annotationsFileBytes) throw new AppError('INVALID_REQUEST', 'The annotations of this document are too large', { reason: 'annotations-size', limit: STUDY_LIMITS.annotationsFileBytes });
    return next;
  });
  return { imported, skipped: want.size - imported };
}
