import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, THUMB_LIMITS, channels, createDispatcher, createMemoryLogger, documentRecordSchema, type DocumentId } from '@rl/core';
import { createLibraryStore, type FileLibraryStore } from '@rl/data';
import { buildHandlers, type MainServices } from './ipc/handlers/index.js';
import { thumbDir, pruneThumbs, clearThumbs } from './thumbs.js';
import { createThumbHandler } from './thumb-protocol.js';

const NOW = '2026-01-02T03:04:05.000Z';
const H1 = 'ab'.repeat(32);
const H2 = 'cd'.repeat(32);
const hex = (n: number) => n.toString(16).padStart(16, '0');
const doc = (n: number, over: Record<string, unknown> = {}) =>
  documentRecordSchema.parse({ id: hex(n), hash: H1, path: `papers/f${n}.pdf`, size: 10, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, title: `Paper ${n}`, ...over });
const PDF = Buffer.from('%PDF-1.4\nbody\n%%EOF\n');
const webp = (extra = 20) => {
  const b = new Uint8Array(12 + extra);
  b.set(Buffer.from('RIFF'), 0);
  b.set(Buffer.from('WEBP'), 8);
  return b;
};

let root: string;
let local: string;
let store: FileLibraryStore;
let libraryId: string;

function services(): MainServices {
  const rt = {
    get libraryId() {
      return libraryId;
    },
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
    runtime: { sync: async () => {}, hold: () => () => {}, status: () => ({}), require: async () => rt },
    libraries: { profile: async () => ({ rootPath: root, id: libraryId }) },
  } as unknown as MainServices;
}
// One dispatcher per test, like the app: the cleanup runs once per library and session.
let dispatch: ReturnType<typeof createDispatcher>;
const call = async (c: string, p: unknown) => dispatch(c, p);
const list = async (ids: string[]) => {
  const r = await call('thumbs:list', { docIds: ids });
  if (!r.ok) throw new Error(r.error.message);
  return (r.data as { items: Array<{ docId: string; url: string | null; drawable: boolean; hash?: string }> }).items;
};
const put = async (id: string, hash: string, bytes: Uint8Array = webp()) => call('thumbs:put', { docId: id, hash, webp: bytes });
const dir = () => thumbDir(local, libraryId);
const files = async () => (await readdir(dir()).catch(() => [])).sort();

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rl-thumbs-'));
  local = await mkdtemp(path.join(os.tmpdir(), 'rl-thumbs-local-'));
  libraryId = 'lib-1';
  store = createLibraryStore({ rootPath: root, deviceId: 'dev-1' });
  await store.init();
  dispatch = createDispatcher(channels, buildHandlers(services()), createMemoryLogger());
  await mkdir(path.join(root, 'papers'), { recursive: true });
  await writeFile(path.join(root, 'papers', 'f1.pdf'), PDF);
  await writeFile(path.join(root, 'papers', 'f2.pdf'), 'not a pdf');
  await writeFile(path.join(root, 'papers', 'f3.txt'), PDF);
  await store.documents.put(doc(1));
  await store.documents.put(doc(2));
  await store.documents.put(doc(3, { path: 'papers/f3.txt' }));
  await store.documents.put(doc(4)); // no file on disk
  await store.documents.put(doc(5, { missing: true }));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  await rm(local, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('thumbs:list', () => {
  it('a present PDF without a thumbnail is drawable and carries its hash', async () => {
    expect(await list([hex(1)])).toEqual([{ docId: hex(1), url: null, drawable: true, hash: H1 }]);
  });

  it('a cached thumbnail of the current content comes back as a URL, not drawable', async () => {
    expect((await put(hex(1), H1)).ok).toBe(true);
    expect(await list([hex(1)])).toEqual([{ docId: hex(1), url: `rl-thumb://thumb/${hex(1)}?v=${H1.slice(0, 8)}`, drawable: false, hash: H1 }]);
  });

  it('neither a URL nor drawable for non-PDF, missing, renamed, unknown and absent files', async () => {
    const items = await list([hex(3), hex(4), hex(5), hex(2), hex(99)]);
    expect(items.map((i) => [i.url, i.drawable])).toEqual([
      [null, false],
      [null, false],
      [null, false],
      [null, false], // .pdf by name but no %PDF- header
      [null, false],
    ]);
    expect(items.every((i) => i.hash === undefined)).toBe(true);
  });

  it('a changed hash ignores the old image and asks for a new one', async () => {
    await put(hex(1), H1);
    await store.documents.put(doc(1, { hash: H2 }));
    expect(await list([hex(1)])).toEqual([{ docId: hex(1), url: null, drawable: true, hash: H2 }]);
  });

  it('refuses more than the batch and an empty list (schema)', async () => {
    expect((await call('thumbs:list', { docIds: [] })).ok).toBe(false);
    expect((await call('thumbs:list', { docIds: Array.from({ length: THUMB_LIMITS.batch + 1 }, (_, i) => hex(i)) })).ok).toBe(false);
  });
});

describe('thumbs:put', () => {
  it('stores the image under <docId>-<hash8>.webp and answers its URL', async () => {
    const r = await put(hex(1), H1);
    expect(r.ok && r.data).toEqual({ url: `rl-thumb://thumb/${hex(1)}?v=${H1.slice(0, 8)}` });
    expect(await files()).toEqual([`${hex(1)}-${H1.slice(0, 8)}.webp`]);
  });

  it('a stale hash stores nothing and answers null', async () => {
    const r = await put(hex(1), H2);
    expect(r.ok && r.data).toEqual({ url: null });
    expect(await files()).toEqual([]);
  });

  it('a document that is not a present PDF stores nothing', async () => {
    for (const n of [3, 4, 5, 99]) {
      const r = await put(hex(n), H1);
      expect(r.ok && r.data).toEqual({ url: null });
    }
    expect(await files()).toEqual([]);
  });

  it('removes the older files of the same document, and only of that one', async () => {
    await put(hex(1), H1);
    const other = `${hex(7)}-11111111.webp`;
    await writeFile(path.join(dir(), other), webp());
    await writeFile(path.join(dir(), `${hex(1)}-deadbeef.webp`), webp());
    await writeFile(path.join(dir(), `${hex(1)}-deadbeef.webp.0a0b.tmp`), webp());
    await store.documents.put(doc(1, { hash: H2 }));
    await put(hex(1), H2);
    expect(await files()).toEqual([`${hex(1)}-${H2.slice(0, 8)}.webp`, other].sort());
  });

  it('leaves no temporary file behind, even with concurrent writes', async () => {
    await Promise.all([put(hex(1), H1), put(hex(1), H1), put(hex(1), H1)]);
    expect(await files()).toEqual([`${hex(1)}-${H1.slice(0, 8)}.webp`]);
  });

  it('the schema refuses a wrong magic, a short file and an oversized one', async () => {
    const bad = webp();
    bad[8] = 0;
    expect((await put(hex(1), H1, bad)).ok).toBe(false);
    expect((await put(hex(1), H1, new Uint8Array(8))).ok).toBe(false);
    expect((await put(hex(1), H1, webp(THUMB_LIMITS.maxBytes))).ok).toBe(false);
    expect((await put(hex(1), H1, webp(THUMB_LIMITS.maxBytes - 12))).ok).toBe(true);
  });
});

describe('cleanup', () => {
  it('prunes the thumbnails of unknown documents and stray files, in the background after the first list', async () => {
    await put(hex(1), H1);
    await writeFile(path.join(dir(), `${hex(99)}-11111111.webp`), webp());
    await writeFile(path.join(dir(), 'notes.txt'), 'x');
    await list([hex(1)]);
    await expect.poll(files).toEqual([`${hex(1)}-${H1.slice(0, 8)}.webp`]);
  });

  it('pruneThumbs keeps a file when the lookup fails and a missing folder is fine', async () => {
    expect(await pruneThumbs(local, 'lib-none', async () => false)).toBe(0);
    await mkdir(dir(), { recursive: true });
    await writeFile(path.join(dir(), `${hex(1)}-11111111.webp`), webp());
    expect(await pruneThumbs(local, libraryId, async () => Promise.reject(new Error('x')))).toBe(0);
    expect(await pruneThumbs(local, libraryId, async () => false)).toBe(1);
  });

  it('clearThumbs removes the folder of one library only', async () => {
    await put(hex(1), H1);
    await mkdir(thumbDir(local, 'lib-2'), { recursive: true });
    await clearThumbs(local, libraryId);
    expect(await files()).toEqual([]);
    expect(await readdir(thumbDir(local, 'lib-2'))).toEqual([]);
  });

  it('a library id that could leave the cache folder is refused', () => {
    expect(() => thumbDir(local, '../x')).toThrow();
  });
});

describe('rl-thumb protocol', () => {
  const ORIGIN = 'rl-app://app';
  const handler = () => createThumbHandler({ dir: async () => dir(), allowedOrigin: () => ORIGIN });
  const get = (url: string, init: RequestInit = {}) => handler()(new Request(url, init));
  const u = (id: string, v = H1.slice(0, 8)) => `rl-thumb://thumb/${id}?v=${v}`;

  it('serves the image as image/webp with nosniff', async () => {
    await put(hex(1), H1);
    const res = await get(u(hex(1)));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(webp());
    expect((await get(u(hex(1)), { method: 'HEAD' })).status).toBe(200);
  });

  it('answers 404 for everything else, with a fixed text', async () => {
    await put(hex(1), H1);
    const bad = [
      u(hex(2)), // no such file
      u(hex(1), 'ffffffff'), // another content
      u(hex(1), 'xyz'),
      `rl-thumb://thumb/${hex(1)}`, // no version
      `rl-thumb://other/${hex(1)}?v=${H1.slice(0, 8)}`,
      `rl-thumb://thumb/${hex(1)}/extra?v=${H1.slice(0, 8)}`,
      `rl-thumb://thumb/..%2F..%2Fx?v=${H1.slice(0, 8)}`,
      `rl-thumb://thumb/${hex(10).toUpperCase()}?v=${H1.slice(0, 8)}`,
      'rl-thumb://thumb/',
    ];
    for (const url of bad) {
      const res = await get(url);
      expect([url, res.status]).toEqual([url, 404]);
      expect(await res.text()).toBe('Not found');
    }
  });

  it('does not serve the thumbnails of another library, nor anything without a library', async () => {
    await put(hex(1), H1);
    const other = createThumbHandler({ dir: async () => thumbDir(local, 'lib-2'), allowedOrigin: () => ORIGIN });
    expect((await other(new Request(u(hex(1))))).status).toBe(404);
    const none = createThumbHandler({ dir: async () => null, allowedOrigin: () => ORIGIN });
    expect((await none(new Request(u(hex(1))))).status).toBe(404);
    const broken = createThumbHandler({ dir: async () => Promise.reject(new Error('x')), allowedOrigin: () => ORIGIN });
    expect((await broken(new Request(u(hex(1))))).status).toBe(404);
  });

  it('refuses a foreign origin and non-read methods; accepts the renderer origin', async () => {
    await put(hex(1), H1);
    expect((await get(u(hex(1)), { headers: { origin: 'https://example.org' } })).status).toBe(403);
    expect((await get(u(hex(1)), { headers: { origin: ORIGIN } })).status).toBe(200);
    expect((await get(u(hex(1)), { method: 'POST', body: 'x' })).status).toBe(405);
  });

  it('does not serve a file larger than the limit, nor a directory with the name', async () => {
    await mkdir(path.join(dir(), `${hex(5)}-${H1.slice(0, 8)}.webp`), { recursive: true });
    expect((await get(u(hex(5)))).status).toBe(404);
    await writeFile(path.join(dir(), `${hex(6)}-${H1.slice(0, 8)}.webp`), Buffer.alloc(THUMB_LIMITS.maxBytes + 1));
    expect((await get(u(hex(6)))).status).toBe(404);
  });
});
