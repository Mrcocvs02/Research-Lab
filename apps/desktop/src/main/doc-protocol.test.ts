import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, documentRecordSchema } from '@rl/core';
import { createDocHandler, parseRange } from './doc-protocol.js';
import { presentPdf } from './ipc/handlers/doc-files.js';
import type { MainServices } from './ipc/handlers/services.js';

const NOW = '2026-01-02T03:04:05.000Z';
const ORIGIN = 'rl-app://app';
const hex = (n: number) => n.toString(16).padStart(16, '0');
const rec = (n: number, over: Record<string, unknown> = {}) =>
  documentRecordSchema.parse({ id: hex(n), hash: 'a'.repeat(64), path: `papers/f${n}.pdf`, size: 10, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, ...over });

// 1000 bytes, recognisable per offset.
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(Array.from({ length: 991 }, (_, i) => 65 + (i % 26)))]);

let root: string;
let outside: string;
let records: Map<string, ReturnType<typeof rec>>;
let activeLibrary: string | null;
let otherLibraryDocs: Set<string>;

function handler() {
  const services = {
    runtime: {
      require: async () => {
        if (!activeLibrary) throw new AppError('LIBRARY_NOT_ACTIVE', 'No active library');
        return {
          libraryId: activeLibrary,
          getDocument: async (id: string) => {
            const r = records.get(id);
            if (!r || otherLibraryDocs.has(id) !== (activeLibrary === 'other')) throw new AppError('NOT_FOUND', 'Unknown document');
            return r;
          },
        };
      },
    },
    libraries: { profile: async () => ({ rootPath: root }) },
  } as unknown as MainServices;
  return createDocHandler({ resolve: (id) => presentPdf(services, id as never), allowedOrigin: () => ORIGIN });
}

const get = (id: string, headers: Record<string, string> = {}, method = 'GET') =>
  handler()(new Request(`rl-doc://doc/${id}?v=aaaaaaaa`, { method, headers: { origin: ORIGIN, ...headers } }));
const bytes = async (r: Response) => Buffer.from(await r.arrayBuffer());

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rl-doc-'));
  outside = await mkdtemp(path.join(os.tmpdir(), 'rl-doc-out-'));
  await mkdir(path.join(root, 'papers'), { recursive: true });
  await writeFile(path.join(root, 'papers', 'f1.pdf'), PDF);
  await writeFile(path.join(root, 'papers', 'f2.pdf'), 'this is plain text, not a pdf at all');
  await writeFile(path.join(root, 'papers', 'f3.txt'), PDF);
  await writeFile(path.join(outside, 'secret.pdf'), PDF);
  records = new Map([
    [hex(1), rec(1)],
    [hex(2), rec(2)],
    [hex(3), rec(3, { path: 'papers/f3.txt' })],
    [hex(4), rec(4)], // file absent
    [hex(5), rec(5, { missing: true })],
    [hex(6), rec(6, { path: 'link/secret.pdf' })],
  ]);
  activeLibrary = 'lib-1';
  otherLibraryDocs = new Set();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  await rm(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('parseRange', () => {
  it('reads one range and ignores the rest', () => {
    expect(parseRange('bytes=0-9', 100)).toEqual({ kind: 'range', start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ kind: 'range', start: 90, end: 99 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ kind: 'range', start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ kind: 'range', start: 90, end: 99 });
    expect(parseRange('bytes=-500', 100)).toEqual({ kind: 'range', start: 0, end: 99 });
    expect(parseRange('bytes=100-', 100)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRange('bytes=-0', 100)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRange('bytes=0-1,5-6', 100)).toEqual({ kind: 'none' });
    expect(parseRange('bytes=9-2', 100)).toEqual({ kind: 'none' });
    expect(parseRange('items=0-1', 100)).toEqual({ kind: 'none' });
    expect(parseRange(null, 100)).toEqual({ kind: 'none' });
  });
});

describe('rl-doc protocol', () => {
  it('sends the whole file with the right headers', async () => {
    const r = await get(hex(1));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    expect(r.headers.get('accept-ranges')).toBe('bytes');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('content-length')).toBe('1000');
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect((await bytes(r)).equals(PDF)).toBe(true);
  });

  it('answers byte ranges with 206 and Content-Range', async () => {
    const r = await get(hex(1), { range: 'bytes=100-199' });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe('bytes 100-199/1000');
    expect(r.headers.get('content-length')).toBe('100');
    expect((await bytes(r)).equals(PDF.subarray(100, 200))).toBe(true);

    const tail = await get(hex(1), { range: 'bytes=-20' });
    expect(tail.status).toBe(206);
    expect(tail.headers.get('content-range')).toBe('bytes 980-999/1000');
    expect((await bytes(tail)).equals(PDF.subarray(980))).toBe(true);

    const open = await get(hex(1), { range: 'bytes=990-5000' });
    expect(open.headers.get('content-range')).toBe('bytes 990-999/1000');
    expect((await bytes(open)).equals(PDF.subarray(990))).toBe(true);
  });

  it('answers 416 for a range past the end', async () => {
    const r = await get(hex(1), { range: 'bytes=1000-' });
    expect(r.status).toBe(416);
    expect(r.headers.get('content-range')).toBe('bytes */1000');
  });

  it('answers HEAD without a body', async () => {
    const r = await get(hex(1), {}, 'HEAD');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-length')).toBe('1000');
    expect(await r.text()).toBe('');
  });

  it('refuses what is not a present PDF of the active library, without naming a path', async () => {
    const cases: Array<[string, number]> = [
      [hex(2), 403], // .pdf name, not a PDF inside
      [hex(3), 403], // PDF bytes, not a .pdf name
      [hex(4), 403], // record points to a file that is gone
      [hex(5), 403], // marked missing
      [hex(99), 404], // unknown id
    ];
    for (const [id, status] of cases) {
      const r = await get(id);
      expect([id, r.status]).toEqual([id, status]);
      const body = await r.text();
      expect(body).not.toContain(root);
      expect(body).not.toContain('papers');
    }
    expect((await get('nothex')).status).toBe(404);
    expect((await get('../../etc')).status).toBe(404);
  });

  it('does not serve a document of another library, and looks the library up at every request', async () => {
    expect((await get(hex(1))).status).toBe(200);
    activeLibrary = 'other';
    expect((await get(hex(1))).status).toBe(404);
    activeLibrary = null;
    expect((await get(hex(1))).status).toBe(404);
  });

  it('does not follow a junction or link out of the root', async () => {
    try {
      await symlink(outside, path.join(root, 'link'), 'junction');
    } catch {
      return; // links not allowed on this machine
    }
    const r = await get(hex(6));
    expect(r.status).toBe(403);
    expect(await r.text()).not.toContain('secret');
  });

  it('allows CORS only for the renderer origin', async () => {
    const own = await get(hex(1), { range: 'bytes=0-9' });
    expect(own.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const evil = await get(hex(1), { origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    const nullOrigin = await get(hex(1), { origin: 'null' });
    expect(nullOrigin.status).toBe(403);
    // No Origin header (the main process itself): served, but no CORS header.
    const none = await handler()(new Request(`rl-doc://doc/${hex(1)}`));
    expect(none.status).toBe(200);
    expect(none.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers the preflight of a Range request for the renderer only', async () => {
    const ok = await get(hex(1), { 'access-control-request-headers': 'range' }, 'OPTIONS');
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-headers')).toBe('Range');
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect((await get(hex(1), { origin: 'https://evil.example' }, 'OPTIONS')).status).toBe(403);
  });

  it('refuses other methods and other URL shapes', async () => {
    expect((await get(hex(1), {}, 'POST')).status).toBe(405);
    const h = handler();
    expect((await h(new Request(`rl-doc://other/${hex(1)}`, { headers: { origin: ORIGIN } }))).status).toBe(404);
    expect((await h(new Request(`rl-doc://doc/${hex(1)}/extra`, { headers: { origin: ORIGIN } }))).status).toBe(404);
    expect((await h(new Request(`rl-doc://doc/`, { headers: { origin: ORIGIN } }))).status).toBe(404);
  });
});
