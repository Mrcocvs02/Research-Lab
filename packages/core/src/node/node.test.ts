import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { atomicWriteFile, atomicWriteJson, readJsonFile } from './atomic.js';
import { createFileLogger } from './file-logger.js';
import { sha256File, sha256Of } from './hash.js';
import { isInside, normalizeRelativePath, resolveInRoot, splitRelativePath, toRelativePath } from './paths.js';

let tmp: string;
let root: string;
let outside: string;

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'rl-core-')));
  root = path.join(tmp, 'lib');
  outside = path.join(tmp, 'outside');
  await mkdir(path.join(root, 'sub'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(outside, 'secret.txt'), 'secret');
  await writeFile(path.join(root, 'sub', 'a.txt'), 'a');
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

describe('relative path validation (hostile inputs)', () => {
  it.each([
    ['..', 'PATH_OUTSIDE_ROOT'],
    ['../x', 'PATH_OUTSIDE_ROOT'],
    ['a/../../x', 'PATH_OUTSIDE_ROOT'],
    ['a\\..\\..\\x', 'PATH_OUTSIDE_ROOT'],
    ['/etc/passwd', 'PATH_OUTSIDE_ROOT'],
    ['\\windows\\system32', 'PATH_OUTSIDE_ROOT'],
    ['C:\\Windows\\win.ini', 'PATH_OUTSIDE_ROOT'],
    ['c:/windows', 'PATH_OUTSIDE_ROOT'],
    ['C:relative', 'PATH_OUTSIDE_ROOT'],
    ['\\\\server\\share\\x', 'PATH_OUTSIDE_ROOT'],
    ['//server/share/x', 'PATH_OUTSIDE_ROOT'],
    ['\\\\?\\C:\\Windows', 'PATH_OUTSIDE_ROOT'],
    ['\\\\.\\PhysicalDrive0', 'PATH_OUTSIDE_ROOT'],
    ['a/b.txt:stream', 'INVALID_PATH'],
    ['a/\0b', 'INVALID_PATH'],
    ['a/con', 'INVALID_PATH'],
    ['a/NUL.txt', 'INVALID_PATH'],
    ['a/b?.txt', 'INVALID_PATH'],
  ])('rejects %j', (input, expected) => {
    try {
      splitRelativePath(input);
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe(expected);
    }
  });

  it('rejects non-strings', () => {
    for (const v of [null, undefined, 3, {}, ['a']]) expect(() => splitRelativePath(v)).toThrow(AppError);
  });

  it('normalises benign paths', () => {
    expect(normalizeRelativePath('a//b/./c.pdf')).toBe('a/b/c.pdf');
    expect(normalizeRelativePath('a\\b\\c.pdf')).toBe('a/b/c.pdf');
    expect(normalizeRelativePath('')).toBe('');
    expect(normalizeRelativePath('cartella con spazi/èà.pdf')).toBe('cartella con spazi/èà.pdf');
    expect(normalizeRelativePath('..hidden/x')).toBe('..hidden/x');
  });
});

describe('isInside', () => {
  it('handles siblings with a common prefix and different drives', () => {
    expect(isInside(root, path.join(root, 'sub'))).toBe(true);
    expect(isInside(root, root)).toBe(true);
    expect(isInside(root, `${root}-evil`)).toBe(false);
    expect(isInside(root, path.dirname(root))).toBe(false);
  });
  it.runIf(process.platform === 'win32')('is case-insensitive on Windows and rejects other drives', () => {
    expect(isInside('C:\\Tmp\\Lib', 'c:\\tmp\\lib\\x')).toBe(true);
    expect(isInside('C:\\Tmp\\Lib', 'D:\\tmp\\lib\\x')).toBe(false);
    expect(isInside('C:\\Tmp\\Lib', '\\\\srv\\share\\x')).toBe(false);
  });
});

describe('resolveInRoot', () => {
  it('resolves existing and not-yet-existing paths inside the root', async () => {
    expect(await resolveInRoot(root, 'sub/a.txt')).toBe(path.join(root, 'sub', 'a.txt'));
    expect(await resolveInRoot(root, 'sub/new/deeper/file.json')).toBe(path.join(root, 'sub', 'new', 'deeper', 'file.json'));
    expect(await resolveInRoot(root, '')).toBe(root);
  });

  it('rejects traversal and absolute paths', async () => {
    expect(await code(resolveInRoot(root, '../outside/secret.txt'))).toBe('PATH_OUTSIDE_ROOT');
    expect(await code(resolveInRoot(root, path.join(outside, 'secret.txt')))).toBe('PATH_OUTSIDE_ROOT');
  });

  it('rejects a relative root', async () => {
    expect(await code(resolveInRoot('relative/root', 'a'))).toBe('INVALID_PATH');
  });

  it('rejects a missing root', async () => {
    expect(await code(resolveInRoot(path.join(tmp, 'nope'), 'a'))).toBe('NOT_FOUND');
  });

  it('rejects escapes through directory links (junction/symlink)', async () => {
    const link = path.join(root, 'link');
    try {
      await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return; // cannot create links in this environment
    }
    expect(await code(resolveInRoot(root, 'link/secret.txt'))).toBe('PATH_OUTSIDE_ROOT');
    expect(await code(resolveInRoot(root, 'link/not-yet/new.txt'))).toBe('PATH_OUTSIDE_ROOT');
    expect(await code(resolveInRoot(root, 'link'))).toBe('PATH_OUTSIDE_ROOT');
  });

  it('rejects escapes through file symlinks when allowed by the OS', async () => {
    const link = path.join(root, 'filelink.txt');
    try {
      await symlink(path.join(outside, 'secret.txt'), link, 'file');
    } catch {
      return; // file symlinks need privileges on Windows
    }
    expect(await code(resolveInRoot(root, 'filelink.txt'))).toBe('PATH_OUTSIDE_ROOT');
  });

  it.runIf(process.platform === 'win32')('works when the root is given with different letter case', async () => {
    const swapped = root.replace(/[a-z]/gi, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    expect(await resolveInRoot(swapped, 'sub/a.txt')).toBe(path.join(root, 'sub', 'a.txt'));
  });

  it('toRelativePath inverts resolution and refuses outside paths', () => {
    expect(toRelativePath(root, path.join(root, 'sub', 'a.txt'))).toBe('sub/a.txt');
    expect(() => toRelativePath(root, path.join(outside, 'secret.txt'))).toThrow(AppError);
  });
});

describe('atomic write', () => {
  it('writes, overwrites, creates parents and leaves no temp files', async () => {
    const f = path.join(tmp, 'atomic', 'deep', 'x.json');
    await atomicWriteJson(f, { a: 1 });
    await atomicWriteJson(f, { a: 2 });
    expect(JSON.parse(await readFile(f, 'utf8'))).toEqual({ a: 2 });
    expect((await readFile(f, 'utf8')).endsWith('\n')).toBe(true);
    expect(await readdir(path.dirname(f))).toEqual(['x.json']);
  });

  it('retries transient EBUSY/EPERM then succeeds', async () => {
    const f = path.join(tmp, 'retry.txt');
    let calls = 0;
    const { rename } = await import('node:fs/promises');
    await atomicWriteFile(f, 'ok', {
      baseDelayMs: 1,
      renameImpl: async (a, b) => {
        calls++;
        if (calls < 3) throw Object.assign(new Error('locked'), { code: calls === 1 ? 'EBUSY' : 'EPERM' });
        await rename(a, b);
      },
    });
    expect(calls).toBe(3);
    expect(await readFile(f, 'utf8')).toBe('ok');
  });

  it('gives up with IO_ERROR, cleans the temp file and keeps the old content', async () => {
    const f = path.join(tmp, 'giveup', 'k.txt');
    await atomicWriteFile(f, 'old');
    const err = await atomicWriteFile(f, 'new', {
      attempts: 3,
      baseDelayMs: 1,
      renameImpl: async () => {
        throw Object.assign(new Error('locked'), { code: 'EBUSY' });
      },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('IO_ERROR');
    expect(await readFile(f, 'utf8')).toBe('old');
    expect(await readdir(path.dirname(f))).toEqual(['k.txt']);
  });

  it('does not retry non-transient errors', async () => {
    let calls = 0;
    await atomicWriteFile(path.join(tmp, 'nr.txt'), 'x', {
      baseDelayMs: 1,
      renameImpl: async () => {
        calls++;
        throw Object.assign(new Error('nope'), { code: 'ENOSPC' });
      },
    }).catch(() => {});
    expect(calls).toBe(1);
  });

  it('readJsonFile validates', async () => {
    const f = path.join(tmp, 'v.json');
    await atomicWriteJson(f, { n: 1 });
    expect(await readJsonFile(f, z.object({ n: z.number() }))).toEqual({ n: 1 });
    expect(await code(readJsonFile(f, z.object({ n: z.string() })))).toBe('SCHEMA_INVALID');
    expect(await code(readJsonFile(path.join(tmp, 'missing.json'), z.object({})))).toBe('NOT_FOUND');
    await writeFile(f, '{oops');
    expect(await code(readJsonFile(f, z.object({})))).toBe('SCHEMA_INVALID');
    await writeFile(f, '\ufeff{"n":1}');
    expect(await readJsonFile(f, z.object({ n: z.number() }))).toEqual({ n: 1 });
  });
});

describe('hash', () => {
  it('matches the known SHA-256 of "abc" and agrees between stream and memory', async () => {
    const f = path.join(tmp, 'abc.txt');
    await writeFile(f, 'abc');
    const known = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(await sha256File(f)).toBe(known);
    expect(sha256Of('abc')).toBe(known);
  });
  it('hashes a larger file in a stream and reports NOT_FOUND', async () => {
    const f = path.join(tmp, 'big.bin');
    const buf = Buffer.alloc(3 * 1024 * 1024, 7);
    await writeFile(f, buf);
    expect(await sha256File(f)).toBe(sha256Of(buf));
    expect(await code(sha256File(path.join(tmp, 'none')))).toBe('NOT_FOUND');
  });
});

describe('file logger', () => {
  it('writes JSON lines, redacts secrets and respects level', async () => {
    const dir = path.join(tmp, 'logs');
    const log = createFileLogger({ dir, level: 'info' });
    log.debug('hidden');
    log.child('x').info('hello', { apiKey: 'sk-secret', text: 'document body', n: 1 });
    const content = await readFile(path.join(dir, 'app.log'), 'utf8');
    expect(content).not.toContain('sk-secret');
    expect(content).not.toContain('document body');
    expect(content).not.toContain('hidden');
    const line = JSON.parse(content.trim());
    expect(line).toMatchObject({ level: 'info', scope: 'x', msg: 'hello', fields: { n: 1 } });
  });
  it('rotates by size', async () => {
    const dir = path.join(tmp, 'logs2');
    const log = createFileLogger({ dir, maxBytes: 300, maxFiles: 2 });
    for (let i = 0; i < 20; i++) log.info('line', { i });
    const files = (await readdir(dir)).sort();
    expect(files).toContain('app.log');
    expect(files).toContain('app.1.log');
    expect(files.length).toBeLessThanOrEqual(3);
  });
});
