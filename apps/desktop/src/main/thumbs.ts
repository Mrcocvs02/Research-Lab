import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError, THUMB_LIMITS, THUMB_SCHEME, type DocumentId } from '@rl/core';
import { openPdfHandle, presentPdf } from './ipc/handlers/doc-files.js';
import type { MainServices } from './ipc/handlers/services.js';

/**
 * Grid thumbnails (D-194, D-196): small WebP images of the first page of a PDF, drawn by the renderer and kept in the
 * machine-local cache `<localData>/thumbs/<libraryId>/<docId>-<hash8>.webp`. They are rebuildable and never leave the
 * machine. The name carries the first 8 hex of the content hash, so a changed file simply has no thumbnail yet.
 */
/** A file of the cache folder: a thumbnail or a temporary file of a write in progress. */
const THUMB_ANY = /^([0-9a-f]{16})-([0-9a-f]{8})\.(?:webp|jpg)(\.[0-9a-f]+\.tmp)?$/;
export type ThumbExt = 'webp' | 'jpg';
const LIBRARY_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type ThumbServices = Pick<MainServices, 'runtime' | 'libraries'> & { localDataDir: string; nativeThumbnail?: MainServices['nativeThumbnail'] };

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
    if (files.has(`${docId}-${pdf.hash.slice(0, 8)}.webp`) || files.has(`${docId}-${pdf.hash.slice(0, 8)}.jpg`)) {
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
 * Stores an image for the content with `hash` as `<docId>-<hash8>.<ext>`. Nothing is stored (and the answer is `null`)
 * when the document is no longer a present PDF or its hash has changed since the image was made. The write is atomic
 * (temporary file, then rename) and removes the older files of the same document, of either format.
 */
async function storeThumb(s: ThumbServices, docId: string, hash: string, ext: ThumbExt, bytes: Uint8Array): Promise<string | null> {
  const rt = await s.runtime.require();
  const dir = thumbDir(s.localDataDir, rt.libraryId);
  return serial(`${rt.libraryId}/${docId}`, async () => {
    const pdf = await presentPdf(s, docId as DocumentId).catch(() => null);
    if (!pdf || pdf.hash !== hash) return null;
    await mkdir(dir, { recursive: true });
    const final = `${docId}-${hash.slice(0, 8)}.${ext}`;
    const tmp = `${final}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await writeFile(path.join(dir, tmp), bytes);
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

/** `thumbs:put`: a WebP drawn by the renderer (the schema already checked magic and size). */
export const putThumb = (s: ThumbServices, docId: string, hash: string, webp: Uint8Array): Promise<string | null> => storeThumb(s, docId, hash, 'webp', webp);

// ---- the thumbnail of the operating system (D-195)

/** What of Electron's `NativeImage` the analysis uses (a fake in tests). */
export interface NativeImageLike {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  /** BGRA, 4 bytes per pixel, row by row. */
  toBitmap(): Uint8Array;
  crop(rect: { x: number; y: number; width: number; height: number }): NativeImageLike;
  toJPEG(quality: number): Uint8Array;
}
export type NativeReason = 'ok' | 'unsupported' | 'failed' | 'generic';
export const NATIVE_SIZE = 256;
/** `timeoutMs` is a variable only so that a test does not wait 5 s. */
export const nativeTuning = { timeoutMs: 5000 };
const JPEG_QUALITY = 80;

/**
 * Tells a page from an icon. A rendered PDF page is opaque, mostly light and not one colour; the file-type icon the
 * shell falls back to has transparent corners and margins, or is a flat shape. The image (at most `NATIVE_SIZE` a
 * side, so a sample grid of about 64 by 64 points is cheap) is sampled: first the box of the visible content (a page
 * is often letterboxed in transparent bands, which are trimmed), then inside that box the share of transparent
 * samples (an icon has many), the mean brightness (a page is mostly white) and the spread of brightness (a uniform
 * image is no page). Returns the content box when it looks like a page, else `null`.
 */
export function pageBox(img: NativeImageLike): { x: number; y: number; width: number; height: number } | null {
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const px = img.toBitmap();
  if (width < 8 || height < 8 || px.byteLength < width * height * 4) return null;
  const step = Math.max(1, Math.floor(Math.max(width, height) / 64));
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (px[(y * width + x) * 4 + 3]! < 200) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const box = { x: x0, y: y0, width: Math.min(width - x0, x1 - x0 + step), height: Math.min(height - y0, y1 - y0 + step) };
  if (box.width < 8 || box.height < 8) return null;
  let n = 0;
  let clear = 0;
  let sum = 0;
  let sumSq = 0;
  let light = 0;
  for (let y = box.y; y < box.y + box.height; y += step) {
    for (let x = box.x; x < box.x + box.width; x += step) {
      n++;
      const i = (y * width + x) * 4;
      if (px[i + 3]! < 200) {
        clear++;
        continue;
      }
      const lum = 0.114 * px[i]! + 0.587 * px[i + 1]! + 0.299 * px[i + 2]!;
      sum += lum;
      sumSq += lum * lum;
      if (lum > 190) light++;
    }
  }
  const seen = n - clear;
  if (seen === 0 || clear / n > 0.1) return null; // an icon: transparent corners and margins inside its box
  const mean = sum / seen;
  const sd = Math.sqrt(Math.max(0, sumSq / seen - mean * mean));
  if (sd < 6) return null; // one colour
  if (light / seen < 0.35) return null; // not a white-ish page
  return box;
}

/** One request to the shell at a time. */
let nativeTail: Promise<unknown> = Promise.resolve();
const nativeOnce = <T>(task: () => Promise<T>): Promise<T> => {
  const next = nativeTail.then(task, task);
  nativeTail = next.catch(() => {});
  return next;
};
/** What the shell said for a document and content, this session: it is not asked again. */
const nativeMemo = new Map<string, NativeReason>();

/** `thumbs:native`. A shell problem never throws: the answer carries the reason and the renderer draws instead. */
export async function nativeThumb(s: ThumbServices, docId: string): Promise<{ url: string | null; reason: NativeReason }> {
  const rt = await s.runtime.require();
  const pdf = await presentPdf(s, docId as DocumentId); // refuses a non-PDF, a missing file, a path outside the root
  const opened = await openPdfHandle(pdf.abs);
  if (typeof opened === 'string') throw new AppError('PERMISSION_DENIED', 'Only PDF files have thumbnails', { reason: opened });
  await opened.fh.close().catch(() => {});
  const dir = thumbDir(s.localDataDir, rt.libraryId);
  const final = `${docId}-${pdf.hash.slice(0, 8)}`;
  const have = new Set(await names(dir));
  if (have.has(`${final}.jpg`) || have.has(`${final}.webp`)) return { url: thumbUrl(docId, pdf.hash), reason: 'ok' };
  const key = `${rt.libraryId}/${docId}/${pdf.hash}`;
  const known = nativeMemo.get(key);
  if (known && known !== 'ok') return { url: null, reason: known };
  const remember = (reason: Exclude<NativeReason, 'ok'>) => {
    nativeMemo.set(key, reason);
    return { url: null, reason };
  };
  const ask = s.nativeThumbnail;
  if (!ask) return remember('unsupported');
  let img: NativeImageLike | null;
  try {
    img = await nativeOnce(() => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), nativeTuning.timeoutMs)));
      return Promise.race([ask(pdf.abs, NATIVE_SIZE), timeout]).finally(() => clearTimeout(timer));
    });
  } catch {
    return remember('failed');
  }
  if (!img) return remember('failed');
  let jpeg: Uint8Array;
  try {
    const box = pageBox(img);
    if (!box) return remember('generic');
    const { width, height } = img.getSize();
    const page = box.x === 0 && box.y === 0 && box.width >= width && box.height >= height ? img : img.crop(box);
    jpeg = page.toJPEG(JPEG_QUALITY);
  } catch {
    return remember('failed');
  }
  if (jpeg.byteLength === 0 || jpeg.byteLength > THUMB_LIMITS.maxBytes * 4) return remember('failed');
  const url = await storeThumb(s, docId, pdf.hash, 'jpg', jpeg);
  return url ? { url, reason: 'ok' } : { url: null, reason: 'failed' };
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
  try {
    await rm(thumbDir(localDataDir, libraryId), { recursive: true, force: true });
  } catch {
    // a cache: it is made again when needed
  }
}
