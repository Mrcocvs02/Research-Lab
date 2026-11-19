import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeLiterature } from '../features/literature/store.js';
import { isApprovedNote, readNote } from './note-store.js';

const ID = '0123456789abcdef';
let dir: string;
beforeEach(async () => void (dir = await mkdtemp(path.join(os.tmpdir(), 'rl-note-'))));
afterEach(async () => rm(dir, { recursive: true, force: true }));

describe('note store and the user approval (I2)', () => {
  it('an approved note is reported as approved and a proposed one is not', async () => {
    const base = { body: '# Note\ntext', ai: true, model: 'm', generatedAt: null, abstractOnly: false };
    await writeLiterature(dir, ID, { ...base, review: 'proposed' }, 'v');
    expect(await isApprovedNote(dir, ID)).toBe(false);
    await writeLiterature(dir, ID, { ...base, review: 'approved' }, 'v');
    expect(await isApprovedNote(dir, ID)).toBe(true);
    expect(await readNote(dir, ID)).toContain('text');
  });
  it('the abstract-only note is neither read as a summary nor protected', async () => {
    await writeLiterature(dir, ID, { body: 'abstract', review: 'approved', ai: false, model: null, generatedAt: null, abstractOnly: true }, 'v');
    expect(await readNote(dir, ID)).toBeNull();
    expect(await isApprovedNote(dir, ID)).toBe(false);
  });
});
