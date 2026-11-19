import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExportTarget, moveNew } from './target.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'rl-new-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('exclusive creation', () => {
  it('writeNew creates a file and never replaces one that exists', async () => {
    const t = new ExportTarget(dir);
    expect(await t.writeNew('a.txt', 'first')).toBe(true);
    expect(await t.writeNew('a.txt', 'second')).toBe(false);
    expect(await readFile(path.join(dir, 'a.txt'), 'utf8')).toBe('first');
    // No temporary is left behind.
    expect(await readdir(dir)).toEqual(['a.txt']);
  });
  it('a file created by someone else just before is kept', async () => {
    const t = new ExportTarget(dir);
    await writeFile(path.join(dir, 'b.txt'), 'theirs');
    expect(await t.writeNew('b.txt', 'ours')).toBe(false);
    expect(await readFile(path.join(dir, 'b.txt'), 'utf8')).toBe('theirs');
  });
  it('of several concurrent writers of one name exactly one wins', async () => {
    const t = new ExportTarget(dir);
    const r = await Promise.all(Array.from({ length: 6 }, (_, i) => t.writeNew('c.txt', `v${i}`)));
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(await readdir(dir)).toEqual(['c.txt']);
  });
  it('moveNew moves a finished file into a free name and reports a taken one', async () => {
    const from = path.join(dir, 'tmp1');
    await writeFile(from, 'x');
    expect(await moveNew(from, path.join(dir, 'out'))).toBe(true);
    await writeFile(from, 'y');
    expect(await moveNew(from, path.join(dir, 'out'))).toBe(false);
    expect(await readFile(path.join(dir, 'out'), 'utf8')).toBe('x');
  });
});
