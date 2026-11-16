import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, createMemoryLogger, type ExtractedText, type ScanStatus, type SearchIndex, type TextExtractor } from '@rl/core';
import { createLibraryStore, createScanner, createTextExtractor } from '@rl/data';
import { createSearchIndex } from '@rl/search';
import { LibraryRuntime, localPaths } from './library-runtime.js';
import type { LibraryWorker } from './worker-protocol.js';
import { createWorkerService, type WorkerDeps } from './worker-service.js';

let tmp: string;
let root: string;
let local: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'rl-fixes-'));
  root = path.join(tmp, 'lib');
  local = path.join(tmp, 'local');
  await mkdir(root, { recursive: true });
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const put = (rel: string, text: string) => writeFile(path.join(root, rel), text);

/** How the fake extractor treats a file name: `ok` (real extraction), a thrown error, or nothing special. */
type Behaviour = 'ok' | 'transient' | 'permanent';

interface Rig {
  rt: LibraryRuntime;
  store: ReturnType<typeof createLibraryStore>;
  index: SearchIndex;
  statuses: ScanStatus[];
  extractCalls: string[];
  scanArgs: Array<{ paths?: string[] }>;
  behaviour: Map<string, Behaviour>;
  watch: { push(batch: { paths: string[]; overflow: boolean }): void };
}

async function open(wrap: (svc: LibraryWorker, rig: Pick<Rig, 'store' | 'extractCalls'>) => LibraryWorker = (s) => s): Promise<Rig> {
  const dataDir = path.join(root, '.lab');
  const store = createLibraryStore({ rootPath: root, dataDir, deviceId: 'dev-test', logDocumentChanges: false });
  await store.init();
  const cfg = await store.readConfig();
  await store.writeConfig({ ...cfg, scan: { ...cfg.scan, extensions: ['md', 'txt'] } });
  const extractCalls: string[] = [];
  const behaviour = new Map<string, Behaviour>();
  const deps: WorkerDeps = {
    createScanner: () => createScanner(),
    createTextExtractor: (o) => {
      const real = createTextExtractor(o);
      const extractor: TextExtractor = {
        async extract(r, p, opts): Promise<ExtractedText> {
          extractCalls.push(p);
          const b = behaviour.get(p) ?? 'ok';
          if (b === 'transient') throw new AppError('IO_ERROR', 'cannot read /private/path/secret.md right now', { reason: 'busy' });
          if (b === 'permanent') throw new AppError('IO_ERROR', 'cannot parse', { reason: 'malformed' });
          return real.extract(r, p, opts);
        },
      };
      return extractor;
    },
    createIndex: createSearchIndex,
    createStore: (o) => createLibraryStore({ ...o, logDocumentChanges: false }),
  };
  const index = createSearchIndex();
  const statuses: ScanStatus[] = [];
  const scanArgs: Rig['scanArgs'] = [];
  let onBatch: ((b: { paths: string[]; overflow: boolean }) => void) | null = null;
  const svc = createWorkerService(deps);
  const worker = wrap(
    {
      ...svc,
      scan: (args, hooks) => {
        scanArgs.push({ paths: args.paths });
        return svc.scan(args, hooks);
      },
    },
    { store, extractCalls },
  );
  const rt = await LibraryRuntime.open({
    libraryId: 'lib-test',
    rootPath: root,
    dataDir,
    deviceId: 'dev-test',
    store,
    index,
    worker,
    ...localPaths(local, 'lib-test'),
    log: createMemoryLogger(),
    onStatus: (s) => statuses.push(s),
    backup: async () => {},
    progressIntervalMs: 0,
    watch: (o) => {
      onBatch = o.onBatch;
      return { close() {} };
    },
  });
  return { rt, store, index, statuses, extractCalls, scanArgs, behaviour, watch: { push: (b) => onBatch?.(b) } };
}

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

describe('extraction failures (defect 4)', () => {
  it('retries a transient failure at the next scan, never retries a permanent one until a full pass', async () => {
    await put('flaky.md', 'Text about fjords.\n');
    await put('broken.md', 'Text about deltas.\n');
    await put('fine.md', 'Text about steppes.\n');
    const rig = await open();
    rig.behaviour.set('flaky.md', 'transient');
    rig.behaviour.set('broken.md', 'permanent');
    try {
      rig.rt.startScan();
      const first = await rig.rt.whenIdle();
      expect(first.state).toBe('done');
      expect(first.summary?.failed).toBe(2);
      const recs = await rig.store.documents.list();
      const id = (p: string) => recs.find((r) => r.path === p)!.id;
      const state = await rig.index.indexedState();
      expect(state.get(id('flaky.md'))?.textHash ?? null).toBeNull(); // not marked as done
      expect(state.get(id('broken.md'))?.textHash).toBe(recs.find((r) => r.path === 'broken.md')!.hash); // permanent: marked
      expect(state.get(id('fine.md'))?.textHash).toBeTruthy();

      // The file comes back: the transient one is read now; the permanent one is not touched.
      rig.behaviour.set('flaky.md', 'ok');
      rig.extractCalls.length = 0;
      rig.rt.startScan();
      const second = await rig.rt.whenIdle();
      expect(second.summary?.failed).toBe(0);
      expect([...new Set(rig.extractCalls)]).toEqual(['flaky.md']);
      expect((await rig.rt.search({ text: 'fjords' })).total).toBe(1);

      // A rebuild is a full pass: it asks again for what is missing (the permanent failure too).
      rig.behaviour.set('broken.md', 'ok');
      rig.extractCalls.length = 0;
      await rig.rt.rebuild();
      await rig.rt.whenIdle();
      expect([...new Set(rig.extractCalls)].sort()).toEqual(['broken.md', 'fine.md', 'flaky.md']);
      expect((await rig.rt.search({ text: 'deltas' })).total).toBe(1);
      expect((await rig.rt.search({ text: 'steppes' })).total).toBe(1);
    } finally {
      await rig.rt.close();
    }
  });

  it('the failure result carries a code, never the message of the error', async () => {
    const svc = createWorkerService({
      createScanner: () => createScanner(),
      createTextExtractor: () => ({
        async extract() {
          throw new Error('secret text from /private/path/doc.pdf');
        },
      }),
      createIndex: createSearchIndex,
      createStore: (o) => createLibraryStore({ ...o, logDocumentChanges: false }),
    });
    const r = await svc.extract({ rootPath: root, cacheDir: local, item: { path: 'x.md', hash: 'a'.repeat(64) } });
    expect(r).toMatchObject({ ok: false, permanent: false });
    expect(r.error).not.toContain('secret');
    expect(r.error).not.toContain('private');
  });
});

describe('holding and queueing scans (defects 3 and 8)', () => {
  it('hold cancels and awaits the running scan; scans and watcher batches wait for release', async () => {
    await put('a.md', 'Text about ferns.\n');
    let block = true;
    let scans = 0;
    const rig = await open((svc) => ({
      ...svc,
      scan: async (args, hooks) => {
        scans++;
        if (block) {
          await new Promise<never>((_, reject) => {
            if (hooks?.signal?.aborted) reject(abortError());
            hooks?.signal?.addEventListener('abort', () => reject(abortError()));
          });
        }
        return svc.scan(args, hooks);
      },
    }));
    try {
      rig.rt.startScan();
      await expect.poll(() => rig.rt.status().state).toBe('running');
      const hold = rig.rt.hold();
      await hold.ready;
      expect(rig.rt.status().state).toBe('cancelled');
      block = false;

      rig.rt.startScan();
      rig.watch.push({ paths: ['a.md'], overflow: false });
      rig.rt.startScan({ full: true });
      await new Promise((r) => setTimeout(r, 100));
      expect(scans).toBe(1); // nothing started while held
      expect(rig.rt.status().state).toBe('cancelled');

      hold.release();
      const done = await rig.rt.whenIdle();
      expect(done.state).toBe('done');
      expect(scans).toBe(2); // one merged pass, not three
    } finally {
      await rig.rt.close();
    }
  });

  it('queues a full or targeted request made while a scan runs instead of dropping it', async () => {
    await put('a.md', 'Text about ferns.\n');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    const rig = await open((svc) => ({
      ...svc,
      scan: async (args, hooks) => {
        if (first) {
          first = false;
          await gate;
        }
        return svc.scan(args, hooks);
      },
    }));
    try {
      rig.rt.startScan();
      await expect.poll(() => rig.rt.status().state).toBe('running');
      rig.rt.startScan(); // plain: the running pass covers it
      rig.rt.startScan({ paths: ['a.md'] });
      rig.rt.startScan({ full: true });
      release();
      await rig.rt.whenIdle();
      expect(rig.scanArgs).toHaveLength(2);
      expect(rig.scanArgs[1]!.paths).toBeUndefined(); // full + targeted merge into the whole root
    } finally {
      await rig.rt.close();
    }
  });

  it('a watcher event while rebuild resets the index does not start a scan before the reset is done', async () => {
    await put('a.md', 'Text about ferns.\n');
    const order: string[] = [];
    let push: (() => void) | undefined;
    const rig = await open((svc) => ({
      ...svc,
      resetIndex: async () => {
        order.push('reset-start');
        push?.();
        await new Promise((r) => setTimeout(r, 50));
        await svc.resetIndex();
        order.push('reset-end');
      },
      scan: (args, hooks) => {
        order.push('scan');
        return svc.scan(args, hooks);
      },
    }));
    push = () => rig.watch.push({ paths: ['a.md'], overflow: false });
    try {
      rig.rt.startScan();
      await rig.rt.whenIdle();
      order.length = 0;
      await rig.rt.rebuild();
      await rig.rt.whenIdle();
      expect(order).toEqual(['reset-start', 'reset-end', 'scan']);
      expect((await rig.rt.search({ text: 'ferns' })).total).toBe(1);
    } finally {
      await rig.rt.close();
    }
  });
});

describe('one writer for the records (defect 5)', () => {
  it('keeps a user edit made while the scanner renames the same document', async () => {
    await put('old-name.md', 'Text about orchids.\n');
    const rig = await open();
    try {
      rig.rt.startScan();
      await rig.rt.whenIdle();
      await rename(path.join(root, 'old-name.md'), path.join(root, 'new-name.md'));
    } catch (e) {
      await rig.rt.close();
      throw e;
    }
    await rig.rt.close();

    // Second runtime on the same library, with the user's edit squeezed in before the scanner's commit.
    let edited = false;
    const rig2 = await open((svc, { store }) => ({
      ...svc,
      scan: (args, hooks) =>
        svc.scan(args, {
          ...hooks,
          host: {
            commit: async (c) => {
              if (!edited && c.record.path === 'new-name.md') {
                edited = true;
                await store.documents.update(c.id, (cur) => ({ ...cur!, tags: ['user-tag'], study: { ...cur!.study, state: 'reading' as const } }));
              }
              return hooks!.host!.commit(c);
            },
          },
        }),
    }));
    try {
      rig2.rt.startScan();
      const done = await rig2.rt.whenIdle();
      expect(done.state).toBe('done');
      expect(edited).toBe(true);
      const rec = (await rig2.store.documents.list()).find((d) => d.path === 'new-name.md')!;
      expect(rec).toBeTruthy();
      expect(rec.pathHistory.map((h) => h.path)).toContain('old-name.md'); // the scanner's change survived...
      expect(rec.tags).toEqual(['user-tag']); // ...and so did the user's
      expect(rec.study.state).toBe('reading');
    } finally {
      await rig2.rt.close();
    }
  });
});

describe('one bad document does not fail the scan (defect 6)', () => {
  it('counts it, goes on with the stale and vanished phases', async () => {
    await put('good.md', 'Text about kelp.\n');
    await put('gone.md', 'Text about reefs.\n');
    await put('bad.md', 'Text about dunes.\n');
    const rig = await open((svc) => ({
      ...svc,
      index: (args) => {
        if (args.jobs.some((j) => j.doc.record.path === 'bad.md')) throw new AppError('IO_ERROR', 'row refused');
        return svc.index(args);
      },
    }));
    try {
      rig.rt.startScan();
      const first = await rig.rt.whenIdle();
      expect(first.state).toBe('done');
      expect(first.summary?.failed).toBeGreaterThanOrEqual(1);
      expect(first.indexed).toBe(2);

      // A record removed from the data folder and a record edited by the user, in the same pass as the bad one.
      const recs = await rig.store.documents.list();
      const goneId = recs.find((r) => r.path === 'gone.md')!.id;
      await rm(path.join(root, '.lab', 'documents', `${goneId}.json`));
      await rm(path.join(root, 'gone.md'));
      const good = recs.find((r) => r.path === 'good.md')!;
      const edited = await rig.store.documents.update(good.id, (c) => ({ ...c!, tags: ['kelp-tag'], updatedAt: new Date().toISOString() }));
      rig.rt.startScan();
      const second = await rig.rt.whenIdle();
      expect(second.state).toBe('done');
      expect(second.summary?.failed).toBe(1);
      const state = await rig.index.indexedState();
      expect(state.has(goneId)).toBe(false); // vanished phase ran
      expect(state.get(good.id)?.stamp).toBe(`${edited.revision}:${edited.updatedAt}`); // stale phase ran
    } finally {
      await rig.rt.close();
    }
  });
});
