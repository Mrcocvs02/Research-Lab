import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupDataDir } from './backup.js';
import { NameIndex, normalizeName, slugify, uniqueId } from './normalize.js';
import { isTransientIoError, withRetry } from './retry.js';
import { removeDir, tempDir } from './test-utils.js';

describe('normalization', () => {
  it('ignores case, accents, underscores and spacing', () => {
    expect(normalizeName('  Élan   Vital_Test ')).toBe('elan vital test');
    expect(normalizeName('ÀÈÌ')).toBe('aei');
  });
  it('makes url-safe unique slugs', () => {
    expect(slugify('Many-body physics!')).toBe('many-body-physics');
    expect(slugify('Città')).toBe('citta');
    expect(slugify('!!!')).toMatch(/^x-[0-9a-f]{8}$/);
    const taken = new Set<string>();
    expect([uniqueId('a', taken), uniqueId('a', taken), uniqueId('a', taken)]).toEqual(['a', 'a-2', 'a-3']);
  });
  it('resolves names and aliases, first owner wins', () => {
    const idx = new NameIndex();
    expect(idx.add('Machine Learning', 'ml')).toBe(true);
    expect(idx.add('ML', 'ml')).toBe(true);
    expect(idx.add('ml', 'other')).toBe(false);
    expect(idx.resolve('machine  learning')).toBe('ml');
    expect(idx.resolve('ML')).toBe('ml');
    expect(idx.resolve('nope')).toBeUndefined();
  });
});

describe('withRetry', () => {
  it('retries transient lock errors only', async () => {
    let n = 0;
    const out = await withRetry(
      async () => {
        if (++n < 3) throw Object.assign(new Error('x'), { code: 'EBUSY' });
        return 'ok';
      },
      { baseDelayMs: 1 },
    );
    expect(out).toBe('ok');
    expect(n).toBe(3);
    let m = 0;
    await expect(
      withRetry(async () => {
        m++;
        throw Object.assign(new Error('x'), { code: 'ENOENT' });
      }),
    ).rejects.toThrow();
    expect(m).toBe(1);
    expect(isTransientIoError(Object.assign(new Error(), { code: 'EPERM' }))).toBe(true);
  });
  it('gives up after the attempts', async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw Object.assign(new Error('x'), { code: 'EPERM' });
        },
        { attempts: 3, baseDelayMs: 1 },
      ),
    ).rejects.toThrow();
    expect(n).toBe(3);
  });
});

describe('backupDataDir', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await tempDir();
  });
  afterEach(() => removeDir(tmp));

  it('copies the whole data dir into a dated folder', async () => {
    const data = path.join(tmp, '.lab');
    await mkdir(path.join(data, 'documents'), { recursive: true });
    await writeFile(path.join(data, 'library.json'), '{"a":1}');
    await writeFile(path.join(data, 'documents', 'x.json'), '{}');
    const res = await backupDataDir(data, path.join(tmp, 'backups'), new Date('2026-03-04T05:06:07Z'));
    expect(res?.files).toBe(2);
    expect(path.basename(res?.backupDir ?? '')).toBe('lab-20260304-050607Z');
    expect(await readFile(path.join(res?.backupDir ?? '', 'documents', 'x.json'), 'utf8')).toBe('{}');
    const again = await backupDataDir(data, path.join(tmp, 'backups'), new Date('2026-03-04T05:06:07Z'));
    expect(again?.backupDir).not.toBe(res?.backupDir);
    expect(await readdir(path.join(tmp, 'backups'))).toHaveLength(2);
  });

  it('does nothing when the data dir does not exist', async () => {
    expect(await backupDataDir(path.join(tmp, 'missing'), path.join(tmp, 'backups'))).toBeNull();
    await expect(stat(path.join(tmp, 'backups'))).rejects.toThrow();
  });

  it('refuses a backup folder inside the data dir', async () => {
    const data = path.join(tmp, '.lab');
    await mkdir(data);
    await expect(backupDataDir(data, path.join(data, 'b'))).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });
});
