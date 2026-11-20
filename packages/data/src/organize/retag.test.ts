import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, documentRecordSchema, taxonomyFileSchema, taxonomyOpSchema, type DocumentRecord, type TaxonomyOp } from '@rl/core';
import { createLibraryStore, type FileLibraryStore } from '../store.js';
import { hex, removeDir, tempDir } from '../test-utils.js';
import { createOrganizer, type Organizer } from './organizer.js';
import { retagRecord } from './retag.js';

const NOW = '2026-01-02T03:04:05.000Z';
const doc = (n: number, over: Record<string, unknown> = {}): DocumentRecord => documentRecordSchema.parse({ id: hex(n), hash: 'a'.repeat(64), path: `docs/file-${n}.pdf`, size: 10, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, ...over });
const node = (id: string, over: Record<string, unknown> = {}) => ({ id, label: id.toUpperCase(), parents: [], aliases: [], implies: [], status: 'active', origin: 'user', ...over });
const ops = (...o: unknown[]): TaxonomyOp[] => o.map((x) => taxonomyOpSchema.parse(x));

let root: string;
let store: FileLibraryStore;
let org: Organizer;

/** Topic (several values): a, b, kid under a. Place (one value): x, y. */
async function seed(docs: DocumentRecord[]) {
  await store.init();
  await store.writeTaxonomy(
    taxonomyFileSchema.parse({
      nodes: [node('topic', { family: 'many' }), node('a', { parents: ['topic'] }), node('kid', { parents: ['a'] }), node('b', { parents: ['topic'] }), node('place', { family: 'one' }), node('x', { parents: ['place'] }), node('y', { parents: ['place'] })],
    }),
  );
  for (const d of docs) await store.documents.put(d);
}
const read = async (n: number) => (await store.documents.get(hex(n))) as DocumentRecord;
/** What an undo must bring back: the whole record but the counters the store moves at every write. */
const content = (d: DocumentRecord) => JSON.stringify({ ...d, revision: 0, updatedAt: '' });
const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  return null;
};

beforeEach(async () => {
  root = await tempDir();
  store = createLibraryStore({ rootPath: root, deviceId: 'dev-1' });
  org = createOrganizer({ store, deviceId: 'dev-1', cacheTtlMs: 0 });
});
afterEach(() => removeDir(root));

describe('retagRecord', () => {
  const rec = doc(1, { tags: ['a', 'kid'], tagOrigin: { a: 'ai' }, mainTags: { topic: 'a' } });
  it('adds and removes tags, drops the provenance of what it touches and the fixed values that lost their tag', () => {
    const next = retagRecord(rec, { docId: rec.id, add: ['b'], remove: ['a'] }, NOW + '1');
    expect(next.tags).toEqual(['kid', 'b']);
    expect(next.tagOrigin).toBeUndefined();
    expect(next.mainTags).toBeUndefined();
  });
  it('fixes and clears the main value of a family', () => {
    expect(retagRecord(rec, { docId: rec.id, add: ['b'], main: { key: 'topic', tag: 'b' } }, NOW).mainTags).toEqual({ topic: 'b' });
    expect(retagRecord(rec, { docId: rec.id, main: { key: 'topic', tag: null } }, NOW).mainTags).toBeUndefined();
  });
  it('returns the very same record when nothing changes', () => {
    const plain = doc(2, { tags: ['a'], mainTags: { topic: 'a' } });
    expect(retagRecord(plain, { docId: plain.id, add: ['a'] }, NOW)).toBe(plain);
    expect(retagRecord(plain, { docId: plain.id, remove: ['zzz'] }, NOW)).toBe(plain);
    // Adding again a tag that came from the AI confirms it: the provenance mark goes (D-494), so that is a change.
    expect(retagRecord(rec, { docId: rec.id, add: ['a'] }, NOW)).not.toBe(rec);
  });
});

describe('retagEach', () => {
  it('a family of one value: the value is replaced; of several: the target is fixed and the others stay, or the old value goes with its tags', async () => {
    await seed([doc(1, { tags: ['x', 'a'] }), doc(2, { tags: ['a', 'kid'] }), doc(3, { tags: [] })]);
    const one = await org.retagEach([{ docId: hex(1), add: ['y'], remove: ['x'] }], 'one');
    expect(one.changed).toBe(1);
    expect((await read(1)).tags).toEqual(['a', 'y']);
    // `many` without removing: `b` becomes the fixed main value, `a` and `kid` stay.
    await org.retagEach([{ docId: hex(2), add: ['b'], main: { key: 'topic', tag: 'b' } }], 'many');
    expect(await read(2)).toMatchObject({ tags: ['a', 'kid', 'b'], mainTags: { topic: 'b' } });
    // `many` removing the old value: its tags under `a` go.
    await org.retagEach([{ docId: hex(2), add: ['b'], remove: ['a', 'kid'], main: { key: 'topic', tag: 'b' } }], 'many, old out');
    expect((await read(2)).tags).toEqual(['b']);
    // No value: every tag of the family and the fixed value go.
    await org.retagEach([{ docId: hex(2), remove: ['b'], main: { key: 'topic', tag: null } }], 'no value');
    expect(await read(2)).toMatchObject({ tags: [] });
    expect((await read(2)).mainTags).toBeUndefined();
    expect((await read(3)).tags).toEqual([]);
  });

  it('is ONE change however many papers, and an undo (and a redo) restores tags, provenance and fixed values', async () => {
    const docs = Array.from({ length: 70 }, (_, i) => doc(i + 1, { tags: i % 2 ? ['a', 'kid'] : ['b'], ...(i % 2 ? { tagOrigin: { a: 'ai', kid: 'import' } } : {}), ...(i % 3 === 0 ? { mainTags: { topic: i % 2 ? 'a' : 'b' } } : {}) }));
    await seed(docs);
    const before = await Promise.all(docs.map((_, i) => read(i + 1).then(content)));
    const r = await org.retagEach(docs.map((d) => ({ docId: d.id, add: ['x'], remove: ['a', 'kid', 'b'], main: { key: 'topic', tag: null } })), 'Moved 70 paper(s)');
    expect(r.changed).toBe(70);
    expect(r.reindex).toHaveLength(70);
    expect((await read(2)).tags).toEqual(['x']);
    expect((await read(2)).tagOrigin).toBeUndefined();
    const items = (await org.listHistory()).filter((h) => h.changeId === r.changeId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ summary: 'Moved 70 paper(s)', undoable: true, counts: { documents: 70 } });
    // Every log line of the gesture carries the same change id.
    const lines = (await store.readLog({ type: 'change' })).filter((e) => e.type === 'change' && e.target.kind === 'document' && e.changeId === r.changeId);
    expect(lines).toHaveLength(70);

    await org.undo();
    expect(await Promise.all(docs.map((_, i) => read(i + 1).then(content)))).toEqual(before);
    await org.redo();
    expect((await read(2)).tags).toEqual(['x']);
    expect((await read(4)).mainTags).toBeUndefined();
    await org.undo();
    expect(await Promise.all(docs.map((_, i) => read(i + 1).then(content)))).toEqual(before);
  }, 60_000);

  it('nothing to write: no change, and the papers that would not change are not touched', async () => {
    await seed([doc(1, { tags: ['a'] })]);
    const rev = (await read(1)).revision;
    expect(await org.retagEach([{ docId: hex(1), add: ['a'] }], 'same')).toMatchObject({ changeId: null, changed: 0, already: 1 });
    expect((await read(1)).revision).toBe(rev);
    expect(await org.listHistory()).toHaveLength(0);
  });

  it('validates before writing: unknown or deprecated tag, unknown paper', async () => {
    await seed([doc(1, { tags: ['a'] })]);
    await org.applyTaxonomy(ops({ op: 'deprecate', id: 'y' }));
    expect(((await failure(org.retagEach([{ docId: hex(1), add: ['nope'] }], 's'))) as AppError).code).toBe('NOT_FOUND');
    expect(((await failure(org.retagEach([{ docId: hex(1), add: ['y'] }], 's'))) as AppError).code).toBe('INVALID_REQUEST');
    expect(((await failure(org.retagEach([{ docId: hex(1), add: ['b'] }, { docId: hex(9), add: ['b'] }], 's'))) as AppError).code).toBe('NOT_FOUND');
    expect((await read(1)).tags).toEqual(['a']);
  });

  it('a write that fails half way leaves no paper changed and no change in the history', async () => {
    const docs = Array.from({ length: 40 }, (_, i) => doc(i + 1, { tags: ['a'], tagOrigin: { a: 'ai' } }));
    await seed(docs);
    const before = await Promise.all(docs.map((_, i) => read(i + 1).then(content)));
    let calls = 0;
    // The 25th write fails; the writes before it went through.
    const flaky = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop !== 'documents') return Reflect.get(target, prop, receiver);
        return { ...target.documents, update: (id: string, fn: never) => (++calls === 25 ? Promise.reject(new AppError('IO_ERROR', 'disk full')) : target.documents.update(id, fn)) };
      },
    });
    const broken = createOrganizer({ store: flaky as FileLibraryStore, deviceId: 'dev-1', cacheTtlMs: 0 });
    const err = (await failure(broken.retagEach(docs.map((d) => ({ docId: d.id, add: ['b'], remove: ['a'] })), 'x'))) as AppError;
    expect(err.code).toBe('IO_ERROR');
    expect(await Promise.all(docs.map((_, i) => read(i + 1).then(content)))).toEqual(before);
    expect(await org.listHistory()).toHaveLength(0);
  });

  // D-534: 5000 papers (the heavy run, one at a time).
  it.skipIf(!process.env['RL_HEAVY_TESTS'])('5000 papers: one change, and an undo that brings back every record', async () => {
    const docs = Array.from({ length: 5000 }, (_, i) => doc(i + 1, { tags: ['a'], tagOrigin: { a: 'ai' } }));
    await seed(docs);
    const before = new Map<number, string>();
    for (const i of [1, 2500, 5000]) before.set(i, content(await read(i)));
    const r = await org.retagEach(docs.map((d) => ({ docId: d.id, add: ['b'], remove: ['a'], main: { key: 'topic', tag: 'b' } })), 'Moved 5000 paper(s)');
    expect(r.changed).toBe(5000);
    expect((await org.listHistory()).filter((h) => h.changeId === r.changeId)).toHaveLength(1);
    await org.undo();
    for (const [i, c] of before) expect(content(await read(i))).toBe(c);
  }, 600_000);
});

describe('fixed main values follow the taxonomy', () => {
  it('a merge rewrites them from -> into in the same change, an undo puts them back', async () => {
    await seed([doc(1, { tags: ['a', 'b'], mainTags: { topic: 'a' } }), doc(2, { tags: ['b'], mainTags: { topic: 'b' } }), doc(3, { tags: ['kid'] })]);
    const before = await Promise.all([1, 2, 3].map((i) => read(i).then(content)));
    const r = await org.applyTaxonomy(ops({ op: 'merge', from: 'a', into: 'b' }));
    expect((await read(1)).mainTags).toEqual({ topic: 'b' });
    expect((await read(2)).mainTags).toEqual({ topic: 'b' });
    expect((await org.listHistory())[0]?.changeId).toBe(r.changeId);
    await org.undo();
    expect(await Promise.all([1, 2, 3].map((i) => read(i).then(content)))).toEqual(before);
  });

  it('a fixed value whose tag is taken off is dropped with the next write (and an undo brings it back)', async () => {
    await seed([doc(1, { tags: ['a', 'b'], mainTags: { topic: 'a' } })]);
    const before = content(await read(1));
    const r = await org.tagDocuments([hex(1)], [], ['a']);
    expect(r.changed).toBe(1);
    expect((await read(1)).mainTags).toBeUndefined();
    await org.undo();
    expect(content(await read(1))).toBe(before);
  });
});
