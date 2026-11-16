import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `realpath` and `stat` are wrapped so a test can simulate a swap between the path check and the open.
const fsMock = vi.hoisted(() => ({ realpath: undefined as undefined | ((p: string) => Promise<string>), stat: undefined as undefined | ((p: string) => Promise<unknown>) }));
vi.mock('node:fs/promises', async (orig) => {
  const real = await orig<typeof import('node:fs/promises')>();
  return {
    ...real,
    realpath: (p: string) => (fsMock.realpath ? fsMock.realpath(p) : real.realpath(p)),
    stat: (p: string) => (fsMock.stat ? fsMock.stat(p) : real.stat(p)),
  };
});

import { openPdfHandle } from './doc-files.js';

const PDF = Buffer.from('%PDF-1.4\nhello');
let root: string;
let outside: string;
let file: string;

beforeEach(async () => {
  fsMock.realpath = undefined;
  fsMock.stat = undefined;
  root = await mkdtemp(path.join(os.tmpdir(), 'rl-df-'));
  outside = await mkdtemp(path.join(os.tmpdir(), 'rl-df-out-'));
  await mkdir(path.join(root, 'papers'), { recursive: true });
  file = path.join(root, 'papers', 'a.pdf');
  await writeFile(file, PDF);
  await writeFile(path.join(outside, 'secret.pdf'), PDF);
  // Same canonical spelling the resolver would have returned.
  const real = await (await import('node:fs/promises')).realpath(file);
  file = real;
  root = await (await import('node:fs/promises')).realpath(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  await rm(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('openPdfHandle re-check after the open (D-197)', () => {
  it('opens a file that is still where it was resolved', async () => {
    const r = await openPdfHandle(file, root);
    expect(typeof r).toBe('object');
    if (typeof r === 'object') await r.fh.close();
  });

  it('works without a root (no re-check)', async () => {
    const r = await openPdfHandle(file);
    expect(typeof r).toBe('object');
    if (typeof r === 'object') await r.fh.close();
  });

  it('refuses when the path now resolves somewhere else (a link swapped in)', async () => {
    fsMock.realpath = async (p) => (p === file ? path.join(outside, 'secret.pdf') : p);
    expect(await openPdfHandle(file, root)).toBe('outside');
  });

  it('refuses when the real path left the root even if it kept its spelling', async () => {
    const elsewhere = path.join(outside, 'secret.pdf');
    fsMock.realpath = async (p) => p;
    expect(await openPdfHandle(elsewhere, root)).toBe('outside');
  });

  it('refuses when the opened file is not the file the path points to now (same name, other inode)', async () => {
    const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const st = await real.stat(file);
    fsMock.stat = async () => ({ ...st, ino: st.ino === 7 ? 8 : 7, dev: st.dev + 1 });
    expect(await openPdfHandle(file, root)).toBe('outside');
  });

  it('refuses when the root cannot be resolved any more', async () => {
    fsMock.realpath = async (p) => {
      if (p === root) throw new Error('gone');
      return p;
    };
    expect(await openPdfHandle(file, root)).toBe('outside');
  });
});
