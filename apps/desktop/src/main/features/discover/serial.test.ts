import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DiscoverRun } from '@rl/core';
import type { MainServices } from '../../ipc/handlers/services.js';
import { setPrisma } from './prisma.js';
import { readRun, serialRun, writeRun } from './store.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'rl-disc-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const cand = (key: string) => ({ key, title: null, authors: [], year: null, venue: null, doi: null, arxivId: null, score: 0.5, reasons: [], state: 'new', weak: false, fresh: false, summary: null });
const run = (): DiscoverRun =>
  ({ id: 'run1', kind: 'question', title: 'q', createdAt: '2026-01-01T00:00:00.000Z', outcome: 'ok', candidates: 2, fresh: 0, sides: [], missing: [], local: [], seedCount: 0, summarizedWith: null, items: [cand('W1'), cand('W2')] }) as unknown as DiscoverRun;

describe('marks of a search', () => {
  it('read-modify-write steps of one run go one after the other and keep every change', async () => {
    await writeRun(dir, run());
    const mark = (key: string) =>
      serialRun('run1', async () => {
        const cur = (await readRun(dir, 'run1'))!;
        await new Promise((r) => setTimeout(r, key === 'W1' ? 20 : 0));
        await writeRun(dir, { ...cur, items: cur.items.map((c) => (c.key === key ? { ...c, state: 'dismissed' } : c)) } as DiscoverRun);
      });
    await Promise.all([mark('W1'), mark('W2')]);
    expect((await readRun(dir, 'run1'))!.items.map((c) => c.state)).toEqual(['dismissed', 'dismissed']);
  });
  it('a failing step does not block the next one', async () => {
    await expect(serialRun('x', () => Promise.reject(new Error('no')))).rejects.toThrow('no');
    await expect(serialRun('x', async () => 5)).resolves.toBe(5);
  });
  it('a missing file is null, a file that cannot be read is an error and not "no file"', async () => {
    expect(await readRun(dir, 'nope')).toBeNull();
    await mkdir(path.join(dir, 'discover', 'runs', 'busy.json'), { recursive: true });
    await expect(readRun(dir, 'busy')).rejects.toBeDefined();
  });
});

describe('PRISMA figures', () => {
  it('are not rewritten from an empty state when the file cannot be read', async () => {
    await mkdir(path.join(dir, 'discover', 'prisma', 'proj1.json'), { recursive: true });
    const s = { runtime: { require: async () => ({ store: { dataDir: dir, projects: { get: async () => ({ id: 'proj1' }) } } }) } } as unknown as MainServices;
    const counts = { identified: [], duplicates: 0, screened: 0, excludedScreening: 0, assessed: 0, excludedFull: [], included: 0 };
    await expect(setPrisma(s, 'proj1', counts)).rejects.toBeDefined();
  });
});
