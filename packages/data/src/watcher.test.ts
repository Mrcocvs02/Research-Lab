import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultLibraryConfig } from '@rl/core';
import { createWatcher, type LibraryWatcher, type WatchBatch } from './index.js';
import { removeDir, tempDir } from './test-utils.js';

describe('watcher', () => {
  let root: string;
  let w: LibraryWatcher | undefined;
  let batches: WatchBatch[];
  const config = defaultLibraryConfig();
  config.scan.extensions = ['pdf', 'md'];

  const start = (extra: Partial<Parameters<typeof createWatcher>[0]> = {}) => {
    w = createWatcher({ rootPath: root, dataDir: path.join(root, '.lab'), config, debounceMs: 80, maxWaitMs: 1000, onBatch: (b) => batches.push(b), ...extra });
  };
  const all = () => batches.flatMap((b) => b.paths);
  /** Lets the OS watcher settle, then runs `action`. */
  const act = async (action: () => Promise<void>) => {
    await new Promise((r) => setTimeout(r, 150));
    await action();
  };

  beforeEach(async () => {
    root = await tempDir('rl-watch-');
    await mkdir(path.join(root, 'sub'), { recursive: true });
    await mkdir(path.join(root, '.lab'), { recursive: true });
    await mkdir(path.join(root, 'skip'), { recursive: true });
    await mkdir(path.join(root, '.git'), { recursive: true });
    batches = [];
  });
  afterEach(async () => {
    await w?.close();
    await removeDir(root);
  });

  it('reports created, changed, renamed and deleted files as one debounced batch with relative paths', async () => {
    start();
    await act(async () => {
      await writeFile(path.join(root, 'sub', 'a è.pdf'), '1');
      await writeFile(path.join(root, 'sub', 'b.md'), '1');
      await writeFile(path.join(root, 'sub', 'b.md'), '2');
    });
    await vi.waitFor(() => expect(all()).toEqual(expect.arrayContaining(['sub/a è.pdf', 'sub/b.md'])), { timeout: 5000 });
    expect(batches).toHaveLength(1);
    expect(batches[0]?.overflow).toBe(false);
    expect(batches[0]?.paths).toEqual([...(batches[0]?.paths ?? [])].sort());
    batches.length = 0;
    await rename(path.join(root, 'sub', 'b.md'), path.join(root, 'sub', 'c.md'));
    await vi.waitFor(() => expect(all()).toEqual(expect.arrayContaining(['sub/b.md', 'sub/c.md'])), { timeout: 5000 });
    batches.length = 0;
    await rm(path.join(root, 'sub', 'c.md'));
    await vi.waitFor(() => expect(all()).toContain('sub/c.md'), { timeout: 5000 });
  });

  it('ignores the data dir, excluded and hidden folders, temp files and other extensions', async () => {
    start({ config: { ...config, excludedFolders: ['skip'] } });
    await act(async () => {
      await writeFile(path.join(root, '.lab', 'x.pdf'), '1');
      await writeFile(path.join(root, 'skip', 'x.pdf'), '1');
      await writeFile(path.join(root, '.git', 'x.pdf'), '1');
      await writeFile(path.join(root, 'sub', '~$lock.md'), '1');
      await writeFile(path.join(root, 'sub', 'photo.png'), '1');
      await writeFile(path.join(root, 'sub', 'real.pdf'), '1'); // the marker: arrives last
    });
    await vi.waitFor(() => expect(all()).toContain('sub/real.pdf'), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(all()).toEqual(['sub/real.pdf']);
  });

  it('reports a renamed folder (no extension) so the scan can follow the files in it', async () => {
    await writeFile(path.join(root, 'sub', 'a.pdf'), '1');
    start();
    await act(async () => rename(path.join(root, 'sub'), path.join(root, 'moved')));
    await vi.waitFor(() => expect(all()).toEqual(expect.arrayContaining(['moved'])), { timeout: 5000 });
  });

  it('flags an overflow when too many paths change at once', async () => {
    start({ maxBatch: 3 });
    await act(async () => {
      for (let i = 0; i < 8; i++) await writeFile(path.join(root, 'sub', `f${i}.pdf`), 'x');
    });
    await vi.waitFor(() => expect(batches.some((b) => b.overflow)).toBe(true), { timeout: 5000 });
    expect(Math.max(...batches.map((b) => b.paths.length))).toBeLessThanOrEqual(3);
  });

  it('picks up settings changes without restarting (config as a function)', async () => {
    let exts = ['pdf'];
    start({ config: () => ({ ...config, scan: { ...config.scan, extensions: exts } }) });
    await act(async () => writeFile(path.join(root, 'sub', 'n.md'), '1'));
    await new Promise((r) => setTimeout(r, 400));
    expect(all()).not.toContain('sub/n.md');
    exts = ['pdf', 'md'];
    await writeFile(path.join(root, 'sub', 'n.md'), '2');
    await vi.waitFor(() => expect(all()).toContain('sub/n.md'), { timeout: 5000 });
  });

  it('closes cleanly: nothing is emitted afterwards, closing twice is fine', async () => {
    start();
    await act(async () => writeFile(path.join(root, 'sub', 'z.pdf'), '1'));
    await w?.close();
    await w?.close();
    await writeFile(path.join(root, 'sub', 'after.pdf'), '1');
    await new Promise((r) => setTimeout(r, 400));
    expect(all()).not.toContain('sub/after.pdf');
    expect(batches).toHaveLength(0); // the pending batch was dropped by close()
  });

  it('reports a missing root through onError instead of throwing', async () => {
    const errors: Error[] = [];
    w = createWatcher({ rootPath: path.join(root, 'nope'), config, onBatch: () => {}, onError: (e) => errors.push(e) });
    await vi.waitFor(() => expect(errors).toHaveLength(1), { timeout: 3000 });
  });
});
