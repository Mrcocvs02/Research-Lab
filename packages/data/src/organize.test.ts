import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, documentPatchSchema, documentRecordSchema, taxonomyFileSchema, taxonomyOpSchema, type DocumentRecord, type TaxonomyOp } from '@rl/core';
import { createLibraryStore, type FileLibraryStore } from './store.js';
import { createOrganizer, type Organizer } from './organize/organizer.js';
import { hex, removeDir, tempDir } from './test-utils.js';

const NOW = '2026-01-02T03:04:05.000Z';

function doc(n: number, over: Record<string, unknown> = {}): DocumentRecord {
  return documentRecordSchema.parse({ id: hex(n), hash: 'a'.repeat(64), path: `docs/file-${n}.pdf`, size: 10, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, ...over });
}
const node = (id: string, over: Record<string, unknown> = {}) => ({ id, label: id.toUpperCase(), parents: [], aliases: [], implies: [], status: 'active', origin: 'user', ...over });
const ops = (...o: unknown[]): TaxonomyOp[] => o.map((x) => taxonomyOpSchema.parse(x));

let root: string;
let store: FileLibraryStore;
let org: Organizer;

async function seed(nodes: unknown[], docs: DocumentRecord[] = [], extra: Record<string, unknown> = {}) {
  await store.init();
  await store.writeTaxonomy(taxonomyFileSchema.parse({ nodes, ...extra }));
  for (const d of docs) await store.documents.put(d);
}
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof AppError ? e : new AppError('INTERNAL', `not an AppError: ${String(e)}`);
  }
  return null;
};
const tagsOf = async (n: number) => (await store.documents.get(hex(n)))?.tags;

beforeEach(async () => {
  root = await tempDir();
  store = createLibraryStore({ rootPath: root, deviceId: 'dev-1' });
  org = createOrganizer({ store, deviceId: 'dev-1', cacheTtlMs: 0 });
});
afterEach(() => removeDir(root));

describe('taxonomy operations', () => {
  it('creates nodes with derived ids, safe against reserved names, and keeps levels free', async () => {
    await seed([]);
    const r = await org.applyTaxonomy(ops({ op: 'create', label: 'CON' }, { op: 'create', label: 'Machine Learning', color: '#aabbcc' }, { op: 'create', id: 'x', label: 'Child', parents: ['x2'] }).slice(0, 2));
    expect(r.created.map((c) => c.id)).toEqual(['n-con', 'machine-learning']);
    const t = await org.taxonomy();
    expect(t.nodes.map((n) => n.id)).toEqual(['n-con', 'machine-learning']);
    expect(t.nodes[1]?.color).toBe('#aabbcc');
    expect(t.revision).toBeGreaterThan(0);
  });

  it('ids: upper case is normalised by the schema, reserved names are refused, duplicates are refused', async () => {
    await seed([node('a')]);
    expect(taxonomyOpSchema.parse({ op: 'rename', id: 'ABC', label: 'x' })).toMatchObject({ id: 'abc' });
    expect(taxonomyOpSchema.safeParse({ op: 'create', id: 'nul', label: 'x' }).success).toBe(false);
    expect(taxonomyOpSchema.safeParse({ op: 'create', id: 'COM1', label: 'x' }).success).toBe(false);
    expect(taxonomyOpSchema.safeParse({ op: 'create', id: '../x', label: 'x' }).success).toBe(false);
    expect(taxonomyOpSchema.safeParse({ op: 'create', id: 'a.', label: 'x' }).success).toBe(false);
    expect((await code(org.applyTaxonomy(ops({ op: 'create', id: 'A', label: 'again' }))))?.code).toBe('ALREADY_EXISTS');
  });

  it('refuses cycles in parents and in implications, and a node as its own parent', async () => {
    await seed([node('a'), node('b', { parents: ['a'] }), node('c', { parents: ['b'] })]);
    expect((await code(org.applyTaxonomy(ops({ op: 'move', id: 'a', parents: ['c'] }))))?.code).toBe('INVALID_REQUEST');
    expect((await code(org.applyTaxonomy(ops({ op: 'move', id: 'a', parents: ['a'] }))))?.code).toBe('INVALID_REQUEST');
    await org.applyTaxonomy(ops({ op: 'setImplies', id: 'a', implies: ['b'] }));
    expect((await code(org.applyTaxonomy(ops({ op: 'setImplies', id: 'b', implies: ['c'] }, { op: 'setImplies', id: 'c', implies: ['a'] }))))?.code).toBe('INVALID_REQUEST');
    // nothing of the failed batch was applied
    expect((await org.taxonomy()).nodes.find((n) => n.id === 'b')?.implies).toEqual([]);
  });

  it('allows several parents and re-parenting', async () => {
    await seed([node('a'), node('b'), node('c')]);
    await org.applyTaxonomy(ops({ op: 'move', id: 'c', parents: ['a', 'b', 'a'] }));
    expect((await org.taxonomy()).nodes.find((n) => n.id === 'c')?.parents).toEqual(['a', 'b']);
  });

  it('refuses a missing node, a merge into itself and a merge into a deprecated node', async () => {
    await seed([node('a'), node('b', { status: 'deprecated' })]);
    expect((await code(org.applyTaxonomy(ops({ op: 'rename', id: 'ghost', label: 'x' }))))?.code).toBe('NOT_FOUND');
    expect((await code(org.applyTaxonomy(ops({ op: 'merge', from: 'a', into: 'a' }))))?.code).toBe('INVALID_REQUEST');
    expect((await code(org.applyTaxonomy(ops({ op: 'merge', from: 'a', into: 'ghost' }))))?.code).toBe('NOT_FOUND');
    expect((await code(org.applyTaxonomy(ops({ op: 'merge', from: 'a', into: 'b' }))))?.code).toBe('INVALID_REQUEST');
    expect((await code(org.applyTaxonomy(ops({ op: 'move', id: 'a', parents: ['ghost'] }))))?.code).toBe('NOT_FOUND');
  });

  it('a batch is all or nothing and honours expectedRevision', async () => {
    await seed([node('a')]);
    const rev = (await org.taxonomy()).revision;
    expect((await code(org.applyTaxonomy(ops({ op: 'rename', id: 'a', label: 'New' }, { op: 'rename', id: 'ghost', label: 'x' }))))?.code).toBe('NOT_FOUND');
    expect(await org.taxonomy()).toMatchObject({ revision: rev, nodes: [{ label: 'A' }] });
    const e = await code(org.applyTaxonomy(ops({ op: 'rename', id: 'a', label: 'New' }), rev + 5));
    expect(e).toMatchObject({ code: 'CONFLICT', details: { conflict: 'revision' } });
    await org.applyTaxonomy(ops({ op: 'rename', id: 'a', label: 'New' }), rev);
  });

  it('merge: documents move to the target, the source becomes an alias, references are redirected', async () => {
    await seed(
      [node('old', { label: 'Old name', aliases: ['ancient'] }), node('new', { label: 'New name' }), node('kid', { parents: ['old'] }), node('imp', { implies: ['old'] })],
      [doc(1, { tags: ['old'] }), doc(2, { tags: ['old', 'new'] }), doc(3, { tags: ['kid'] })],
    );
    const r = await org.applyTaxonomy(ops({ op: 'merge', from: 'old', into: 'new' }));
    expect(r.documentsChanged).toBe(2);
    // Document 3 keeps its tag but its ancestors changed (kid's parent is now `new`): its index entry is refreshed too.
    expect(r.reindex.sort()).toEqual([hex(1), hex(2), hex(3)].sort());
    expect(await tagsOf(1)).toEqual(['new']);
    expect(await tagsOf(2)).toEqual(['new']);
    const t = await org.taxonomy();
    expect(t.nodes.find((n) => n.id === 'old')).toBeUndefined();
    const merged = t.nodes.find((n) => n.id === 'new');
    expect(merged?.aliases).toEqual(expect.arrayContaining(['Old name', 'ancient']));
    expect(merged?.mergedFrom).toEqual(['old']);
    expect(t.nodes.find((n) => n.id === 'kid')?.parents).toEqual(['new']);
    expect(t.nodes.find((n) => n.id === 'imp')?.implies).toEqual(['new']);
    expect(merged?.counts.direct).toBe(2);
  });

  it('a move refreshes the documents under the moved node (the index keeps their ancestors), and only them', async () => {
    await seed(
      [node('root1'), node('root2'), node('mid', { parents: ['root1'] }), node('leaf', { parents: ['mid'] }), node('imp', { implies: ['leaf'] }), node('other', { parents: ['root1'] })],
      [doc(1, { tags: ['leaf'] }), doc(2, { tags: ['imp'] }), doc(3, { tags: ['other'] }), doc(4, { tags: ['root2'] }), doc(5)],
    );
    const r = await org.applyTaxonomy(ops({ op: 'move', id: 'mid', parents: ['root2'] }));
    expect(r.reindex.sort()).toEqual([hex(1), hex(2)].sort());
    expect(r.documentsChanged).toBe(0);
  });

  it('invalidate() drops the reused document list for writers that bypass the organizer', async () => {
    const reuse = createOrganizer({ store, deviceId: 'dev-1', cacheTtlMs: 60_000 });
    await seed([]);
    expect((await reuse.folderTree()).total).toBe(0);
    await store.documents.put(doc(1));
    expect((await reuse.folderTree()).total).toBe(0); // still the old answer inside the window
    reuse.invalidate();
    expect((await reuse.folderTree()).total).toBe(1);
  });

  it('merge chains in one batch end on the last target', async () => {
    await seed([node('a'), node('b'), node('c')], [doc(1, { tags: ['a'] })]);
    await org.applyTaxonomy(ops({ op: 'merge', from: 'a', into: 'b' }, { op: 'merge', from: 'b', into: 'c' }));
    expect(await tagsOf(1)).toEqual(['c']);
    expect((await org.taxonomy()).nodes.find((n) => n.id === 'c')?.mergedFrom).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('delete only when unused (documents or other nodes)', async () => {
    await seed([node('used'), node('parent'), node('kid', { parents: ['parent'] }), node('free')], [doc(1, { tags: ['used'] })]);
    expect(await code(org.applyTaxonomy(ops({ op: 'delete', id: 'used' })))).toMatchObject({ code: 'CONFLICT', details: { conflict: 'in-use', documents: 1 } });
    expect(await code(org.applyTaxonomy(ops({ op: 'delete', id: 'parent' })))).toMatchObject({ code: 'CONFLICT', details: { conflict: 'in-use' } });
    await org.applyTaxonomy(ops({ op: 'delete', id: 'free' }));
    expect((await org.taxonomy()).nodes.map((n) => n.id)).not.toContain('free');
  });

  it('deprecate and restore; types and venues can be added', async () => {
    await seed([node('a')]);
    await org.applyTaxonomy(ops({ op: 'deprecate', id: 'a' }, { op: 'addType', label: 'Paper' }, { op: 'addVenue', name: 'Some Journal' }));
    let t = await org.taxonomy();
    expect(t.nodes[0]?.status).toBe('deprecated');
    expect(t.documentTypes.map((x) => x.id)).toEqual(['paper']);
    expect(t.venues.map((x) => x.id)).toEqual(['some-journal']);
    await org.applyTaxonomy(ops({ op: 'restore', id: 'a' }));
    t = await org.taxonomy();
    expect(t.nodes[0]?.status).toBe('active');
  });

  it('counts: direct, with implications, and with descendants', async () => {
    await seed([node('ml'), node('nn', { parents: ['ml'], implies: ['ml'] }), node('opt', { parents: ['ml'] })], [doc(1, { tags: ['nn'] }), doc(2, { tags: ['opt'] }), doc(3, { tags: ['ml'] }), doc(4, { tags: ['nn'], missing: true })]);
    const t = await org.taxonomy();
    const c = (id: string) => t.nodes.find((n) => n.id === id)?.counts;
    expect(c('ml')).toEqual({ direct: 1, implied: 2, subtree: 3 });
    expect(c('nn')).toEqual({ direct: 1, implied: 1, subtree: 1 });
    expect(JSON.stringify(t)).not.toContain('legacy');
  });

  it('a hostile batch of the maximum size stays fast and valid', async () => {
    await seed([]);
    const many = Array.from({ length: 200 }, (_, i) => ({ op: 'create', label: `Node ${i}`, parents: i > 0 ? [`node-${i - 1}`] : [] }));
    await org.applyTaxonomy(ops(...many.map((m, i) => ({ ...m, parents: i > 0 ? ['node-' + (i - 1)] : [] }))));
    expect((await org.taxonomy()).nodes).toHaveLength(200);
    expect((await code(org.applyTaxonomy(ops({ op: 'move', id: 'node-0', parents: ['node-199'] }))))?.code).toBe('INVALID_REQUEST');
  });
});

describe('tags in bulk', () => {
  it('tags 500 documents with ONE change id and undoes them together', async () => {
    await seed([node('a'), node('b')], Array.from({ length: 500 }, (_, i) => doc(i + 1, { tags: i % 2 ? ['b'] : [] })));
    const r = await org.tagDocuments(Array.from({ length: 500 }, (_, i) => hex(i + 1)), ['a'], ['b']);
    expect(r.changed).toBe(500);
    expect(r.reindex).toHaveLength(500);
    expect(await tagsOf(1)).toEqual(['a']);
    expect(await tagsOf(2)).toEqual(['a']);
    const log = (await store.readLog({ type: 'change' })).filter((e) => e.type === 'change' && e.changeId === r.changeId);
    expect(log).toHaveLength(500);
    const hist = await org.listHistory();
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ changeId: r.changeId, kind: 'change', undoable: true, undone: false, mine: true, counts: { documents: 500 } });
    const u = await org.undo();
    expect(u.documentsChanged).toBe(500);
    expect(await tagsOf(1)).toEqual([]);
    expect(await tagsOf(2)).toEqual(['b']);
  }, 60_000);

  it('skips what is already done, validates before writing anything', async () => {
    await seed([node('a'), node('dep', { status: 'deprecated' })], [doc(1, { tags: ['a'] }), doc(2)]);
    const r = await org.tagDocuments([hex(1), hex(2)], ['a']);
    expect(r).toMatchObject({ changed: 1, unchanged: 1 });
    expect(await org.tagDocuments([hex(1), hex(2)], ['a'])).toMatchObject({ changeId: null, changed: 0, unchanged: 2 });
    expect((await code(org.tagDocuments([hex(1), hex(99)], [], ['a'])))?.code).toBe('NOT_FOUND');
    expect(await tagsOf(1)).toEqual(['a']);
    expect((await code(org.tagDocuments([hex(1)], ['ghost'])))?.code).toBe('NOT_FOUND');
    expect((await code(org.tagDocuments([hex(1)], ['dep'])))?.code).toBe('INVALID_REQUEST');
    expect((await code(org.tagDocuments([hex(1)], ['a'], ['a'])))?.code).toBe('INVALID_REQUEST');
    // removing an unknown tag id is allowed (clean-up of a stale reference)
    await org.tagDocuments([hex(1)], [], ['ghost']);
  });
});

describe('document fields', () => {
  it('the patch schema only accepts user fields', () => {
    for (const bad of [{ ai: {} }, { tags: [] }, { path: 'x' }, { summary: 'x' }, { 'ai.summary': 'x' }, {}, { study: {} }]) {
      expect(documentPatchSchema.safeParse(bad).success).toBe(false);
    }
    expect(documentPatchSchema.safeParse({ title: 'x', studyState: 'read', underlined: true, userDescription: 'd' }).success).toBe(true);
  });

  it('updates fields, logs, undoes and redoes them', async () => {
    await seed([], [doc(1, { title: 'Old', authors: ['A'] })], { documentTypes: [{ id: 'paper', label: 'Paper' }], venues: [{ id: 'jj', name: 'J' }] });
    const r = await org.updateDocument(hex(1), { title: ' New ', authors: ['B', 'C'], year: 2020, type: 'paper', venue: 'Free text', venueId: 'jj', venueRef: '12(3)', doi: 'https://doi.org/10.1/x', arxivId: '2401.00001', userDescription: 'desc', studyState: 'reading', underlined: true });
    expect(r.reindex).toEqual([hex(1)]);
    expect(r.record).toMatchObject({ title: 'New', authors: ['B', 'C'], year: 2020, type: 'paper', doi: '10.1/x', userDescription: 'desc', ref: { venue: 'Free text', venueId: 'jj', venueRef: '12(3)' }, study: { state: 'reading', underlined: { value: true, origin: 'manual' } } });
    expect(r.record.revision).toBe(1);
    await org.undo();
    expect(await store.documents.get(hex(1))).toMatchObject({ title: 'Old', authors: ['A'], year: null, type: null, doi: null, userDescription: '', ref: {}, study: { state: 'to-read' } });
    await org.redo();
    expect(await store.documents.get(hex(1))).toMatchObject({ title: 'New', year: 2020, study: { state: 'reading' } });
  });

  it('refuses unknown type or venue, stale revisions and unknown documents; no-op writes nothing', async () => {
    await seed([], [doc(1, { title: 'T' })]);
    expect((await code(org.updateDocument(hex(1), { type: 'nope' })))?.code).toBe('NOT_FOUND');
    expect((await code(org.updateDocument(hex(1), { venueId: 'nope' })))?.code).toBe('NOT_FOUND');
    expect((await code(org.updateDocument(hex(9), { title: 'x' })))?.code).toBe('NOT_FOUND');
    expect(await code(org.updateDocument(hex(1), { title: 'x' }, 7))).toMatchObject({ code: 'CONFLICT', details: { conflict: 'revision' } });
    const r = await org.updateDocument(hex(1), { title: 'T' });
    expect(r.reindex).toEqual([]);
    expect((await store.documents.get(hex(1)))?.revision).toBe(0);
    expect(await org.listHistory()).toEqual([]);
  });

  it('a value set by the user beats the extracted one and never follows the file again', async () => {
    await seed([], [doc(1, { title: 'Guess', year: 1999, extracted: { title: 'Guess', year: 1999 } })]);
    await org.updateDocument(hex(1), { title: 'Mine', year: 1999 });
    const rec = await store.documents.get(hex(1));
    expect(rec?.title).toBe('Mine');
    // title differs from the guess: still pinned by the difference; year equals the guess: dropped from `extracted`
    expect(rec?.extracted).toEqual({ title: 'Guess' });
    // clearing keeps the key: not refilled
    await org.updateDocument(hex(1), { title: null });
    expect((await store.documents.get(hex(1)))?.extracted).toEqual({ title: 'Guess' });
  });
});

describe('history: undo and redo', () => {
  it('undo and redo in sequence, newest first, redo is cleared by a new change', async () => {
    await seed([node('a'), node('b')], [doc(1)]);
    const c1 = await org.tagDocuments([hex(1)], ['a']);
    const c2 = await org.tagDocuments([hex(1)], ['b']);
    expect((await org.undo()).target).toBe(c2.changeId);
    expect(await tagsOf(1)).toEqual(['a']);
    expect((await org.undo()).target).toBe(c1.changeId);
    expect(await tagsOf(1)).toEqual([]);
    const items = await org.listHistory();
    expect(items.map((i) => i.kind)).toEqual(['undo', 'undo', 'change', 'change']);
    expect(items.map((i) => i.undone)).toEqual([false, false, true, true]);
    expect(await code(org.undo(c1.changeId as string))).toMatchObject({ code: 'CONFLICT', details: { conflict: 'already-undone' } });
    expect((await org.redo()).target).toBe(c1.changeId);
    expect(await tagsOf(1)).toEqual(['a']);
    expect((await org.redo()).target).toBe(c2.changeId);
    expect(await tagsOf(1)).toEqual(['a', 'b']);
    expect((await code(org.redo()))?.code).toBe('NOT_FOUND');
    // undo, then a new change: nothing to redo any more
    await org.undo();
    await org.updateDocument(hex(1), { title: 'x' });
    expect((await code(org.redo()))?.code).toBe('NOT_FOUND');
    // but an explicit redo of the undone change is still possible
    expect((await org.redo(c2.changeId as string)).target).toBe(c2.changeId);
    expect(await tagsOf(1)).toEqual(['a', 'b']);
  });

  it('CONFLICT when the same item changed again, and nothing is applied', async () => {
    await seed([node('a'), node('b')], [doc(1), doc(2)]);
    const c1 = await org.tagDocuments([hex(1), hex(2)], ['a']);
    await org.tagDocuments([hex(2)], ['b']);
    const e = await code(org.undo(c1.changeId as string));
    expect(e).toMatchObject({ code: 'CONFLICT', details: { conflict: 'changed' } });
    expect(await tagsOf(1)).toEqual(['a']);
    expect(await tagsOf(2)).toEqual(['a', 'b']);
    // the change itself is still listed as undoable
    expect((await org.listHistory()).find((i) => i.changeId === c1.changeId)?.undoable).toBe(true);
  });

  it('conflict on document fields and on the taxonomy', async () => {
    await seed([node('a')], [doc(1, { title: 'T' })]);
    const u1 = await org.updateDocument(hex(1), { title: 'One' });
    await org.updateDocument(hex(1), { title: 'Two' });
    expect((await code(org.undo(u1.changeId)))?.code).toBe('CONFLICT');
    const t1 = await org.applyTaxonomy(ops({ op: 'rename', id: 'a', label: 'First' }));
    await org.applyTaxonomy(ops({ op: 'rename', id: 'a', label: 'Second' }));
    expect((await code(org.undo(t1.changeId)))?.code).toBe('CONFLICT');
    expect((await org.taxonomy()).nodes[0]?.label).toBe('Second');
  });

  it('undoes a taxonomy merge with the retagged documents, and redoes it', async () => {
    await seed([node('a'), node('b')], [doc(1, { tags: ['a'] }), doc(2, { tags: ['b'] })]);
    const r = await org.applyTaxonomy(ops({ op: 'merge', from: 'a', into: 'b' }));
    expect(await tagsOf(1)).toEqual(['b']);
    const u = await org.undo(r.changeId);
    expect(u.reindex).toEqual(expect.arrayContaining([hex(1), hex(2)]));
    const t = await org.taxonomy();
    expect(t.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(t.nodes.find((n) => n.id === 'b')?.aliases).toEqual([]);
    expect(await tagsOf(1)).toEqual(['a']);
    await org.redo();
    expect(await tagsOf(1)).toEqual(['b']);
    expect((await org.taxonomy()).nodes.map((n) => n.id)).toEqual(['b']);
  });

  it('nothing to undo / unknown change', async () => {
    await seed([]);
    expect((await code(org.undo()))?.code).toBe('NOT_FOUND');
    expect((await code(org.undo('chg-nope')))?.code).toBe('NOT_FOUND');
    expect((await code(org.redo('chg-nope')))?.code).toBe('NOT_FOUND');
  });

  it('only this device is undone by default', async () => {
    await seed([node('a')], [doc(1)]);
    const other = createOrganizer({ store: createLibraryStore({ rootPath: root, deviceId: 'dev-2' }), deviceId: 'dev-2', cacheTtlMs: 0 });
    await other.tagDocuments([hex(1)], ['a']);
    expect((await code(org.undo()))?.code).toBe('NOT_FOUND');
    expect((await org.listHistory())[0]?.mine).toBe(false);
  });
});

describe('projects and collections', () => {
  it('members come from different folders; missing and vanished members are flagged, not dropped', async () => {
    await seed([], [doc(1, { path: 'a/x.pdf', title: 'X' }), doc(2, { path: 'b/c/y.pdf', study: { state: 'read' } }), doc(3, { path: 'z.pdf', missing: true, study: { state: 'reading' } })]);
    const c = await org.createProject({ name: 'My Thesis', kind: 'project', docIds: [hex(1), hex(2), hex(3)] });
    expect(c.detail.project).toMatchObject({ id: 'my-thesis', kind: 'project', status: 'active', revision: 0 });
    expect(c.detail.project.counts).toEqual({ total: 3, toRead: 1, reading: 0, read: 1, missing: 1 });
    expect(c.detail.members.map((m) => m.path)).toEqual(['a/x.pdf', 'b/c/y.pdf', 'z.pdf']);
    await store.documents.remove(hex(1));
    org = createOrganizer({ store, deviceId: 'dev-1', cacheTtlMs: 0 });
    const g = await org.getProject('my-thesis');
    expect(g.members[0]).toMatchObject({ docId: hex(1), known: false, missing: true, path: null, studyState: null });
    expect(g.project.counts.missing).toBe(2);
    expect((await org.listProjects({}))[0]?.counts.read).toBe(1);
  });

  it('create, update with revision, add and remove members, reading plan', async () => {
    await seed([], [doc(1), doc(2), doc(3)]);
    const c = await org.createProject({ name: 'Reading', kind: 'collection', notes: '# md' });
    expect(c.detail.project.kind).toBe('collection');
    expect((await code(org.createProject({ id: 'reading', name: 'dup' })))?.code).toBe('ALREADY_EXISTS');
    expect((await org.createProject({ name: 'Reading' })).detail.project.id).toBe('reading-2');
    expect((await code(org.addProjectMembers('reading', [hex(1), hex(8)])))?.code).toBe('NOT_FOUND');
    await org.addProjectMembers('reading', [hex(1), hex(2), hex(1)], 'why');
    expect((await org.addProjectMembers('reading', [hex(1)])).changeId).toBeNull();
    const u = await org.updateProject('reading', { name: 'Renamed', status: 'paused', notes: 'new **notes**' }, 1);
    expect(u.detail.project).toMatchObject({ name: 'Renamed', status: 'paused', revision: 2, notes: 'new **notes**' });
    expect(await code(org.updateProject('reading', { name: 'x' }, 1))).toMatchObject({ code: 'CONFLICT', details: { conflict: 'revision' } });
    expect((await code(org.setReadingPlan('reading', [{ docId: hex(3), order: 0 }])))?.code).toBe('INVALID_REQUEST');
    expect((await code(org.setReadingPlan('reading', [{ docId: hex(1), order: 0 }, { docId: hex(1), order: 1 }])))?.code).toBe('INVALID_REQUEST');
    const p = await org.setReadingPlan('reading', [{ docId: hex(2), order: 5, status: 'reading', note: 'n' }, { docId: hex(1), order: 1, due: '2026-12-01T00:00:00.000Z' }]);
    expect(p.detail.readingPlan.map((i) => i.docId)).toEqual([hex(1), hex(2)]);
    const r = await org.removeProjectMembers('reading', [hex(1)]);
    expect(r.detail.members.map((m) => m.docId)).toEqual([hex(2)]);
    expect(r.detail.readingPlan.map((i) => i.docId)).toEqual([hex(2)]);
    expect((await code(org.getProject('ghost')))?.code).toBe('NOT_FOUND');
  });

  it('delete archives and restore brings it back; undo works on projects', async () => {
    await seed([], [doc(1)]);
    await org.createProject({ name: 'P', status: 'paused', docIds: [hex(1)] });
    expect((await org.listProjects({})).map((p) => p.id)).toEqual(['p']);
    const a = await org.archiveProject('p');
    expect(a.detail.project).toMatchObject({ status: 'archived', archivedFrom: 'paused' });
    expect(await org.listProjects({})).toEqual([]);
    expect(await org.listProjects({ includeArchived: true })).toHaveLength(1);
    expect(await org.listProjects({ status: 'archived' })).toHaveLength(1);
    expect((await org.archiveProject('p')).changeId).toBeNull();
    const r = await org.restoreProject('p');
    expect(r.detail.project.status).toBe('paused');
    expect(r.detail.project.archivedFrom).toBeUndefined();
    expect(await store.projects.get('p')).toBeTruthy();

    await org.undo(); // undo restore -> archived again
    expect((await org.getProject('p')).project.status).toBe('archived');
    await org.undo(); // undo archive -> paused
    expect((await org.getProject('p')).project.status).toBe('paused');
    await org.undo(); // undo create -> gone
    expect(await store.projects.get('p')).toBeNull();
    await org.redo();
    expect((await org.getProject('p')).members).toHaveLength(1);
  });

  it('undo of a project creation conflicts when it was edited afterwards', async () => {
    await seed([], [doc(1)]);
    const c = await org.createProject({ name: 'P' });
    await org.addProjectMembers('p', [hex(1)]);
    expect((await code(org.undo(c.changeId as string)))?.code).toBe('CONFLICT');
    expect((await org.getProject('p')).members).toHaveLength(1);
  });

  it('refuses oversized names and keeps ids safe', async () => {
    await seed([]);
    const r = await org.createProject({ name: 'CON' });
    expect(r.detail.project.id).toBe('p-con');
  });
});

describe('folder tree', () => {
  it('counts direct and total documents per folder, present ones only', async () => {
    await seed([], [doc(1, { path: 'root.pdf' }), doc(2, { path: 'a/x.pdf' }), doc(3, { path: 'a/b/y.pdf' }), doc(4, { path: 'a/b/z.pdf' }), doc(5, { path: 'c/gone.pdf', missing: true }), doc(6, { path: 'B/q.pdf' })]);
    const t = await org.folderTree();
    expect(t).toMatchObject({ rootDirect: 1, total: 5 });
    expect(t.folders).toEqual([
      { path: 'a', name: 'a', parent: null, depth: 1, direct: 1, total: 3 },
      { path: 'a/b', name: 'b', parent: 'a', depth: 2, direct: 2, total: 2 },
      { path: 'B', name: 'B', parent: null, depth: 1, direct: 1, total: 1 },
    ]);
    expect(JSON.stringify(t)).not.toMatch(/[A-Za-z]:[\\/]/);
  });
});

describe('projects: too many members (D-178)', () => {
  it('a project over the member limit is refused with the numbers the interface needs', async () => {
    await seed([]);
    const ids = Array.from({ length: 20_001 }, (_, i) => hex(i + 1));
    const e = await code(org.createProject({ name: 'Big', docIds: ids }));
    expect(e?.code).toBe('INVALID_REQUEST');
    expect(e?.details).toMatchObject({ reason: 'members-limit', limit: 20_000, count: 20_001 });
  });
});
