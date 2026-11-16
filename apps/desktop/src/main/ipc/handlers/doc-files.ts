import { open, realpath, stat, type FileHandle } from 'node:fs/promises';
import { AppError, type DocumentId } from '@rl/core';
import { isInside, resolveInRoot } from '@rl/core/node';
import type { MainServices } from './services.js';

/** A document the reader may show: a present PDF of the active library. */
export interface PresentPdf {
  /** Absolute path, resolved and confined to the library root. Never leaves the main process. */
  abs: string;
  /** Library root as configured; `openPdfHandle` re-checks the opened file against it. */
  root: string;
  hash: string;
  title: string | null;
}

const PDF_EXT = /\.pdf$/i;
const refuse = (reason: 'not-pdf' | 'missing' | 'outside', message: string) => new AppError('PERMISSION_DENIED', message, { reason });

/**
 * Looks the document up in the ACTIVE library (nothing is cached: a library switch or a moved file is seen by the
 * next call) and resolves its file with `resolveInRoot` (realpath confinement). Errors never carry a path.
 * NOT_FOUND for an unknown id; PERMISSION_DENIED with `details.reason` 'missing', 'not-pdf' or 'outside' otherwise.
 */
export async function presentPdf(s: Pick<MainServices, 'runtime' | 'libraries'>, docId: DocumentId): Promise<PresentPdf> {
  const rt = await s.runtime.require();
  const rec = await rt.getDocument(docId);
  if (rec.missing) throw refuse('missing', 'The file of this document is missing');
  if (!PDF_EXT.test(rec.path)) throw refuse('not-pdf', 'Only PDF files open in the reader');
  const profile = await s.libraries.profile(rt.libraryId);
  const abs = await resolveInRoot(profile.rootPath, rec.path).catch((e: unknown) => {
    if (e instanceof AppError && (e.code === 'PATH_OUTSIDE_ROOT' || e.code === 'INVALID_PATH')) throw refuse('outside', 'The file is outside the library');
    throw refuse('missing', 'The file of this document is missing');
  });
  // The link target, not the name of the link, decides what the file is.
  if (!PDF_EXT.test(abs)) throw refuse('not-pdf', 'Only PDF files open in the reader');
  const st = await stat(abs).catch(() => null);
  if (!st?.isFile()) throw refuse('missing', 'The file of this document is missing');
  return { abs, root: profile.rootPath, hash: rec.hash, title: rec.title };
}

/** pdf.js accepts the header anywhere in the first KiB. */
const HEAD_BYTES = 1024;

/**
 * Narrows the check-then-use window of `resolveInRoot` (D-200): once the handle is open, the path must still resolve
 * to itself, inside the root, and to the very file that was opened (same device and inode). A swap of a folder or of
 * the file for a link between the check and the open is caught here. What remains is a swap after this check, which
 * needs write access to the library folder.
 */
export async function stillTheSameFile(abs: string, root: string, fh: FileHandle): Promise<boolean> {
  try {
    const real = await realpath(abs);
    if (real !== abs) return false;
    const realRoot = await realpath(root);
    if (!isInside(realRoot, real)) return false;
    const [a, b] = await Promise.all([fh.stat(), stat(abs)]);
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}

/**
 * Opens a file read-only and checks it starts like a PDF. The size comes from the open handle, so it matches the
 * bytes that are then streamed even if the file changes meanwhile. With `root`, the path is re-checked after the
 * open (`stillTheSameFile`); a mismatch is 'outside'. The caller closes the handle.
 */
export async function openPdfHandle(abs: string, root?: string): Promise<{ fh: FileHandle; size: number } | 'not-pdf' | 'missing' | 'outside'> {
  let fh: FileHandle;
  try {
    fh = await open(abs, 'r');
  } catch {
    return 'missing';
  }
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw new Error('not a file');
    if (root !== undefined && !(await stillTheSameFile(abs, root, fh))) {
      await fh.close().catch(() => {});
      return 'outside';
    }
    const buf = Buffer.alloc(Math.min(HEAD_BYTES, st.size));
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    if (!buf.subarray(0, bytesRead).includes('%PDF-')) {
      await fh.close();
      return 'not-pdf';
    }
    return { fh, size: st.size };
  } catch {
    await fh.close().catch(() => {});
    return 'missing';
  }
}
