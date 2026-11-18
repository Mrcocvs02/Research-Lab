import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { AppError, documentIdSchema, itemIdSchema, type DocumentId } from '@rl/core';
import { atomicWriteFile } from '@rl/core/node';
import type { MainServices } from '../../ipc/handlers/services.js';

/**
 * Crops of figures, tables and equations (feature 27, D-427): the reader draws the WebP image and main stores it as
 * `<dataDir>/crops/<docId>/<annId>.webp`, written atomically. The original document is never touched. Loaded on demand
 * (dynamic import behind the IPC handler), so it is not part of the start of the app.
 */
export const CROP_MAX_BYTES = 300 * 1024;

const file = async (s: MainServices, docId: string, annId: string): Promise<string> => {
  const rt = await s.runtime.require();
  return path.join(await s.libraries.dataDir(rt.libraryId), 'crops', documentIdSchema.parse(docId), `${itemIdSchema.parse(annId)}.webp`);
};

/** A WebP file: `RIFF....WEBP`. The image comes from the renderer, so its first bytes are checked, not trusted. */
export const isWebp = (b: Uint8Array): boolean => b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP';

export async function saveCrop(s: MainServices, req: { docId: string; annId: string; image: string }): Promise<{ ok: true }> {
  const rt = await s.runtime.require();
  await rt.getDocument(req.docId as DocumentId);
  const bytes = Buffer.from(req.image, 'base64');
  if (!isWebp(bytes)) throw new AppError('INVALID_REQUEST', 'The crop is not a WebP image', { reason: 'crop-format' });
  if (bytes.length > CROP_MAX_BYTES) throw new AppError('INVALID_REQUEST', 'The crop is too large', { reason: 'crop-size', limit: CROP_MAX_BYTES });
  const target = await file(s, req.docId, req.annId);
  await mkdir(path.dirname(target), { recursive: true });
  await atomicWriteFile(target, bytes);
  return { ok: true };
}

export async function getCrop(s: MainServices, req: { docId: string; annId: string }): Promise<{ image: string | null }> {
  try {
    return { image: (await readFile(await file(s, req.docId, req.annId))).toString('base64') };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { image: null };
    throw e;
  }
}

export async function removeCrop(s: MainServices, req: { docId: string; annId: string }): Promise<{ removed: boolean }> {
  const p = await file(s, req.docId, req.annId);
  const had = await readFile(p).then(() => true, () => false);
  await rm(p, { force: true });
  return { removed: had };
}
