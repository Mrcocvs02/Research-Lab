import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyNames, placeNew } from './pdf-copy.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'rl-copy-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('the name of an annotated copy', () => {
  it('numbers the candidates and cleans the base name', () => {
    const n = copyNames('/x/Some: Paper?.pdf');
    expect(n[0]).toBe('Some_ Paper_ (annotated).pdf');
    expect(n[1]).toBe('Some_ Paper_ (annotated 2).pdf');
  });
  it('places the file under the first free name and never replaces an existing one', async () => {
    await writeFile(path.join(dir, 'P (annotated).pdf'), 'user file');
    const out = path.join(dir, '.tmp-out');
    await writeFile(out, 'copy');
    expect(await placeNew(dir, 'P.pdf', out)).toBe('P (annotated 2).pdf');
    expect(await readFile(path.join(dir, 'P (annotated).pdf'), 'utf8')).toBe('user file');
    expect((await readdir(dir)).sort()).toEqual(['P (annotated 2).pdf', 'P (annotated).pdf']);
  });
});
