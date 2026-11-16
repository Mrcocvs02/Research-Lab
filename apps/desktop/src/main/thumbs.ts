import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError, THUMB_SCHEME, type DocumentId } from '@rl/core';
import { openPdfHandle, presentPdf } from './ipc/handlers/doc-files.js';
import type { MainServices } from './ipc/handlers/services.js';

/**
 * Grid thumbnails (D-194, D-195): small WebP images of the first page of a PDF, drawn by the renderer and kept in the
 * machine-local cache `<localData>/thumbs/<libraryId>/<docId>-<hash8>.webp`. They are rebuildable and never leave the
 * machine. The name carries the first 8 hex of the content hash, so a changed file simply has no thumbnail yet.
 */
/** A file of the cache folder: a thumbnail or a temporary file of a write in progress. */
const THUMB_ANY = /^([0-9a-f]{16})-([0-9a-f]{8})\.webp(\.[0-9a-f]+\.tmp)?$/;
const LIBRARY_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type ThumbServices = Pick<MainServices, 'runtime' | 'libraries'> & { localDataDir: string };

export const thumbUrl = (docId: string, hash: string): string => `${THUMB_SCHEME}://thumb/${docId}?v=${hash.slice(0, 8)}`;

/** The cache folder of a library. The id comes from the runtime, never from the renderer; it is still checked. */
export function thumbDir(localDataDir: string, libraryId: string): string {
  if (!LIBRARY_ID.test(libraryId)) throw new AppError('INVALID_PATH', 'Invalid library id');
  return path.join(localDataDir, 'thumbs', libraryId);
}

const names = async (dir: string): Promise<string[]> => readdir(dir).catch(() => []);

export interface ThumbListItem {
  docId: string;
  url: string | null;
  drawable: boolean;
  hash?: string;
}

/** `thumbs:list`: the cached thumbnail of each document, or whether the renderer may draw one. Reads the folder once. */
export async function listThumbs(s: ThumbServices, docIds: string[]): Promise<ThumbListItem[]> {
  const rt = await s.runtime.require();
  const files = new Set(await names(thumbDir(s.localDataDir, rt.libraryId)));
  const items: ThumbListItem[] = [];
  for (const docId of docIds) {
    // Not a present PDF of the active library (unknown, missing, other format, outside the root): the type icon stays.
    const pdf = await presentPdf(s, docId as DocumentId).catch(() => null);
    if (!pdf) {
      items.push({ docId, url: null, drawable: false });
      continue;
    }
    if (files.has(`${docId}-${pdf.hash.slice(0, 8)}.webp`)) {
      items.push({ docId, url: thumbUrl(docId, pdf.hash), drawable: false, hash: pdf.hash });
      continue;
    }
    const opened = await openPdfHandle(pdf.abs);
    if (typeof opened === 'string') {
      items.push({ docId, url: null, drawable: false });
      continue;
    }
    await opened.fh.close().catch(() => {});
    items.push({ docId, url: null, drawable: true, hash: pdf.hash });
  }
  return items;
}

/** Writes of one document run one after the other, so the cleanup of an older write never removes a newer file. */
const tails = new Map<string, Promise<unknown>>();
function serial<T>(key: string, task: () => Promise<T>): Promise<T> {
  const next = (tails.get(key) ?? Promise.resolve()).then(task, task);
  const tail = next.catch(() => {});
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return next;
}

/**
 * `thumbs:put`: stores an image for the content with `hash`. Nothing is stored (and the answer is `null`) when the
 * document is no longer a present PDF or its hash has changed since the renderer asked. The write is atomic (temporary
 * file, then rename) and removes the older files of the same document.
 */
export async function putThumb(s: ThumbServices, docId: string, hash: string, webp: Uint8Array): Promise<string | null> {
  const rt = await s.runtime.require();
  const dir = thumbDir(s.localDataDir, rt.libraryId);
  return serial(`${rt.libraryId}/${docId}`, async () => {
    const pdf = await presentPdf(s, docId as DocumentId).catch(() => null);
    if (!pdf || pdf.hash !== hash) return null;
    await mkdir(dir, { recursive: true });
    const final = `${docId}-${hash.slice(0, 8)}.webp`;
    const tmp = `${final}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await writeFile(path.join(dir, tmp), webp);
      await rename(path.join(dir, tmp), path.join(dir, final));
    } catch (e) {
      await rm(path.join(dir, tmp), { force: true }).catch(() => {});
      throw new AppError('IO_ERROR', 'The thumbnail could not be stored', { cause: e instanceof Error ? e.message : String(e) });
    }
    for (const name of await names(dir)) {
      const m = THUMB_ANY.exec(name);
      if (m && m[1] === docId && name !== final) await rm(path.join(dir, name), { force: true }).catch(() => {});
    }
    return thumbUrl(docId, hash);
  });
}

/**
 * Removes the thumbnails of documents that no longer exist (and stray files). One folder listing, one lookup per
 * distinct document, with a pause every few lookups: meant to run in the background after the library is in use.
 */
export async function pruneThumbs(localDataDir: string, libraryId: string, isKnown: (docId: string) => Promise<boolean>): Promise<number> {
  const dir = thumbDir(localDataDir, libraryId);
  let removed = 0;
  const known = new Map<string, boolean>();
  let lookups = 0;
  for (const name of await names(dir)) {
    const m = THUMB_ANY.exec(name);
    let keep = false;
    if (m) {
      const id = m[1]!;
      if (!known.has(id)) {
        known.set(id, await isKnown(id).catch(() => true)); // a failed lookup keeps the file
        if (++lookups % 50 === 0) await new Promise((r) => setImmediate(r));
      }
      keep = known.get(id)!;
    }
    if (!keep && (await rm(path.join(dir, name), { force: true }).then(() => true, () => false))) removed++;
  }
  return removed;
}

/** Drops every thumbnail of a library (after "Rebuild index"). */
export async function clearThumbs(localDataDir: string, libraryId: string): Promise<void> {
  await rm(thumbDir(localDataDir, libraryId), { recursive: true, force: true }).catch(() => {});
}
