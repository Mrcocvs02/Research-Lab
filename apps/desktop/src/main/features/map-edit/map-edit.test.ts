import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { documentRecordSchema, taxonomyFileSchema, type DocumentRecord } from '@rl/core';
import { createLibraryStore, createOrganizer, type FileLibraryStore, type Organizer } from '@rl/data';
import { valuesOf } from '../../graph/family-run.js';
import { macroApply, macroPropose } from '../../graph/macro-run.js';
import { loadView } from '../../graph/view.js';
import type { MainServices } from '../../ipc/handlers/services.js';
import { move } from './move.js';

const NOW = '2026-01-02T03:04:05.000Z';
const hex = (n: number) => n.toString(16).padStart(16, '0');
const doc = (n: number, tags: string[]): DocumentRecord => documentRecordSchema.parse({ id: hex(n), hash: 'a'.repeat(64), path: `docs/f${n}.pdf`, size: 1, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, tags });
const node = (id: string, over: Record<string, unknown> = {}) => ({ id, label: id.toUpperCase(), parents: [], aliases: [], implies: [], status: 'active', origin: 'user', ...over });

let root: string;
let store: FileLibraryStore;
let org: Organizer;
let s: MainServices;
const read = async (n: number) => (await store.documents.get(hex(n))) as DocumentRecord;
const content = (d: DocumentRecord) => JSON.stringify({ ...d, revision: 0, updatedAt: '' });
/** taxonomy.json as written, without the revision counter the store moves at every write. */
const taxonomyText = async () => (await readFile(path.join(store.dataDir, 'taxonomy.json'), 'utf8')).replace(/"revision":\s*\d+/, '"revision": 0');

async function setup(nodes: unknown[], docs: DocumentRecord[]) {
  await store.init();
  await store.writeTaxonomy(taxonomyFileSchema.parse({ nodes }));
  for (const d of docs) await store.documents.put(d);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rl-mapedit-'));
  store = createLibraryStore({ rootPath: root, deviceId: 'dev-1' });
  org = createOrganizer({ store, deviceId: 'dev-1', cacheTtlMs: 0 });
  const rt = { libraryId: 'lib', store, organizer: org, reindexDocuments: async () => {} };
  s = { log: { warn() {}, info() {}, error() {}, debug() {} }, emit: () => {}, runtime: { require: async () => rt } } as unknown as MainServices;
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('mapEdit:move', () => {
  const nodes = [node('topic', { family: 'many' }), node('a', { parents: ['topic'] }), node('kid', { parents: ['a'] }), node('b', { parents: ['topic'] }), node('place', { family: 'one' }), node('x', { parents: ['place'] }), node('y', { parents: ['place'] })];

  it('a family of one value replaces the value; no value takes the family off', async () => {
    await setup(nodes, [doc(1, ['x', 'a']), doc(2, ['y'])]);
    const r = await move(s, { family: 'root:place', docIds: [hex(1), hex(2)], to: 'y' });
    expect(r).toMatchObject({ changed: 1, removed: ['X'], already: 1 });
    expect((await read(1)).tags).toEqual(['a', 'y']);
    const none = await move(s, { family: 'root:place', docIds: [hex(1)], to: null });
    expect(none.changed).toBe(1);
    expect((await read(1)).tags).toEqual(['a']);
  });

  it('several values: the target is fixed as main value and the others stay; removeFrom takes the old value with its tags; one change, undone as one', async () => {
    await setup(nodes, [doc(1, ['a', 'kid']), doc(2, ['a', 'kid'])]);
    const before = content(await read(1));
    const r = await move(s, { family: 'topic', docIds: [hex(1)], to: 'b' });
    expect(await read(1)).toMatchObject({ tags: ['a', 'kid', 'b'], mainTags: { topic: 'b' } });
    const v = await valuesOf(s, await loadView(await s.runtime.require()), undefined, 'topic', (await loadView(await s.runtime.require())).records);
    expect(v.docs.get(hex(1))?.pin).toBe('b');
    expect(v.docs.get(hex(2))?.pin).toBeUndefined();
    await org.undo();
    expect(content(await read(1))).toBe(before);
    const out = await move(s, { family: 'topic', docIds: [hex(2)], to: 'b', removeFrom: true });
    expect(out.removed).toEqual(['A', 'KID']);
    expect((await read(2)).tags).toEqual(['b']);
    expect(r.changeId).not.toBeNull();
  });

  it('refuses a family that is not editable and a target that is not a value of the family', async () => {
    await setup(nodes, [doc(1, ['a'])]);
    await expect(move(s, { family: 'auto', docIds: [hex(1)], to: 'a' })).rejects.toMatchObject({ code: 'INVALID_REQUEST', details: { reason: 'family' } });
    await expect(move(s, { family: 'level:method', docIds: [hex(1)], to: 'a' })).rejects.toMatchObject({ details: { reason: 'family' } });
    await expect(move(s, { family: 'root:place', docIds: [hex(1)], to: 'a' })).rejects.toMatchObject({ details: { reason: 'target' } });
    await expect(move(s, { family: 'root:place', docIds: [hex(1)], to: '__other' })).rejects.toMatchObject({ details: { reason: 'target' } });
  });
});

describe('macro-areas', () => {
  const nodes = [node('field', { family: 'many' }), node('g', { parents: ['field'] }), ...[1, 2, 3, 4].map((i) => node(`c${i}`, { parents: ['g'] })), ...['a', 'b', 'c', 'd'].map((id) => node(id, { parents: ['field'] }))];
  const docs = () => {
    let n = 0;
    const mk = (count: number, tags: (i: number) => string[]) => Array.from({ length: count }, (_, i) => doc(++n, tags(i)));
    return [...mk(60, (i) => ['g', `c${(i % 4) + 1}`]), ...mk(25, () => ['a', 'b']), ...mk(3, () => ['a']), ...mk(3, () => ['b']), ...mk(15, () => ['c']), ...mk(14, () => ['d'])];
  };

  it('proposes the cut, applies it as ONE change and an undo brings the taxonomy back without a document written', async () => {
    const all = docs();
    await setup(nodes, all);
    const taxBefore = await taxonomyText();
    const docsBefore = await Promise.all(all.map((_, i) => read(i + 1)));
    const p = await macroPropose(s, { family: 'root:field' });
    expect(p.moves.map((m) => m.id)).toEqual(['split:g', 'gather:new:a+b']);
    expect(p.after.clearPct).toBeGreaterThan(p.before.clearPct);
    expect(p.unclear).toHaveLength(25);
    expect((await macroPropose(s, { family: 'root:field', skip: ['split:g'] })).skipped).toEqual(['split:g']);

    const r = await macroApply(s, { family: 'root:field', moves: p.moves.map((m) => m.id), names: { 'gather:new:a+b': 'Waves' } });
    expect(r.applied).toBe(2);
    const t = (await org.taxonomy()).nodes;
    expect(t.find((n) => n.id === 'waves')?.parents).toEqual(['field']);
    expect(t.find((n) => n.id === 'a')?.parents).toEqual(['waves']);
    expect(t.find((n) => n.id === 'g')).toMatchObject({ parents: [], family: 'many' });
    expect(t.find((n) => n.id === 'c1')?.parents).toEqual(['field']);
    expect((await org.listHistory()).filter((h) => h.changeId === r.changeId)).toHaveLength(1);
    // The papers keep their tags and are not written.
    expect(await Promise.all(all.map((_, i) => read(i + 1)))).toEqual(docsBefore);

    await org.undo();
    expect(await taxonomyText()).toBe(taxBefore);
    expect(await Promise.all(all.map((_, i) => read(i + 1)))).toEqual(docsBefore);
  });

  it('refuses a move the proposal does not hold any more, and a family with no macro-areas', async () => {
    await setup(nodes, docs());
    await expect(macroApply(s, { family: 'root:field', moves: ['split:zzz'], names: {} })).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'stale' } });
    await expect(macroPropose(s, { family: 'auto' })).rejects.toMatchObject({ details: { reason: 'family' } });
  });
});
