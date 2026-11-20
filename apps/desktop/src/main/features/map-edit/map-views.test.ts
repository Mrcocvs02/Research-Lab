import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MapViewInput } from '@rl/core';
import type { MainServices } from '../../ipc/handlers/services.js';
import { list, remove, save } from './views.js';

let dataDir: string;
let s: MainServices;
const state = (family = 'topic'): MapViewInput['state'] => ({ family, filters: { kinds: ['cites', 'similar'], strictness: 'normal', edgeMode: 'selected', onlyUnread: true }, selection: ['0123456789abcdef'], focus: '0123456789abcdef', frame: { kind: 'camera', cx: 1, cy: 2, k: 0.5, sig: 'sig-1' } });
const view = (name: string, extra: Partial<MapViewInput> = {}): MapViewInput => ({ name, state: state(), ...extra });

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'rl-views-'));
  s = { runtime: { require: async () => ({ store: { dataDir } }) } } as unknown as MainServices;
});
afterEach(() => rm(dataDir, { recursive: true, force: true }));

describe('saved views of the Map (D-527)', () => {
  it('saves, lists and deletes; the file lives in the data folder', async () => {
    expect((await list(s)).views).toEqual([]);
    const a = (await save(s, view('Quantum papers', { projectId: 'proj-1' }))).view;
    expect(a).toMatchObject({ name: 'Quantum papers', projectId: 'proj-1', state: { frame: { kind: 'camera', sig: 'sig-1' } } });
    expect(a.id).toMatch(/^view-/);
    expect(JSON.parse(await readFile(path.join(dataDir, 'map-views.json'), 'utf8')).views).toHaveLength(1);
    expect((await list(s)).views.map((v) => v.id)).toEqual([a.id]);
    expect(await remove(s, a.id)).toEqual({ ok: true });
    expect((await list(s)).views).toEqual([]);
    expect(await remove(s, 'nope')).toEqual({ ok: true });
  });

  it('a repeated name gets a number, also in a rename; the same view keeps its own name', async () => {
    const a = (await save(s, view('Same'))).view;
    const b = (await save(s, view('same'))).view;
    const c = (await save(s, view('Same'))).view;
    expect([a.name, b.name, c.name]).toEqual(['Same', 'same (2)', 'Same (3)']);
    expect((await save(s, { ...view('Same'), id: a.id })).view.name).toBe('Same');
    expect((await save(s, { ...view('Same'), id: b.id })).view.name).toBe('Same (2)');
    // A name at the limit stays within 80 characters when the number is added.
    const long = 'x'.repeat(80);
    await save(s, view(long));
    expect((await save(s, view(long))).view.name).toHaveLength(80);
  });

  it('updating keeps the creation time and moves the update time; an unknown id (an undone deletion) is created again with its own', async () => {
    const a = (await save(s, view('A'))).view;
    await new Promise((r) => setTimeout(r, 5));
    const b = (await save(s, { ...view('A renamed'), id: a.id })).view;
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.updatedAt >= a.updatedAt).toBe(true);
    expect((await list(s)).views).toHaveLength(1);
    const again = (await save(s, { ...view('Back'), id: 'view-old', createdAt: '2026-01-01T00:00:00.000Z' })).view;
    expect(again).toMatchObject({ id: 'view-old', createdAt: '2026-01-01T00:00:00.000Z' });
  });

  it('at most 100 views', async () => {
    for (let i = 0; i < 100; i++) await save(s, view(`v${i}`));
    await expect(save(s, view('one too many'))).rejects.toMatchObject({ code: 'INVALID_REQUEST', details: { reason: 'limit' } });
    const first = (await list(s)).views[0]!;
    expect((await save(s, { ...view('renamed'), id: first.id })).view.name).toBe('renamed');
  });

  it('refuses a view that does not fit the schema, and a selection beyond 500', async () => {
    await expect(save(s, { name: '', state: state() })).rejects.toMatchObject({ details: { reason: 'view' } });
    await expect(save(s, view('big', { state: { ...state(), selection: Array.from({ length: 501 }, (_, i) => i.toString(16).padStart(16, '0')) } }))).rejects.toMatchObject({ details: { reason: 'view' } });
  });

  it('a damaged file is an error that says so, and is never overwritten; one view that does not fit is left out', async () => {
    const file = path.join(dataDir, 'map-views.json');
    await writeFile(file, '{ not json');
    await expect(list(s)).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
    await expect(save(s, view('x'))).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
    expect(await readFile(file, 'utf8')).toBe('{ not json');
    await writeFile(file, JSON.stringify({ version: 1, views: [{ id: 'bad' }] }));
    expect((await list(s)).views).toEqual([]);
  });
});
