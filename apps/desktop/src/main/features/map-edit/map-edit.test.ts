import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { documentRecordSchema, taxonomyFileSchema, type DocumentRecord } from '@rl/core';
import { createLibraryStore, createOrganizer, type FileLibraryStore, type Organizer } from '@rl/data';
import { NO_VALUE_BLOCK, OTHER_BLOCK, layoutBlocks, mainValue, valueStats } from '@rl/graph';
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
    // A block exists only where papers are: `b` is a block of the topic because papers 3 and 4 use it.
    await setup(nodes, [doc(1, ['a', 'kid']), doc(2, ['a', 'kid']), doc(3, ['b']), doc(4, ['b'])]);
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
    // With no vocabulary the group by co-occurrence is only offered: it starts unticked (D-568); asking with `skip: []` is the whole cut.
    const start = await macroPropose(s, { family: 'root:field' });
    expect(start.skipped).toEqual(['gather:new:a+b']);
    const p = await macroPropose(s, { family: 'root:field', skip: [] });
    expect(p.moves.map((m) => m.id)).toEqual(['split:g', 'gather:new:a+b']);
    expect(p.moves[1]).toMatchObject({ cooc: true });
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
    // A `root:` family: the preview is what the Map reads from the values of level 1 under the root after Apply (D-561).
    const view = await loadView(await s.runtime.require());
    const v = await valuesOf(s, view, undefined, 'root:field', view.records);
    const st = valueStats(v.docs.values());
    expect({ clearPct: Math.round((st.clear / st.withValue) * 100), blocks: st.main.size, coverage: Math.round((st.withValue / all.length) * 100) }).toEqual({ clearPct: p.after.clearPct, blocks: p.after.blocks, coverage: p.after.coverage });
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

  describe('with a field vocabulary (D-568)', () => {
    // `amber` and `cobalt` meet on most works; `copper` matches nothing; `tiny` is on one work.
    const fieldNodes = [node('topic', { family: 'many' }), ...['amber', 'cobalt', 'copper', 'tiny'].map((id) => node(id, { parents: ['topic'] }))];
    const fieldDocs = () => {
      let n = 0;
      const mk = (count: number, tags: string[]) => Array.from({ length: count }, () => doc(++n, tags));
      return [...mk(30, ['amber', 'cobalt']), ...mk(5, ['amber']), ...mk(5, ['cobalt']), ...mk(7, ['copper']), ...mk(1, ['tiny'])];
    };
    const hooks = {
      latent: async () => [
        { id: 'f-amber', label: 'Amber field', covers: ['amber'], top: true },
        { id: 'f-cobalt', label: 'Cobalt field', covers: ['cobalt'], top: true },
      ],
      fixed: async () => [],
      // The seam of the vocabulary, as the pack's `materialization` does it: a node alone under the family root.
      materialize: async (concepts: readonly string[], ops: unknown[], root?: string) => [...concepts.map((c) => ({ op: 'create', id: c, label: c, parents: root ? [root] : [] })), ...ops] as never,
    };
    const shows = async () => {
      const view = await loadView(await s.runtime.require());
      const v = await valuesOf(s, view, undefined, 'topic', view.records);
      const placed = view.records.map((r) => ({ id: r.id, value: mainValue(v.docs.get(r.id) ?? []) }));
      return { v, placed, layout: layoutBlocks({ docs: placed, labels: v.labels, aspect: 1.6 }) };
    };

    it('the two areas that meet stay two macro-areas; the preview is the Map after Apply; the one-work area is in "Other"; Undo gives the taxonomy back', async () => {
      await setup(fieldNodes, fieldDocs());
      const taxBefore = await taxonomyText();
      const p = await macroPropose(s, { family: 'topic' }, hooks);
      expect(p.moves.map((m) => m.id)).toEqual(['gather:f-amber', 'gather:f-cobalt']);
      expect(p.moves.every((m) => !m.cooc && m.children.length === 1)).toBe(true);
      expect(p.skipped).toEqual([]);
      const r = await macroApply(s, { family: 'topic', moves: p.moves.map((m) => m.id), names: {} }, hooks);
      expect(r.applied).toBe(2);
      const tax = (await org.taxonomy()).nodes;
      expect(tax.find((n) => n.id === 'amber')?.parents).toEqual(['f-amber']);
      expect(tax.find((n) => n.id === 'cobalt')?.parents).toEqual(['f-cobalt']);
      expect(tax.find((n) => n.id === 'f-amber')?.parents).toEqual(['topic']);
      expect(tax.find((n) => n.id === 'copper')?.parents).toEqual(['topic']);
      const after = await shows();
      // Every paper has a main macro-area; the blocks are the areas used, `tiny` only inside "Other".
      expect(after.placed.every((d) => d.value !== null)).toBe(true);
      expect(after.layout.blocks.map((b) => b.id).sort()).toEqual([OTHER_BLOCK, 'copper', 'f-amber', 'f-cobalt'].sort());
      expect(after.layout.blocks.find((b) => b.id === OTHER_BLOCK)?.count).toBe(1);
      expect(p.after.blocks).toBe(after.layout.blocks.length);
      expect(p.cut.map((c) => c.papers).sort((a, b) => b - a)).toEqual(after.layout.blocks.map((b) => b.count).sort((a, b) => b - a));
      // The main area of a paper is the same every time it is asked (ties: id).
      expect((await shows()).placed).toEqual(after.placed);
      await org.undo();
      expect(await taxonomyText()).toBe(taxBefore);
    });
  });

  describe('Topic with 14 small values on 26 works (D-561)', () => {
    const values = Array.from({ length: 14 }, (_, i) => `v${String(i + 1).padStart(2, '0')}`);
    const works = [
      ['v01', 'v02'], ['v01', 'v02'], ['v02', 'v03'], ['v01', 'v03'], ['v01', 'v02', 'v03'], ['v02'],
      ['v04', 'v05'], ['v04', 'v05'], ['v05', 'v06'], ['v04', 'v06'], ['v04', 'v05', 'v06'], ['v04', 'v05', 'v09'],
      ['v07', 'v08'], ['v07', 'v08'], ['v08', 'v09'], ['v07', 'v09', 'v02'], ['v08'],
      ['v10', 'v11'], ['v11', 'v12'], ['v10', 'v12', 'v03'], ['v10', 'v11', 'v12'],
      ['v13', 'v14'], ['v13'],
      ['v03', 'v04'], ['v06', 'v07'], ['v09', 'v10'],
    ];
    /** What the Map shows for Topic now: its values, the main value of each work, the clarity of §19.2.2 and the blocks as laid out. */
    const mapShows = async () => {
      const view = await loadView(await s.runtime.require());
      const v = await valuesOf(s, view, undefined, 'topic', view.records);
      const lists = [...v.docs.values()];
      const st = valueStats(lists);
      const placed = view.records.map((r) => ({ id: r.id, value: mainValue(v.docs.get(r.id) ?? []) }));
      const blocks = layoutBlocks({ docs: placed, labels: v.labels, aspect: 1.6 }).blocks.filter((b) => b.id !== NO_VALUE_BLOCK);
      // The values under 2 works are inside "Other" (D-568); the smallest block is one of a value of its own.
      const counts = blocks.map((b) => b.count);
      const own = blocks.filter((b) => b.id !== OTHER_BLOCK).map((b) => b.count);
      const n = view.records.length;
      return { blocks: counts.length, clearPct: Math.round((st.clear / st.withValue) * 100), coverage: Math.round((st.withValue / n) * 100), largestPct: Math.round((Math.max(...counts) / n) * 100), smallest: own.length > 0 ? Math.min(...own) : counts[0]! };
    };

    it('the preview is what the Map shows after Apply, and Undo brings the taxonomy back byte for byte', async () => {
      await setup([node('topic', { family: 'many' }), ...values.map((id) => node(id, { parents: ['topic'] }))], works.map((tags, i) => doc(i + 1, tags)));
      const taxBefore = await taxonomyText();
      // The whole offer (`skip: []`): without a vocabulary the groups by co-occurrence start unticked, here the user ticks them all.
      const p = await macroPropose(s, { family: 'topic', skip: [] });
      expect(p.before).toEqual(await mapShows());
      expect(p.before).toMatchObject({ clearPct: 12, smallest: 2 });
      expect(p.moves.every((m) => m.cooc)).toBe(true);
      expect((await macroPropose(s, { family: 'topic' })).skipped).toHaveLength(p.moves.length);
      expect(p.after.blocks).toBeGreaterThanOrEqual(4);
      expect(p.after.blocks).toBeLessThanOrEqual(7);
      expect(p.after.largestPct).toBeLessThanOrEqual(50);
      expect(p.after.clearPct).toBeGreaterThan(p.before.clearPct);

      const r = await macroApply(s, { family: 'topic', moves: p.moves.map((m) => m.id), names: {} });
      expect(r.applied).toBe(p.moves.length);
      expect(await mapShows()).toEqual(p.after);
      expect(p.cut.map((c) => c.papers).sort((a, b) => b - a)).toHaveLength(p.after.blocks);
      expect((await org.listHistory()).filter((h) => h.changeId === r.changeId)).toHaveLength(1);

      await org.undo();
      expect(await taxonomyText()).toBe(taxBefore);
      expect(await mapShows()).toEqual(p.before);
    });
  });
});
