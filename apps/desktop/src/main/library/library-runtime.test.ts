import { mkdir, mkdtemp, rm, unlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryLogger, defaultLibraryConfig, type ScanStatus } from '@rl/core';
import { createLibraryStore, createScanner, createTextExtractor } from '@rl/data';
import { createSearchIndex } from '@rl/search';
import { LibraryRuntime, localPaths } from './library-runtime.js';
import { RuntimeManager } from './runtime-manager.js';
import { createWorkerService } from './worker-service.js';
import { createWorkerClient, serveWorker } from './worker-transport.js';
import type { LibraryWorker } from './worker-protocol.js';

let tmp: string;
let root: string;
let local: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'rl-runtime-'));
  root = path.join(tmp, 'lib');
  local = path.join(tmp, 'local');
  await mkdir(root, { recursive: true });
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const realDeps = {
  createScanner: () => createScanner(),
  createTextExtractor: (o: { cacheDir: string }) => createTextExtractor(o),
  createIndex: createSearchIndex,
  createStore: (o: { rootPath: string; dataDir: string; deviceId: string }) => createLibraryStore({ ...o, logDocumentChanges: false }),
};

async function put(rel: string, text: string) {
  const file = path.join(root, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

async function open(options: { backups?: string[]; worker?: LibraryWorker } = {}) {
  const dataDir = path.join(root, '.lab');
  const store = createLibraryStore({ rootPath: root, dataDir, deviceId: 'dev-test', logDocumentChanges: false });
  // The default scan settings look for PDF only; these tests use plain-text documents.
  await store.init();
  const cfg = await store.readConfig();
  await store.writeConfig({ ...cfg, scan: { ...cfg.scan, extensions: ['md', 'txt'] } });
  const paths = localPaths(local, 'lib-test');
  const statuses: ScanStatus[] = [];
  const rt = await LibraryRuntime.open({
    libraryId: 'lib-test',
    rootPath: root,
    dataDir,
    deviceId: 'dev-test',
    store,
    index: createSearchIndex(),
    worker: options.worker ?? createWorkerService(realDeps),
    ...paths,
    log: createMemoryLogger(),
    onStatus: (s) => statuses.push(s),
    backup: async () => void options.backups?.push('backup'),
    progressIntervalMs: 0,
  });
  return { rt, store, statuses, paths };
}

describe('LibraryRuntime (real scanner, extractor and index; worker service in-process)', () => {
  it('scans, extracts text, indexes, and finds a body word with its page', async () => {
    await put('a/alpha.md', '# Alpha study\n\nThe zebrafish embryo develops quickly.\n');
    await put('b/beta.txt', 'Plain notes about glaciology and moraines.\n');
    const backups: string[] = [];
    const { rt, store, statuses } = await open({ backups });
    try {
      rt.startScan();
      const done = await rt.whenIdle();
      expect(done.state).toBe('done');
      expect(done.indexed).toBe(2);
      expect(done.summary).toMatchObject({ added: 2 });
      expect(backups).toEqual([]); // empty library: nothing to protect yet
      expect(statuses.map((s) => s.state)).toContain('running');
      expect(statuses.some((s) => s.phase === 'extracting')).toBe(true);

      const body = await rt.search({ text: 'zebrafish' });
      expect(body.total).toBe(1);
      expect(body.hits[0]).toMatchObject({ path: 'a/alpha.md', field: 'text' });
      expect(body.hits[0]!.pages?.[0]?.page).toBe(1);
      expect(body.hits[0]!.snippet).toContain('[[zebrafish]]');
      expect((await rt.search({ text: 'glaciology' })).hits[0]!.path).toBe('b/beta.txt');

      // Documents got a title (from the file) without anything being written to the originals.
      const docs = await store.documents.list();
      expect(docs.every((d) => d.title)).toBe(true);
      expect((await rt.list({})).total).toBe(2);
      const facets = await rt.facets({ text: '' });
      expect(facets.folders.map((f) => f.value).sort()).toEqual(['a', 'b']);
    } finally {
      await rt.close();
    }
  });

  it('follows changes: new, changed, removed files; backs up first once the library has records', async () => {
    await put('one.md', 'First document about volcanoes.\n');
    await put('two.md', 'Second document about tides.\n');
    const backups: string[] = [];
    const { rt, store } = await open({ backups });
    try {
      rt.startScan();
      await rt.whenIdle();

      await put('three.md', 'Third document about aurora.\n');
      await put('one.md', 'First document about glaciers now.\n');
      await utimes(path.join(root, 'one.md'), new Date(), new Date(Date.now() + 5000));
      await unlink(path.join(root, 'two.md'));
      rt.startScan();
      const done = await rt.whenIdle();
      expect(done.state).toBe('done');
      expect(backups).toEqual(['backup']);

      expect((await rt.search({ text: 'aurora' })).total).toBe(1);
      expect((await rt.search({ text: 'volcanoes' })).total).toBe(0);
      expect((await rt.search({ text: 'glaciers' })).total).toBe(1);
      // The removed file stays known (flagged missing) and searchable by its record, never deleted.
      const two = (await store.documents.list()).find((d) => d.path === 'two.md');
      expect(two?.missing).toBe(true);
    } finally {
      await rt.close();
    }
  });

  it('rebuilds the index from the records and the text cache without extracting again', async () => {
    await put('x.md', 'Cached text about basalt.\n');
    const { rt } = await open();
    try {
      rt.startScan();
      await rt.whenIdle();
      expect((await rt.search({ text: 'basalt' })).total).toBe(1);
      await rt.rebuild();
      // `rebuild` returns once the index is reset; the refill runs as a scan.
      const done = await rt.whenIdle();
      expect(done.state).toBe('done');
      expect(done.summary?.extracted).toBe(0);
      expect((await rt.search({ text: 'basalt' })).total).toBe(1);
    } finally {
      await rt.close();
    }
  });

  it('cancels a scan', async () => {
    for (let i = 0; i < 40; i++) await put(`d/f${i}.md`, `Document number ${i} about subject${i}.\n`);
    const { rt } = await open();
    try {
      rt.startScan();
      rt.cancel();
      const done = await rt.whenIdle();
      expect(['cancelled', 'done']).toContain(done.state);
    } finally {
      await rt.close();
    }
  });

  it('reports a failing scan as a failed status, not an exception', async () => {
    const broken: LibraryWorker = {
      ...createWorkerService(realDeps),
      scan: async () => {
        throw new Error('boom');
      },
    };
    const { rt } = await open({ worker: broken });
    try {
      rt.startScan();
      const done = await rt.whenIdle();
      expect(done.state).toBe('failed');
      expect(done.error?.code).toBeTruthy();
    } finally {
      await rt.close();
    }
  });
});

describe('worker transport', () => {
  it('runs calls across a message channel, streams events, maps errors and aborts', async () => {
    const { port1, port2 } = new MessageChannel();
    const service: LibraryWorker = {
      openIndex: async () => {},
      resetIndex: async () => {
        throw new Error('nope');
      },
      scan: async (_a, hooks) => {
        hooks?.onEvent?.({ phase: 'walking', seen: 3 });
        await new Promise<void>((resolve, reject) => {
          hooks?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          if (!hooks?.signal) resolve();
        });
        return {} as never;
      },
      extract: async () => {},
      index: async () => {},
      remove: async () => {},
      dispose: async () => {},
    };
    serveWorker(port1 as never, service);
    const client = createWorkerClient(port2 as never);
    await client.openIndex('x');
    await expect(client.resetIndex()).rejects.toMatchObject({ message: 'nope' });
    const events: unknown[] = [];
    const ac = new AbortController();
    const call = client.scan({ rootPath: '', dataDir: '', deviceId: '', config: defaultLibraryConfig(), markInbox: true }, { onEvent: (e) => events.push(e), signal: ac.signal });
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    await expect(call).rejects.toMatchObject({ name: 'AbortError' });
    expect(events).toEqual([{ phase: 'walking', seen: 3 }]);
    port1.close();
    port2.close();
  });
});

describe('RuntimeManager', () => {
  const mlog = createMemoryLogger();
  function manager(active: { id: string | null }) {
    const opened: string[] = [];
    const scans: string[] = [];
    const m = new RuntimeManager({
      libraries: {
        list: async () => ({ profiles: [], activeLibraryId: active.id }),
        profile: async (id?: string) => ({ id: id ?? 'x', name: id ?? 'x', rootPath: root, dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' }),
        dataDir: async () => path.join(root, '.lab'),
      },
      settings: { get: async () => ({ deviceId: 'dev-test' }) as never },
      localDataDir: local,
      log: mlog,
      emit: (s) => scans.push(`${s.libraryId}:${s.state}`),
      backupDataDir: async () => null,
      createStore: (o) => {
        opened.push('store');
        return createLibraryStore({ ...o, logDocumentChanges: false });
      },
      createIndex: createSearchIndex,
      spawnWorker: () => createWorkerService(realDeps),
    });
    return { m, opened, scans };
  }

  it('opens the active library, scans on request, switches, and holds scans during an import', async () => {
    await put('doc.md', 'Manager test about lichen.\n');
    const seed = createLibraryStore({ rootPath: root, dataDir: path.join(root, '.lab'), deviceId: 'dev-test' });
    await seed.init();
    const cfg = await seed.readConfig();
    await seed.writeConfig({ ...cfg, scan: { ...cfg.scan, extensions: ['md'] } });
    const active = { id: 'lib-a' as string | null };
    const { m, scans } = manager(active);
    try {
      const release = m.hold('lib-a');
      await m.sync({ autoScan: true });
      expect(m.status()).toMatchObject({ libraryId: 'lib-a', state: 'idle' }); // held: no scan yet
      release();
      await expect.poll(() => m.status().state, { timeout: 15_000 }).toBe('done');
      console.log(JSON.stringify(m.status()), JSON.stringify(mlog.entries));
      const rt = await m.require('lib-a');
      expect((await rt.search({ text: 'lichen' })).total).toBe(1);
      await expect(m.require('lib-b')).rejects.toMatchObject({ code: 'LIBRARY_NOT_ACTIVE' });
      expect(scans).toContain('lib-a:done');

      active.id = null;
      await m.sync();
      expect(m.status()).toMatchObject({ libraryId: null, state: 'idle' });
      await expect(m.require()).rejects.toMatchObject({ code: 'LIBRARY_NOT_ACTIVE' });
    } finally {
      await m.closeAll();
    }
  });
});
