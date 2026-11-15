import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import { DEFAULT_MAX_READ_BYTES, readJsonFile, readTextFileLimited } from './atomic.js';
import { resolveInRoot, splitRelativePath } from './paths.js';
import { z } from 'zod';

let tmp: string;
let root: string;
let outside: string;

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'rl-paths-')));
  root = path.join(tmp, 'lib');
  outside = path.join(tmp, 'outside');
  await mkdir(path.join(root, 'sub'), { recursive: true });
  await mkdir(outside, { recursive: true });
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof AppError ? e.code : `other:${String(e)}`;
  }
};
const errorCode = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return e instanceof AppError ? e.code : `other:${String(e)}`;
  }
};

describe('Windows device names and trailing space or dot', () => {
  it.each([
    'CONIN$',
    'conout$',
    'CONOUT$.txt',
    'COM¹',
    'COM²',
    'COM³',
    'LPT¹',
    'lpt².log',
    'LPT³',
    'CON',
    'nul.txt',
    'sub/COM1',
    'com1.tar.gz',
    'AUX',
    'con .txt',
  ])('rejects the reserved name %j', (p) => expect(errorCode(() => splitRelativePath(p))).toBe('INVALID_PATH'));

  it.each(['a ', 'a.', 'dir./x', 'x/y ', '...', 'a. ', 'sub/name.'])('rejects a segment ending in a space or a dot: %j', (p) =>
    expect(errorCode(() => splitRelativePath(p))).toBe('INVALID_PATH'),
  );

  it.each(['.lab', 'a.b', ' leading', 'console', 'conin', 'com10', 'lpt', 'x/./y'])('still accepts %j', (p) => expect(errorCode(() => splitRelativePath(p))).toBe('ok'));

  it('applies through resolveInRoot', async () => {
    expect(await code(resolveInRoot(root, 'sub/trailing.'))).toBe('INVALID_PATH');
    expect(await code(resolveInRoot(root, 'CONIN$'))).toBe('INVALID_PATH');
    expect(await code(resolveInRoot(root, 'sub/ok.txt'))).toBe('ok');
  });
});

describe('dangling links', () => {
  const makeDangling = async (name: string, target: string): Promise<boolean> => {
    const link = path.join(root, name);
    try {
      await mkdir(target, { recursive: true });
      await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return false; // cannot create links in this environment
    }
    await rm(target, { recursive: true, force: true });
    return true;
  };

  it('a dangling link to a place outside the root is refused, also for new files below it', async () => {
    if (!(await makeDangling('dangling-out', path.join(tmp, 'gone-outside')))) return;
    expect(await code(resolveInRoot(root, 'dangling-out'))).toBe('PATH_OUTSIDE_ROOT');
    expect(await code(resolveInRoot(root, 'dangling-out/new.txt'))).toBe('PATH_OUTSIDE_ROOT');
    expect(await code(resolveInRoot(root, 'dangling-out/a/b/c.json'))).toBe('PATH_OUTSIDE_ROOT');
  });

  it('a dangling link to a not-yet-existing place inside the root resolves to that place', async () => {
    const target = path.join(root, 'sub', 'will-exist');
    if (!(await makeDangling('dangling-in', target))) return;
    expect(await resolveInRoot(root, 'dangling-in')).toBe(target);
    expect(await resolveInRoot(root, 'dangling-in/new.txt')).toBe(path.join(target, 'new.txt'));
  });

  it('a link that leads out through another dangling link is refused', async () => {
    const outsideTarget = path.join(tmp, 'gone-two');
    if (!(await makeDangling('hop-1', outsideTarget))) return;
    const hop2 = path.join(root, 'hop-2');
    try {
      await symlink(path.join(root, 'hop-1'), hop2, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }
    expect(await code(resolveInRoot(root, 'hop-2/x.txt'))).toBe('PATH_OUTSIDE_ROOT');
  });
});

describe('size-limited reads', () => {
  it('reads files up to the limit and refuses bigger ones, however they grow', async () => {
    const small = path.join(tmp, 'small.json');
    await writeFile(small, JSON.stringify({ a: 1 }));
    expect(await readJsonFile(small, z.object({ a: z.number() }), { maxBytes: 100 })).toEqual({ a: 1 });

    const big = path.join(tmp, 'big.json');
    await writeFile(big, JSON.stringify({ a: 'x'.repeat(5000) }));
    expect(await code(readJsonFile(big, z.object({ a: z.string() }), { maxBytes: 1000 }))).toBe('INVALID_REQUEST');
    expect(await code(readTextFileLimited(big, 4999))).toBe('INVALID_REQUEST');
    expect((await readTextFileLimited(big, 6000)).length).toBeGreaterThan(5000);
  });

  it('reports missing files and directories, and has a 16 MiB default', async () => {
    expect(await code(readTextFileLimited(path.join(tmp, 'nope.json')))).toBe('NOT_FOUND');
    expect(await code(readTextFileLimited(tmp))).not.toBe('ok');
    expect(DEFAULT_MAX_READ_BYTES).toBe(16 * 1024 * 1024);
  });
});
