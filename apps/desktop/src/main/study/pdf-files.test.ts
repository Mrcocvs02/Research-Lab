import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { replaceGuarded, writeTempWithAppend } from './pdf-files.js';

describe('writeTempWithAppend (M3)', () => {
  let dir = '';
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('cuts a tail that grew after the analysis: the temporary is the old prefix plus the update only', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'rl-pdf-files-'));
    const abs = path.join(dir, 'a.pdf');
    const tmp = path.join(dir, 'a.tmp');
    await writeFile(abs, Buffer.from('0123456789-GROWN-TAIL'));
    await writeTempWithAppend(abs, tmp, Buffer.from('UPD'), 10);
    expect((await readFile(tmp)).toString()).toBe('0123456789UPD');
  });
});

describe('replaceGuarded (J5)', () => {
  let dir = '';
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  async function setup() {
    dir = await mkdtemp(path.join(os.tmpdir(), 'rl-pdf-guard-'));
    const dest = path.join(dir, 'a.pdf');
    const tmp = path.join(dir, '.a.pdf.rl-00000001.tmp');
    await writeFile(dest, 'ORIGINAL');
    await writeFile(tmp, 'ORIGINAL+UPDATE');
    return { dest, tmp, hash: sha(Buffer.from('ORIGINAL')) };
  }

  it('replaces the file it expected and leaves no extra file', async () => {
    const { dest, tmp, hash } = await setup();
    expect(await replaceGuarded(tmp, dest, hash)).toBe('replaced');
    expect((await readFile(dest)).toString()).toBe('ORIGINAL+UPDATE');
    expect(await readdir(dir)).toEqual(['a.pdf']);
  });

  it('a file already different from the expected one is not replaced', async () => {
    const { dest, tmp } = await setup();
    expect(await replaceGuarded(tmp, dest, sha(Buffer.from('SOMETHING ELSE')))).toBe('changed');
    expect((await readFile(dest)).toString()).toBe('ORIGINAL');
  });
});
