import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, channels, createDispatcher, createMemoryLogger, documentRecordSchema, type DocumentId } from '@rl/core';
import { createLibraryStore, type FileLibraryStore } from '@rl/data';
import { buildHandlers, type MainServices } from './ipc/handlers/index.js';
import { createThumbHandler } from './thumb-protocol.js';
import { nativeTuning, pageBox, thumbDir, type NativeImageLike } from './thumbs.js';

const NOW = '2026-01-02T03:04:05.000Z';
// A new hash per test: what the shell answered is remembered per document and content for the whole session.
let H1 = '';
const hex = (n: number) => n.toString(16).padStart(16, '0');
const doc = (n: number, over: Record<string, unknown> = {}) =>
  documentRecordSchema.parse({ id: hex(n), hash: H1, path: `papers/f${n}.pdf`, size: 10, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, title: `Paper ${n}`, ...over });
const PDF = Buffer.from('%PDF-1.4\nbody\n%%EOF\n');

type Pixel = [number, number, number, number]; // b, g, r, a
/** A fake NativeImage over a generated BGRA bitmap. */
function fakeImage(w: number, h: number, pixel: (x: number, y: number) => Pixel, onJpeg?: (rect: unknown) => void, rect: { x: number; y: number; width: number; height: number } | null = null): NativeImageLike {
  const img: NativeImageLike = {
    isEmpty: () => w === 0 || h === 0,
    getSize: () => ({ width: w, height: h }),
    toBitmap: () => {
      const b = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b.set(pixel(x, y), (y * w + x) * 4);
      return b;
    },
    crop: (r) => fakeImage(r.width, r.height, (x, y) => pixel(x + r.x, y + r.y), onJpeg, r),
    toJPEG: () => {
      onJpeg?.(rect);
      return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    },
  };
  return img;
}
/** A white page with dark "text" lines. */
const pageAt = (x: number, y: number): Pixel => (y % 8 < 2 && x % 20 < 14 && x > 10 ? [40, 40, 40, 255] : [255, 255, 255, 255]);
const page = (w = 180, h = 256, onJpeg?: (r: unknown) => void) => fakeImage(w, h, pageAt, onJpeg);
/** A page centred in a 256 x 256 square with transparent bands. */
const letterboxed = (onJpeg?: (r: unknown) => void) => fakeImage(256, 256, (x, y) => (x < 38 || x >= 218 ? [0, 0, 0, 0] : pageAt(x, y)), onJpeg);
/** A file-type icon: a square, transparent corners and margins, flat coloured shape. */
const icon = () =>
  fakeImage(256, 256, (x, y) => {
    const inside = x > 40 && x < 216 && y > 20 && y < 236 && !(x > 160 && y < 70);
    return inside ? [40, 40, 200, 255] : [0, 0, 0, 0];
  });

let root: string;
let outside: string;
let local: string;
let store: FileLibraryStore;
let dispatch: ReturnType<typeof createDispatcher>;
let native: ReturnType<typeof vi.fn> | undefined;

function services(): MainServices {
  const rt = {
    libraryId: 'lib-1',
    getDocument: async (id: string) => {
      const r = await store.documents.get(id as DocumentId);
      if (!r) throw new AppError('NOT_FOUND', 'Unknown document');
      return r;
    },
  };
  return {
    log: createMemoryLogger(),
    localDataDir: local,
    emit: () => {},
    ...(native ? { nativeThumbnail: native as unknown as MainServices['nativeThumbnail'] } : {}),
    runtime: { sync: async () => {}, hold: () => () => {}, status: () => ({}), require: async () => rt },
    libraries: { profile: async () => ({ rootPath: root, id: 'lib-1' }) },
  } as unknown as MainServices;
}
const askNative = async (id: string) => dispatch('thumbs:native', { docId: id });
const data = async (id: string) => {
  const r = await askNative(id);
  if (!r.ok) throw new Error(`${r.error.code}`);
  return r.data as { url: string | null; reason: string };
};
const files = async () => (await readdir(thumbDir(local, 'lib-1')).catch(() => [])).sort();

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rl-nat-'));
  outside = await mkdtemp(path.join(os.tmpdir(), 'rl-nat-out-'));
  local = await mkdtemp(path.join(os.tmpdir(), 'rl-nat-local-'));
  H1 = randomBytes(32).toString('hex');
  store = createLibraryStore({ rootPath: root, deviceId: 'dev-1' });
  await store.init();
  await mkdir(path.join(root, 'papers'), { recursive: true });
  await writeFile(path.join(root, 'papers', 'f1.pdf'), PDF);
  await writeFile(path.join(root, 'papers', 'f3.txt'), PDF);
  await writeFile(path.join(root, 'papers', 'f2.pdf'), 'not a pdf');
  await writeFile(path.join(root, 'papers', 'f4.pdf'), PDF);
  await writeFile(path.join(outside, 'secret.pdf'), PDF);
  await store.documents.put(doc(1));
  await store.documents.put(doc(2));
  await store.documents.put(doc(3, { path: 'papers/f3.txt' }));
  await store.documents.put(doc(4));
  native = vi.fn(async () => page());
  dispatch = createDispatcher(channels, buildHandlers(services()), createMemoryLogger());
});
afterEach(async () => {
  vi.useRealTimers();
  for (const d of [root, outside, local]) await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('page or icon', () => {
  it('a page is a page, also letterboxed in transparent bands (the box is trimmed)', () => {
    expect(pageBox(page())).toEqual({ x: 0, y: 0, width: 180, height: 256 });
    const box = pageBox(letterboxed())!;
    expect(box.x).toBeGreaterThanOrEqual(36);
    expect(box.x + box.width).toBeLessThanOrEqual(222);
    expect(box.height).toBe(256);
  });
  it('an icon, an empty image, a uniform image and a dark image are not pages', () => {
    expect(pageBox(icon())).toBeNull();
    expect(pageBox(fakeImage(0, 0, () => [0, 0, 0, 0]))).toBeNull();
    expect(pageBox(fakeImage(200, 200, () => [0, 0, 0, 0]))).toBeNull();
    expect(pageBox(fakeImage(200, 260, () => [255, 255, 255, 255]))).toBeNull();
    expect(pageBox(fakeImage(200, 260, (x) => (x % 2 ? [10, 10, 10, 255] : [30, 30, 30, 255])))).toBeNull();
  });
});

describe('thumbs:native', () => {
  it('a page from the system is cached as .jpg and the url comes back; list then returns it', async () => {
    const r = await data(hex(1));
    expect(r).toEqual({ url: `rl-thumb://thumb/${hex(1)}?v=${H1.slice(0, 8)}`, reason: 'ok' });
    expect(await files()).toEqual([`${hex(1)}-${H1.slice(0, 8)}.jpg`]);
    expect(native).toHaveBeenCalledWith(expect.stringContaining('f1.pdf'), 256);
    const l = await dispatch('thumbs:list', { docIds: [hex(1)] });
    expect(l.ok && (l.data as any).items[0]).toMatchObject({ url: r.url, drawable: false });
    expect((await data(hex(1))).reason).toBe('ok'); // already cached: no second request
    expect(native).toHaveBeenCalledTimes(1);
  });

  it('serves the jpg as image/jpeg with nosniff, and a later drawn webp replaces it', async () => {
    await data(hex(1));
    const h = createThumbHandler({ dir: async () => thumbDir(local, 'lib-1'), allowedOrigin: () => 'rl-app://app' });
    const res = await h(new Request(`rl-thumb://thumb/${hex(1)}?v=${H1.slice(0, 8)}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const webp = new Uint8Array(32);
    webp.set(Buffer.from('RIFF'), 0);
    webp.set(Buffer.from('WEBP'), 8);
    expect((await dispatch('thumbs:put', { docId: hex(1), hash: H1, webp })).ok).toBe(true);
    expect(await files()).toEqual([`${hex(1)}-${H1.slice(0, 8)}.webp`]); // one current file per document
    expect((await h(new Request(`rl-thumb://thumb/${hex(1)}?v=${H1.slice(0, 8)}`))).headers.get('content-type')).toBe('image/webp');
  });

  it('a letterboxed page is cropped to its content before it is encoded', async () => {
    const rects: unknown[] = [];
    native = vi.fn(async () => letterboxed((r) => rects.push(r)));
    dispatch = createDispatcher(channels, buildHandlers(services()), createMemoryLogger());
    expect((await data(hex(1))).reason).toBe('ok');
    expect(rects[0]).toMatchObject({ height: 256 });
    expect((rects[0] as { width: number }).width).toBeLessThan(256);
  });

  it('a call that throws is failed, and the shell is not asked again this session', async () => {
    native = vi.fn(async () => {
      throw new Error('no handler');
    });
    dispatch = createDispatcher(channels, buildHandlers(services()), createMemoryLogger());
    expect(await data(hex(1))).toEqual({ url: null, reason: 'failed' });
    expect(await data(hex(1))).toEqual({ url: null, reason: 'failed' });
    expect(native).toHaveBeenCalledTimes(1);
    expect(await files()).toEqual([]);
  });

  it('a call that never answers times out as failed', async () => {
    nativeTuning.timeoutMs = 40;
    native = vi.fn(() => new Promise(() => {}));
    dispatch = createDispatcher(channels, buildHandlers(services()), createMemoryLogger());
    expect(await data(hex(1))).toEqual({ url: null, reason: 'failed' });
    nativeTuning.timeoutMs = 5000;
    native = vi.fn(async () => page());
    dispatch = createDispatcher(channels, buildHandlers(services()), createMemoryLogger());
    expect((await data(hex(4))).reason).toBe('ok'); // the queue went on after the timeout
  });

  it('an icon or an empty image is generic, remembered, and nothing is cached', async () => {
    native = vi.fn(async () => icon());
    dispatch = createDispatcher(channels, buildHandlers(services()), createMemoryLogger());
    expect(await data(hex(1))).toEqual({ url: null, reason: 'generic' });
    expect(await data(hex(1))).toEqual({ url: null, reason: 'generic' });
    expect(native).toHaveBeenCalledTimes(1);
    native = vi.fn(async () => fakeImage(0, 0, () => [0, 0, 0, 0]));
    dispatch = createDispatcher(channels, buildHandlers(services()), createMemoryLogger());
    expect((await data(hex(4))).reason).toBe('generic');
    expect(await files()).toEqual([]);
  });

  it('a uniform image is generic', async () => {
    native = vi.fn(async () => fakeImage(256, 256, () => [255, 255, 255, 255]));
    dispatch = createDispatcher(channels, buildHandlers(services()), createMemoryLogger());
    expect((await data(hex(4))).reason).toBe('generic');
  });

  it('a platform without the API is unsupported', async () => {
    native = undefined;
    dispatch = createDispatcher(channels, buildHandlers(services()), createMemoryLogger());
    expect(await data(hex(1))).toEqual({ url: null, reason: 'unsupported' });
  });

  it('refuses non-PDFs, renamed files, unknown ids and files outside the library, without asking the shell', async () => {
    for (const n of [3, 2, 99]) {
      const r = await askNative(hex(n));
      expect([n, r.ok]).toEqual([n, false]);
    }
    expect(native).not.toHaveBeenCalled();
    // A junction (or link) inside the library that leads outside it: the real target decides, and it is outside.
    const link = path.join(root, 'papers', 'out');
    const made = await symlink(outside, link, 'junction').then(() => true, () => false);
    if (made) {
      await store.documents.put(doc(6, { path: 'papers/out/secret.pdf' }));
      expect((await askNative(hex(6))).ok).toBe(false);
      expect(native).not.toHaveBeenCalled();
    }
  });

  it('a file that changed meanwhile stores nothing', async () => {
    native = vi.fn(async () => {
      await store.documents.put(doc(1, { hash: 'cd'.repeat(32) }));
      return page();
    });
    dispatch = createDispatcher(channels, buildHandlers(services()), createMemoryLogger());
    expect(await data(hex(1))).toEqual({ url: null, reason: 'failed' });
    expect(await files()).toEqual([]);
  });

  it('asks the shell one request at a time', async () => {
    let live = 0;
    let max = 0;
    native = vi.fn(async () => {
      max = Math.max(max, ++live);
      await new Promise((r) => setTimeout(r, 15));
      live--;
      return page();
    });
    dispatch = createDispatcher(channels, buildHandlers(services()), createMemoryLogger());
    await Promise.all([askNative(hex(1)), askNative(hex(4))]);
    expect(native).toHaveBeenCalledTimes(2);
    expect(max).toBe(1);
  });
});
