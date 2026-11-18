import { mkdir, mkdtemp, rm, unlink, utimes, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, createMemoryLogger, defaultLibraryConfig, documentRecordSchema, type ScanStatus } from '@rl/core';
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

async function open(options: { backups?: string[]; worker?: LibraryWorker; changed?: string[] } = {}) {
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
    onDocumentsChanged: () => void options.changed?.push(statuses.at(-1)?.state ?? 'none'),
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
      expect(body.hits[0]!.snippet).toContain('zebrafish');
      expect((await rt.search({ text: 'glaciology' })).hits[0]!.path).toBe('b/beta.txt');

      // The file name is never written as a title (the interface falls back to it); extracted values carry their provenance.
      const docs = await store.documents.list();
      expect(docs.find((d) => d.path === 'b/beta.txt')?.title).toBeNull();
      const alpha = docs.find((d) => d.path === 'a/alpha.md')!;
      if (alpha.title !== null) expect(alpha.extracted?.title).toBe(alpha.title);
      expect((await rt.list({})).total).toBe(2);
      const facets = await rt.facets({ text: '' });
      expect(facets.folders.map((f) => f.value).sort()).toEqual(['a', 'b']);
    } finally {
      await rt.close();
    }
  });

  it('reindexing records written outside the organizer (AI proposals, MCP) moves its generation, so readers cached by it see them', async () => {
    await put('a/alpha.md', 'Alpha text about kelp.\n');
    const { rt, store } = await open();
    try {
      rt.startScan();
      await rt.whenIdle();
      const [id] = (await store.documents.list()).map((d) => d.id);
      const before = rt.organizer.generation;
      await store.documents.update(id as never, (cur) => ({ ...cur!, updatedAt: new Date().toISOString() }));
      await rt.reindexDocuments([id as never]);
      const afterMany = rt.organizer.generation;
      expect(afterMany).toBeGreaterThan(before);
      await rt.reindexDocument(id as never);
      expect(rt.organizer.generation).toBeGreaterThan(afterMany);
    } finally {
      await rt.close();
    }
  });

  it('organising through the runtime: tags, implications and edits reach the index and survive the next scan', async () => {
    await put('a/alpha.md', 'Alpha text about kelp.\n');
    await put('b/beta.md', 'Beta text about reefs.\n');
    const { rt, store } = await open();
    try {
      rt.startScan();
      await rt.whenIdle();
      const ids = (await store.documents.list()).map((d) => d.id);
      const org = rt.organizer;
      const made = await org.applyTaxonomy([
        { op: 'create', id: 'ocean', label: 'Ocean', aliases: ['sea'] },
        { op: 'create', id: 'reef', label: 'Reef', parents: ['ocean'], implies: ['ocean'] },
      ]);
      await rt.reindexDocuments(made.reindex as never);
      const tagged = await org.tagDocuments([ids[0] as string], ['reef']);
      await rt.reindexDocuments(tagged.reindex as never);
      // the implied tag and the alias both find it; the facets count it under both
      expect((await rt.search({ text: '', filters: { tags: ['ocean'] } })).total).toBe(1);
      expect((await rt.search({ text: 'sea' })).total).toBe(1);
      expect((await rt.facets({ text: '' })).tags.map((t) => t.value).sort()).toEqual(['ocean', 'reef']);
      const upd = await org.updateDocument(ids[1] as string, { title: 'My Beta', userDescription: 'a manatee remark' });
      await rt.reindexDocuments(upd.reindex as never);
      expect((await rt.search({ text: 'manatee' })).total).toBe(1);
      // a full scan keeps what the user did
      rt.startScan({ full: true });
      await rt.whenIdle();
      expect((await store.documents.get(ids[1] as never))?.title).toBe('My Beta');
      expect((await rt.search({ text: '', filters: { tags: ['ocean'] } })).total).toBe(1);
      expect((await rt.search({ text: 'manatee' })).total).toBe(1);
      // undo is reflected after reindexing what it lists
      const undone = await org.undo();
      await rt.reindexDocuments(undone.reindex as never);
      expect((await rt.search({ text: 'manatee' })).total).toBe(0);
    } finally {
      await rt.close();
    }
  });

  it('the organizer sees what a scan wrote at once, and the end of a scan announces the documents (D-130)', async () => {
    await put('a/alpha.md', 'Alpha text about kelp.\n');
    const changed: string[] = [];
    const { rt, store } = await open({ changed });
    try {
      // The organizer reads the (still empty) library and keeps that answer for its reuse window.
      expect((await rt.organizer.folderTree()).total).toBe(0);
      rt.startScan();
      await rt.whenIdle();
      // Inside that window: the scan invalidated it, so the tree is not the old empty one.
      expect((await rt.organizer.folderTree()).total).toBe(1);
      // The announcement comes after the final status, once per scan.
      expect(changed).toEqual(['done']);

      // A targeted scan of the watcher (a new file) does the same.
      await put('b/beta.md', 'Beta text about reefs.\n');
      rt.startScan({ paths: ['b/beta.md'] });
      await rt.whenIdle();
      expect((await rt.organizer.folderTree()).total).toBe(2);
      expect(changed).toEqual(['done', 'done']);
      const ids = (await store.documents.listIds()) as string[];
      // ...and a project can be made with the ids that scan found.
      await expect(rt.organizer.createProject({ name: 'P', docIds: ids })).resolves.toBeTruthy();

      // A cancelled scan still announces, with its own final status.
      await put('c/gamma.md', 'Gamma\n');
      rt.startScan({ full: true });
      rt.cancel();
      await rt.whenIdle();
      expect(changed.length).toBe(3);
      expect(['cancelled', 'done']).toContain(changed[2]);
    } finally {
      await rt.close();
    }
  });

  it('a hold (an import writing records) drops the organizer cache on both ends', async () => {
    const { rt, store } = await open();
    try {
      expect((await rt.organizer.folderTree()).total).toBe(0);
      const hold = rt.hold();
      await hold.ready;
      const text = 'Imported text about fjords.';
      await put('imp/old.md', text);
      const hash = createHash('sha256').update(text).digest('hex');
      const id = hash.slice(0, 16);
      const now = '2026-01-01T00:00:00.000Z';
      await store.documents.update(id as never, () => documentRecordSchema.parse({ id, hash, path: 'imp/old.md', size: text.length, mtimeMs: 1, addedAt: now, updatedAt: now }));
      // Written behind the organizer's back, inside its reuse window: still seen at the next read.
      hold.release();
      await rt.whenIdle();
      expect((await rt.organizer.folderTree()).total).toBe(1);
    } finally {
      await rt.close();
    }
  });

  it('a tag filter finds the documents of its descendants and of tags that imply it, after indexing through the runtime', async () => {
    await put('a/alpha.md', 'Alpha text about kelp.\n');
    await put('b/beta.md', 'Beta text about reefs.\n');
    await put('c/gamma.md', 'Gamma text about tides.\n');
    const { rt, store } = await open();
    try {
      rt.startScan();
      await rt.whenIdle();
      const byPath = new Map((await store.documents.list()).map((d) => [d.path, d.id]));
      const org = rt.organizer;
      const made = await org.applyTaxonomy([
        { op: 'create', id: 'science', label: 'Science' },
        { op: 'create', id: 'biology', label: 'Biology', parents: ['science'] },
        { op: 'create', id: 'ecology', label: 'Ecology', parents: ['biology'] },
        { op: 'create', id: 'kelpy', label: 'Kelpy', implies: ['ecology'] },
      ]);
      await rt.reindexDocuments(made.reindex as never);
      for (const [p, tag] of [['a/alpha.md', 'ecology'], ['b/beta.md', 'kelpy']] as const) {
        const t = await org.tagDocuments([byPath.get(p) as string], [tag]);
        await rt.reindexDocuments(t.reindex as never);
      }
      const paths = async (filters: Parameters<typeof rt.search>[0]['filters']) => (await rt.search({ text: '', filters })).hits.map((h) => h.path).sort();
      expect(await paths({ tags: ['ecology'] })).toEqual(['a/alpha.md', 'b/beta.md']); // own tag and a tag that implies it
      expect(await paths({ tags: ['science'] })).toEqual(['a/alpha.md', 'b/beta.md']); // ancestors, two levels up
      expect(await paths({ tags: ['kelpy'] })).toEqual(['b/beta.md']);
      expect(await paths({ tagsAny: ['biology', 'kelpy'] })).toEqual(['a/alpha.md', 'b/beta.md']);
      expect(await paths({ tagsExclude: ['biology'] })).toEqual(['c/gamma.md']);
      // Moving a node changes the ancestors of its documents: the entries are refreshed.
      const moved = await org.applyTaxonomy([{ op: 'create', id: 'arts', label: 'Arts' }, { op: 'move', id: 'ecology', parents: ['arts'] }]);
      await rt.reindexDocuments(moved.reindex as never);
      expect(await paths({ tags: ['science'] })).toEqual([]);
      expect(await paths({ tags: ['arts'] })).toEqual(['a/alpha.md', 'b/beta.md']);
      // Facets list only the documents' own tags.
      expect((await rt.facets({ text: '', filters: { tags: ['arts'] } })).tags.map((t) => t.value).sort()).toEqual(['ecology', 'kelpy']);
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
        throw new AppError('IO_ERROR', 'nope');
      },
      scan: async (_a, hooks) => {
        hooks?.onEvent?.({ phase: 'walking', seen: 3 });
        await new Promise<void>((resolve, reject) => {
          hooks?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          if (!hooks?.signal) resolve();
        });
        return {} as never;
      },
      extract: async (a) => ({ path: a.item.path, hash: a.item.hash, ok: true, cached: true }),
      repairAnnotations: async () => [],
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
      emitDocumentsChanged: () => void scans.push('documents-changed'),
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
      await release.ready;
      await m.sync({ autoScan: true });
      expect(m.status()).toMatchObject({ libraryId: 'lib-a', state: 'idle' }); // held: no scan yet
      release();
      await expect.poll(() => m.status().state, { timeout: 15_000 }).toBe('done');
      console.log(JSON.stringify(m.status()), JSON.stringify(mlog.entries));
      const rt = await m.require('lib-a');
      expect((await rt.search({ text: 'lichen' })).total).toBe(1);
      await expect(m.require('lib-b')).rejects.toMatchObject({ code: 'LIBRARY_NOT_ACTIVE' });
      expect(scans).toContain('lib-a:done');
      // The end of the scan is announced to the interface, after its final status.
      expect(scans.indexOf('documents-changed')).toBeGreaterThan(scans.indexOf('lib-a:done'));

      active.id = null;
      await m.sync();
      expect(m.status()).toMatchObject({ libraryId: null, state: 'idle' });
      await expect(m.require()).rejects.toMatchObject({ code: 'LIBRARY_NOT_ACTIVE' });
    } finally {
      await m.closeAll();
    }
  });
});
