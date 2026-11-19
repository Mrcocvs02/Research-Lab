import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MainServices } from '../../ipc/handlers/services.js';
import { checkPublicUrl, checkResolved, isPrivateAddress } from './guard.js';
import { loadPreview, parseHead, PREVIEW_MAX_BYTES, PreviewError } from './preview.js';
import { addReferences, addResource, listResources, openResource, previewResource, removeResource, updateResource } from './service.js';

describe('checkPublicUrl', () => {
  it('accepts http and https on public names', () => {
    expect(checkPublicUrl('https://example.org/a?b=1').ok).toBe(true);
    expect(checkPublicUrl('http://sub.example.org').ok).toBe(true);
  });
  it.each(['file:///x', 'ftp://example.org/x', 'javascript:alert(1)', 'data:text/html,hi', 'mailto:a@example.org'])('refuses %s', (u) => {
    const v = checkPublicUrl(u);
    expect(v.ok).toBe(false);
  });
  it.each(['http://localhost/x', 'http://127.0.0.1/x', 'http://[::1]/x', 'http://10.1.2.3/', 'http://192.168.0.5/', 'http://172.16.0.1/', 'http://169.254.169.254/', 'http://printer/', 'http://nas.local/', 'http://x.internal/', 'http://0x7f000001/', 'http://2130706433/', 'http://[::ffff:127.0.0.1]/', 'http://[fd00::1]/'])('refuses the private host %s', (u) => {
    expect(checkPublicUrl(u)).toEqual({ ok: false, reason: 'private-host' });
  });
  it('refuses credentials in the address', () => {
    expect(checkPublicUrl('https://user:pw@example.org/')).toEqual({ ok: false, reason: 'credentials' });
  });
  it('knows private addresses and checks resolved names', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('100.64.0.1')).toBe(true);
    expect(checkResolved(['93.184.216.34'])).toBe(true);
    expect(checkResolved(['93.184.216.34', '10.0.0.1'])).toBe(false);
    expect(checkResolved([])).toBe(false);
  });
});

describe('parseHead', () => {
  it('reads the title and the description meta and nothing else', () => {
    const r = parseHead('<html><head><title> A &amp; B\n page </title><meta name="description" content="Short &quot;text&quot;"><script>alert(1)</script></head></html>');
    expect(r).toEqual({ title: 'A & B page', description: 'Short "text"' });
  });
  it('falls back to og:description and drops control characters', () => {
    const r = parseHead('<title>x‮y</title><meta property="og:description" content=\'one\u0000two\'>');
    expect(r.title).toBe('x y');
    expect(r.description).toBe('one two');
  });
});

describe('loadPreview', () => {
  let server: Server;
  let base = '';
  let seenHeaders: Record<string, unknown> = {};
  beforeAll(async () => {
    server = createServer((req, res) => {
      seenHeaders = req.headers;
      if (req.url === '/big') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.write('<title>Big</title>');
        res.end('x'.repeat(PREVIEW_MAX_BYTES * 2));
      } else if (req.url === '/declared') {
        res.writeHead(200, { 'content-type': 'text/html', 'content-length': String(8 * 1024 * 1024) });
        res.end('<title>T</title>');
      } else if (req.url === '/bin') {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end('png');
      } else if (req.url === '/redirect') {
        res.writeHead(302, { location: 'http://10.0.0.1/secret' });
        res.end();
      } else {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<title>Local page</title><meta name="description" content="d">');
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('sends no cookie or credential and keeps only the title and the description', async () => {
    const r = await loadPreview(`${base}/page`, { fetch, allowLocal: true });
    expect(r).toEqual({ title: 'Local page', description: 'd' });
    expect(seenHeaders['cookie']).toBeUndefined();
    expect(seenHeaders['authorization']).toBeUndefined();
  });
  it('stops reading at the cap', async () => {
    const r = await loadPreview(`${base}/big`, { fetch, allowLocal: true });
    expect(r.title).toBe('Big');
  });
  it('refuses a page that announces too much, and non-HTML', async () => {
    await expect(loadPreview(`${base}/declared`, { fetch, allowLocal: true })).rejects.toMatchObject({ reason: 'too-large' });
    await expect(loadPreview(`${base}/bin`, { fetch, allowLocal: true })).rejects.toMatchObject({ reason: 'not-html' });
  });
  it('refuses the loopback host (the app default) and a redirect to a private one', async () => {
    await expect(loadPreview(`${base}/page`, { fetch })).rejects.toBeInstanceOf(PreviewError);
    const hop = (u: string) => Promise.resolve(u.startsWith('http://public.example') ? new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/x' } }) : new Response('<title>no</title>', { headers: { 'content-type': 'text/html' } }));
    await expect(loadPreview('http://public.example/r', { fetch: hop as unknown as typeof fetch, resolve: async () => ['93.184.216.34'] })).rejects.toMatchObject({ reason: 'refused' });
  });
  it('refuses a name that resolves to a private address', async () => {
    await expect(loadPreview('https://rebind.example/x', { fetch, resolve: async () => ['127.0.0.1'] })).rejects.toMatchObject({ reason: 'refused' });
  });
});

describe('resources of a library', () => {
  let lib: string;
  let data: string;
  let opened: string[];
  let external: string[];
  let s: MainServices;
  let approved: Map<string, string>;
  beforeEach(async () => {
    lib = await mkdtemp(path.join(os.tmpdir(), 'rl-res-'));
    data = path.join(lib, '.data');
    await mkdir(path.join(lib, 'nb'), { recursive: true });
    await writeFile(path.join(lib, 'nb', 'analysis.ipynb'), '{}');
    await writeFile(path.join(lib, 'nb', 'run.exe'), 'x');
    opened = [];
    external = [];
    approved = new Map();
    s = {
      runtime: { require: async () => ({ store: { dataDir: data, rootPath: lib }, libraryId: 'lib1' }) },
      approved: { resolve: (p: string, purpose: string) => (approved.get(p) === purpose ? p : null) },
      emit: () => undefined,
      log: { warn: () => undefined },
      shell: { openPath: async (p: string) => (opened.push(p), ''), openExternal: async (u: string) => void external.push(u), showItemInFolder: () => undefined },
      fetch: (async () => new Response('<title>Remote</title><meta name="description" content="About">', { headers: { 'content-type': 'text/html' } })) as typeof fetch,
    } as unknown as MainServices;
  });
  afterEach(() => rm(lib, { recursive: true, force: true }));

  it('adds, lists, updates and removes a link; a removal leaves everything else alone', async () => {
    const a = await addResource(s, { kind: 'code', url: 'https://example.org/org/repo', docIds: ['d1'], projectIds: [] });
    expect(a.host).toBe('example.org');
    expect(a.title).toContain('repo');
    expect((await listResources(s, {})).items).toHaveLength(1);
    expect((await listResources(s, { docId: 'd1' })).items).toHaveLength(1);
    expect((await listResources(s, { docId: 'other' })).items).toHaveLength(0);
    const u = await updateResource(s, { id: a.id, title: 'Method X', docIds: ['d1', 'd2'] });
    expect(u.title).toBe('Method X');
    expect(u.docs).toEqual(['d1', 'd2']);
    await removeResource(s, a.id);
    expect((await listResources(s, {})).items).toHaveLength(0);
    expect(await readdir(path.join(lib, 'nb'))).toContain('analysis.ipynb');
  });

  it('stores only http and https links', async () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.org/x', 'https://u:p@example.org/']) {
      await expect(addResource(s, { kind: 'web', url, docIds: [], projectIds: [] })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
  });

  it('opens a link with the system browser only for http and https', async () => {
    const a = await addResource(s, { kind: 'web', url: 'https://example.org/page', docIds: [], projectIds: [] });
    await openResource(s, a.id);
    expect(external).toEqual(['https://example.org/page']);
  });

  it('adds a local notebook inside the library as a relative path and opens it with the default program', async () => {
    const abs = path.join(lib, 'nb', 'analysis.ipynb');
    approved.set(abs, 'resource-file');
    const r = await addResource(s, { kind: 'notebook', path: abs, docIds: [], projectIds: [] });
    expect(r.path).toBe('nb/analysis.ipynb');
    expect(r.missing).toBe(false);
    await openResource(s, r.id);
    expect(opened).toHaveLength(1);
  });

  it('refuses a path that was not chosen with the dialog, one outside the library and a runnable file', async () => {
    const abs = path.join(lib, 'nb', 'analysis.ipynb');
    await expect(addResource(s, { kind: 'notebook', path: abs, docIds: [], projectIds: [] })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const outside = await mkdtemp(path.join(os.tmpdir(), 'rl-out-'));
    approved.set(outside, 'resource-folder');
    await expect(addResource(s, { kind: 'folder', path: outside, docIds: [], projectIds: [] })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await rm(outside, { recursive: true, force: true });
    const exe = path.join(lib, 'nb', 'run.exe');
    approved.set(exe, 'resource-file');
    const r = await addResource(s, { kind: 'data', path: exe, docIds: [], projectIds: [] });
    await expect(openResource(s, r.id)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(opened).toHaveLength(0);
  });

  it('marks a local resource whose file is gone and keeps the record', async () => {
    const abs = path.join(lib, 'nb', 'analysis.ipynb');
    approved.set(abs, 'resource-file');
    const r = await addResource(s, { kind: 'notebook', path: abs, docIds: [], projectIds: [] });
    await rm(abs);
    expect((await listResources(s, {})).items[0]?.missing).toBe(true);
    await expect(openResource(s, r.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('loads the preview on request and stores it', async () => {
    const a = await addResource(s, { kind: 'web', url: 'https://example.org/page', docIds: [], projectIds: [] });
    expect(a.preview).toBeNull();
    const p = await previewResource(s, a.id, { resolve: async () => ['93.184.216.34'] });
    expect(p.preview).toMatchObject({ title: 'Remote', description: 'About' });
    expect((await listResources(s, {})).items[0]?.preview?.title).toBe('Remote');
  });

  it('adds data-only references from identifiers', async () => {
    const n = await addReferences(s, [{ kind: 'doi', id: '10.1000/xyz', title: 'A work', authors: ['A B'], year: 2020, doi: null, arxivId: null }]);
    expect(n).toBe(1);
    const r = (await listResources(s, {})).items[0]!;
    expect(r).toMatchObject({ kind: 'reference', source: 'doi', doi: '10.1000/xyz', url: 'https://doi.org/10.1000/xyz', title: 'A work' });
  });
});
