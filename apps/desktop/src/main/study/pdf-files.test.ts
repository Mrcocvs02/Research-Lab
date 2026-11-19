import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeTempWithAppend } from './pdf-files.js';

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
