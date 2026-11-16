import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryLogger, type ScanStatus } from '@rl/core';
import { createLibraryStore } from '@rl/data';
import { createSearchIndex } from '@rl/search';
import { LibraryRuntime, localPaths } from './library-runtime.js';
import { buildHostileWorker } from './testing/build-test-worker.js';
import { spawnScanWorker } from './worker-host.js';
import type { LibraryWorker } from './worker-protocol.js';
import type { WatchdogOptions } from './supervised-worker.js';

/**
 * Security: a document that blocks the worker thread (synchronous loop), exhausts its memory or kills it must cost
 * one failed file, never the scan, the cancel, the close or the next scan. These tests run a REAL worker thread
 * whose extractor misbehaves on files named `hang-*`, `oom-*`, `crash-*` (see `testing/hostile-worker.ts`).
 */
let workerFile: string;
let tmp: string;
let root: string;
let local: string;
beforeAll(async () => {
  workerFile = await buildHostileWorker();
}, 120_000);
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'rl-watchdog-'));
  root = path.join(tmp, 'lib');
  local = path.join(tmp, 'local');
  await mkdir(root, { recursive: true });
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});
afterAll(async () => {
  await rm(path.resolve(import.meta.dirname, '../../../out/test-worker'), { recursive: true, force: true });
});

const put = async (rel: string, text: string) => writeFile(path.join(root, rel), text);

interface Opened {
  rt: LibraryRuntime;
  worker: LibraryWorker;
  statuses: ScanStatus[];
  extractCalls: string[];
  store: ReturnType<typeof createLibraryStore>;
}

async function open(watchdog: Partial<WatchdogOptions>, extra: { closeTimeoutMs?: number; maxOldGenerationSizeMb?: number } = {}): Promise<Opened> {
  const dataDir = path.join(root, '.lab');
  const store = createLibraryStore({ rootPath: root, dataDir, deviceId: 'dev-test', logDocumentChanges: false });
  await store.init();
  const cfg = await store.readConfig();
  await store.writeConfig({ ...cfg, scan: { ...cfg.scan, extensions: ['md', 'txt'] } });
  const base = spawnScanWorker(workerFile, { watchdog, maxOldGenerationSizeMb: extra.maxOldGenerationSizeMb ?? 256 });
  const extractCalls: string[] = [];
  const worker: LibraryWorker = {
    ...base,
    extract: (args, hooks) => {
      extractCalls.push(args.item.path);
      return base.extract(args, hooks);
    },
  };
  const statuses: ScanStatus[] = [];
  const rt = await LibraryRuntime.open({
    libraryId: 'lib-test',
    rootPath: root,
    dataDir,
    deviceId: 'dev-test',
    store,
    index: createSearchIndex(),
    worker,
    ...localPaths(local, 'lib-test'),
    log: createMemoryLogger(),
    onStatus: (s) => statuses.push(s),
    backup: async () => {},
    progressIntervalMs: 0,
    closeTimeoutMs: extra.closeTimeoutMs ?? 3000,
  });
  return { rt, worker, statuses, extractCalls, store };
}

const FAST: Partial<WatchdogOptions> = { extractFileMs: 1500, extractPageMs: 1500, abortGraceMs: 500, disposeMs: 500, scanMs: 20_000, indexMs: 20_000 };

describe('watchdog (real worker thread)', () => {
  it('kills a file that blocks the thread, finishes the scan with the other documents and does not retry the file', async () => {
    await put('a-one.md', 'Notes on zebrafish embryos.\n');
    await put('hang-two.md', 'This file blocks the extractor.\n');
    await put('c-three.md', 'Notes on glaciology and moraines.\n');
    const { rt, extractCalls, store } = await open(FAST);
    try {
      rt.startScan();
      const first = await rt.whenIdle();
      expect(first.state).toBe('done');
      expect(first.summary?.failed).toBe(1);
      expect((await rt.search({ text: 'zebrafish' })).total).toBe(1);
      expect((await rt.search({ text: 'glaciology' })).total).toBe(1);
      expect((await rt.list({})).total).toBe(3); // the blocked file is listed (metadata), just without text
      expect(extractCalls.filter((p) => p === 'hang-two.md')).toHaveLength(1);

      // The next scan does not touch it again (it would block 1.5 s more and fail again).
      rt.startScan();
      const second = await rt.whenIdle();
      expect(second.state).toBe('done');
      expect(second.summary?.failed).toBe(0);
      expect(extractCalls.filter((p) => p === 'hang-two.md')).toHaveLength(1);

      // Until the file changes: then it is tried again.
      await put('hang-two.md', 'Changed content, still hostile.\n');
      const rec = (await store.documents.list()).find((d) => d.path === 'hang-two.md')!;
      expect(rec).toBeTruthy();
      rt.startScan({ paths: ['hang-two.md'] });
      await rt.whenIdle();
      expect(extractCalls.filter((p) => p === 'hang-two.md')).toHaveLength(2);
    } finally {
      await rt.close();
    }
  }, 60_000);

  it('does not kill an extraction that keeps reporting pages, even when it takes longer than the file timeout', async () => {
    await put('slow-a.md', 'Slow but alive: aurora borealis.\n');
    const { rt } = await open({ ...FAST, extractFileMs: 600, extractPageMs: 600 });
    try {
      rt.startScan();
      const done = await rt.whenIdle();
      expect(done.state).toBe('done');
      expect(done.summary?.failed).toBe(0);
      expect((await rt.search({ text: 'aurora' })).total).toBe(1);
    } finally {
      await rt.close();
    }
  }, 30_000);

  it('cancel works on a worker blocked in a loop', async () => {
    await put('hang-only.md', 'blocks\n');
    const { rt } = await open({ ...FAST, extractFileMs: 60_000, extractPageMs: 60_000, abortGraceMs: 400 });
    try {
      rt.startScan();
      await expect.poll(() => rt.status().phase, { timeout: 15_000 }).toBe('extracting');
      const t0 = Date.now();
      rt.cancel();
      const done = await rt.whenIdle();
      expect(done.state).toBe('cancelled');
      expect(Date.now() - t0).toBeLessThan(5000);
      // The runtime still works: the worker starts again.
      await rm(path.join(root, 'hang-only.md')); // cancelled mid-file, so it would be tried (and block) again
      await put('fine.md', 'Fine document about lichen.\n');
      rt.startScan();
      const next = await rt.whenIdle();
      expect(next.state).toBe('done');
      expect((await rt.search({ text: 'lichen' })).total).toBe(1);
    } finally {
      await rt.close();
    }
  }, 60_000);

  it('close() does not wait for a blocked worker', async () => {
    await put('hang-only.md', 'blocks\n');
    // No watchdog help here (very long times) and no abort grace: only close()'s own limit can end it.
    const { rt } = await open({ ...FAST, extractFileMs: 600_000, extractPageMs: 600_000, abortGraceMs: 600_000 }, { closeTimeoutMs: 500 });
    rt.startScan();
    await expect.poll(() => rt.status().phase, { timeout: 15_000 }).toBe('extracting');
    const t0 = Date.now();
    await rt.close();
    expect(Date.now() - t0).toBeLessThan(8000);
  }, 60_000);

  it.skipIf(process.env.RL_HEAVY_TESTS !== '1')('survives a worker that runs out of memory or exits, and starts a new one for the next scan', async () => {
    await put('a-ok.md', 'Healthy document about basalt.\n');
    await put('oom-big.md', 'eats all memory\n');
    await put('crash-now.md', 'ends the thread\n');
    await put('z-ok.md', 'Another healthy document about tides.\n');
    const { rt, extractCalls } = await open(FAST, { maxOldGenerationSizeMb: 64 });
    try {
      rt.startScan();
      const first = await rt.whenIdle();
      expect(first.state).toBe('done');
      expect(first.summary?.failed).toBe(2);
      expect((await rt.search({ text: 'basalt' })).total).toBe(1);
      expect((await rt.search({ text: 'tides' })).total).toBe(1);

      // A later scan works on the new worker (the dead one is not kept): a new file is indexed.
      await put('late.md', 'Late arrival about moraines.\n');
      rt.startScan();
      const second = await rt.whenIdle();
      expect(second.state).toBe('done');
      expect((await rt.search({ text: 'moraines' })).total).toBe(1);
      expect(extractCalls.filter((p) => p === 'oom-big.md')).toHaveLength(1);
      expect(extractCalls.filter((p) => p === 'crash-now.md')).toHaveLength(1);
    } finally {
      await rt.close();
    }
  }, 90_000);

  it('the supervisor reports a blocked call as a timeout and serves the next call from a new worker', async () => {
    await put('hang-x.md', 'blocks\n');
    await put('ok.md', 'Plain text about volcanoes.\n');
    const { rt, worker } = await open({ ...FAST, extractFileMs: 700, extractPageMs: 700 });
    try {
      const args = { rootPath: root, cacheDir: localPaths(local, 'lib-test').textCacheDir };
      const t0 = Date.now();
      await expect(worker.extract({ ...args, item: { path: 'hang-x.md', hash: 'a'.repeat(64) } })).rejects.toMatchObject({ code: 'IO_ERROR', details: { reason: 'timeout' } });
      expect(Date.now() - t0).toBeLessThan(5000);
      const r = await worker.extract({ ...args, item: { path: 'ok.md', hash: 'b'.repeat(64) } });
      expect(r.ok).toBe(true);
    } finally {
      await rt.close();
    }
  }, 60_000);
});
