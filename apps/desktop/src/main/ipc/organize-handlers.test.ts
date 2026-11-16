import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, channels, createDispatcher, createMemoryLogger, documentRecordSchema, taxonomyFileSchema, type DocumentId, type IpcEnvelope } from '@rl/core';
import { createLibraryStore, createOrganizer, type FileLibraryStore } from '@rl/data';
import { createSearchIndex } from '@rl/search';
import { buildIndexable, makeTaxonomyLookup } from '../library/indexable.js';
import { buildHandlers, type MainServices } from './handlers/index.js';

const NOW = '2026-01-02T03:04:05.000Z';
const hex = (n: number) => n.toString(16).padStart(16, '0');
const doc = (n: number, over: Record<string, unknown> = {}) =>
  documentRecordSchema.parse({ id: hex(n), hash: 'a'.repeat(64), path: `papers/f${n}.pdf`, size: 10, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, ...over });
const node = (id: string, over: Record<string, unknown> = {}) => ({ id, label: id.toUpperCase(), parents: [], aliases: [], implies: [], status: 'active', origin: 'user', ...over });

let root: string;
let store: FileLibraryStore;
let events: Array<[string, unknown]>;
let reindexed: string[][];
let opened: string[];
let revealed: string[];
let openError = '';
let index: ReturnType<typeof createSearchIndex>;

async function harness() {
  const log = createMemoryLogger();
  const organizer = createOrganizer({ store, deviceId: 'dev-1', cacheTtlMs: 0 });
  index = createSearchIndex();
  await index.open(path.join(root, 'index.sqlite'));
  const refresh = async (ids: readonly string[]) => {
    const lookup = makeTaxonomyLookup(await store.readTaxonomy());
    for (const id of ids) {
      const rec = await store.documents.get(id as DocumentId);
      if (rec) await index.upsert(await buildIndexable(store, lookup, rec));
    }
  };
  const rt = {
    libraryId: 'lib-1',
    organizer,
    scanExtensions: async () => ['pdf', 'md', 'txt', 'exe', 'bat', 'docm'],
    reindexDocuments: async (ids: string[]) => {
      reindexed.push([...ids]);
      await refresh(ids);
    },
    getDocument: async (id: string) => {
      const r = await store.documents.get(id as DocumentId);
      if (!r) throw new AppError('NOT_FOUND', 'Unknown document');
      return r;
    },
  };
  const services = {
    log,
    emit: (e: string, p: unknown) => void events.push([e, p]),
    runtime: { sync: async () => {}, hold: () => () => {}, status: () => ({}), require: async () => rt },
    libraries: { profile: async () => ({ rootPath: root, id: 'lib-1' }) },
    shell: {
      openPath: async (p: string) => (opened.push(p), openError),
      showItemInFolder: (p: string) => void revealed.push(p),
    },
  } as unknown as MainServices;
  const dispatch = createDispatcher(channels, buildHandlers(services), log);
  const call = async (c: string, p: unknown = {}) => dispatch(c, p);
  return { call, refresh };
}

const ok = (r: IpcEnvelope) => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.data as Record<string, any>;
};
const fail = (r: IpcEnvelope) => {
  if (r.ok) throw new Error('expected an error');
  return r.error;
};

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rl-org-'));
  store = createLibraryStore({ rootPath: root, deviceId: 'dev-1' });
  events = [];
  reindexed = [];
  opened = [];
  revealed = [];
  openError = '';
  await store.init();
});
afterEach(async () => {
  await index?.close().catch(() => {});
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('organising channels', () => {
  it('taxonomy, bulk tag, update and undo through the dispatcher; events and index refresh', async () => {
    await store.writeTaxonomy(taxonomyFileSchema.parse({ nodes: [node('ml'), node('nn', { implies: ['ml'] })], documentTypes: [{ id: 'paper', label: 'Paper' }] }));
    for (let i = 1; i <= 3; i++) await store.documents.put(doc(i));
    const { call } = await harness();

    const t = ok(await call('taxonomy:get'));
    expect(t.nodes).toHaveLength(2);

    const tag = ok(await call('documents:tag', { docIds: [hex(1), hex(2)], add: ['nn'] }));
    expect(tag).toMatchObject({ changed: 2, unchanged: 0 });
    expect(reindexed.at(-1)?.sort()).toEqual([hex(1), hex(2)]);
    expect(events).toContainEqual(['library:changed', { kind: 'documents', ids: [hex(1), hex(2)] }]);

    // implication: the index finds the documents by the implied tag, and by the label of either
    const byMl = await index.searchPage({ text: '', filters: { tags: ['ml'] } });
    expect(byMl.total).toBe(2);
    expect((await index.searchPage({ text: 'tag:nn' })).total).toBe(2);
    expect(JSON.stringify((await index.list({ filters: { tags: ['ml'] } })).items.map((i) => i.docId).sort())).toBe(JSON.stringify([hex(1), hex(2)]));
    // ...but the record only holds the manual tag
    expect((await store.documents.get(hex(1)))?.tags).toEqual(['nn']);

    const upd = ok(await call('documents:update', { docId: hex(3), patch: { title: 'Hello', type: 'paper', userDescription: 'quokka notes' } }));
    expect(upd.document.title).toBe('Hello');
    expect(upd.document.legacy).toBeUndefined();
    expect((await index.searchPage({ text: 'quokka' })).total).toBe(1);

    const h = ok(await call('history:list', { limit: 10 }));
    expect(h.items.map((i: any) => i.action)).toEqual(['document.fields', 'tags.update']);
    ok(await call('history:undo', {}));
    expect((await store.documents.get(hex(3)))?.title).toBeNull();
    expect(events).toContainEqual(['library:changed', { kind: 'documents', ids: [hex(3)] }]);
    ok(await call('history:undo', {}));
    expect((await store.documents.get(hex(1)))?.tags).toEqual([]);
    expect((await index.searchPage({ text: '', filters: { tags: ['ml'] } })).total).toBe(0);
    ok(await call('history:redo', {}));
    expect((await store.documents.get(hex(1)))?.tags).toEqual(['nn']);
    ok(await call('history:redo', {}));
    expect((await store.documents.get(hex(3)))?.title).toBe('Hello');
    expect(fail(await call('history:redo', {})).code).toBe('NOT_FOUND');
  });

  it('an alias found after a merge: the old name finds the documents of the merged tag', async () => {
    await store.writeTaxonomy(taxonomyFileSchema.parse({ nodes: [node('old', { label: 'Obsolete name' }), node('new', { label: 'Current' })] }));
    await store.documents.put(doc(1, { tags: ['old'] }));
    const { call, refresh } = await harness();
    await refresh([hex(1)]);
    expect((await index.searchPage({ text: 'obsolete' })).total).toBe(1);
    const r = ok(await call('taxonomy:apply', { ops: [{ op: 'merge', from: 'old', into: 'new' }] }));
    expect(r.documentsChanged).toBe(1);
    expect(events.map((e) => (e[1] as any).kind)).toEqual(expect.arrayContaining(['taxonomy', 'documents']));
    expect((await index.searchPage({ text: 'obsolete' })).total).toBe(1);
    expect((await index.searchPage({ text: '', filters: { tags: ['new'] } })).total).toBe(1);
    expect((await index.searchPage({ text: '', filters: { tags: ['old'] } })).total).toBe(0);
    // a rename reaches the index too
    ok(await call('taxonomy:apply', { ops: [{ op: 'rename', id: 'new', label: 'Fresh label' }] }));
    expect((await index.searchPage({ text: 'fresh' })).total).toBe(1);
    ok(await call('history:undo', {}));
    expect((await index.searchPage({ text: 'fresh' })).total).toBe(0);
  });

  it('hostile requests are rejected by the schemas or the services, with stable codes', async () => {
    await store.writeTaxonomy(taxonomyFileSchema.parse({ nodes: [node('a'), node('b', { parents: ['a'] })] }));
    await store.documents.put(doc(1));
    const { call } = await harness();
    expect(fail(await call('taxonomy:apply', { ops: [{ op: 'move', id: 'a', parents: ['b'] }] })).code).toBe('INVALID_REQUEST');
    expect(fail(await call('taxonomy:apply', { ops: [{ op: 'merge', from: 'a', into: 'a' }] })).code).toBe('INVALID_REQUEST');
    expect(fail(await call('taxonomy:apply', { ops: [{ op: 'merge', from: 'a', into: 'zzz' }] })).code).toBe('NOT_FOUND');
    expect(fail(await call('taxonomy:apply', { ops: [{ op: 'create', id: 'NUL', label: 'x' }] })).code).toBe('INVALID_REQUEST');
    expect(fail(await call('taxonomy:apply', { ops: [{ op: 'create', id: 'a/../b', label: 'x' }] })).code).toBe('INVALID_REQUEST');
    expect(fail(await call('taxonomy:apply', { ops: [{ op: 'bogus' }] })).code).toBe('INVALID_REQUEST');
    expect(fail(await call('taxonomy:apply', { ops: [] })).code).toBe('INVALID_REQUEST');
    expect(fail(await call('taxonomy:apply', { ops: [{ op: 'delete', id: 'a' }] })).code).toBe('CONFLICT');
    // upper case ids are normalised, not trusted
    const c = ok(await call('taxonomy:apply', { ops: [{ op: 'create', id: 'MyNode', label: 'x' }] }));
    expect(c.created).toEqual([{ index: 0, id: 'mynode' }]);
    expect(fail(await call('documents:update', { docId: hex(1), patch: { ai: { summary: 'x' } } })).code).toBe('INVALID_REQUEST');
    expect(fail(await call('documents:update', { docId: hex(1), patch: { tags: ['a'] } })).code).toBe('INVALID_REQUEST');
    expect(fail(await call('documents:update', { docId: 'ZZ', patch: { title: 'x' } })).code).toBe('INVALID_REQUEST');
    expect(fail(await call('documents:update', { docId: hex(1), patch: { title: 'x' }, expectedRevision: 5 })).code).toBe('CONFLICT');
    expect(fail(await call('documents:tag', { docIds: [], add: ['a'] })).code).toBe('INVALID_REQUEST');
    expect(fail(await call('documents:tag', { docIds: [hex(1)], add: ['ghost'] })).code).toBe('NOT_FOUND');
    expect(fail(await call('history:undo', { changeId: 'nope' })).code).toBe('NOT_FOUND');
  });

  it('projects through the dispatcher: members from several folders, archive and restore, events', async () => {
    await store.documents.put(doc(1, { path: 'a/one.pdf' }));
    await store.documents.put(doc(2, { path: 'b/two.pdf', study: { state: 'read' } }));
    const { call } = await harness();
    const p = ok(await call('projects:create', { name: 'Thesis', kind: 'project', docIds: [hex(1), hex(2)] }));
    expect(p.project.counts).toMatchObject({ total: 2, toRead: 1, read: 1 });
    expect(events).toContainEqual(['library:changed', { kind: 'projects', ids: ['thesis'] }]);
    ok(await call('projects:setReadingPlan', { projectId: 'thesis', items: [{ docId: hex(2), order: 0 }, { docId: hex(1), order: 1, status: 'reading' }] }));
    expect(ok(await call('projects:get', { id: 'thesis' })).readingPlan.map((i: any) => i.docId)).toEqual([hex(2), hex(1)]);
    ok(await call('projects:delete', { id: 'thesis' }));
    expect(ok(await call('projects:list', {})).items).toEqual([]);
    expect(ok(await call('projects:list', { includeArchived: true })).items).toHaveLength(1);
    expect(ok(await call('projects:restore', { id: 'thesis' })).project.status).toBe('active');
    expect(fail(await call('projects:get', { id: 'missing' })).code).toBe('NOT_FOUND');
    expect(fail(await call('projects:addMembers', { projectId: 'thesis', docIds: [hex(77)] })).code).toBe('NOT_FOUND');
    expect(fail(await call('projects:update', { id: 'thesis', patch: {} })).code).toBe('INVALID_REQUEST');
    expect(fail(await call('projects:update', { id: 'thesis', patch: { revision: 3 } })).code).toBe('INVALID_REQUEST');
  });

  it('library:tree counts folders', async () => {
    await store.documents.put(doc(1, { path: 'a/x.pdf' }));
    await store.documents.put(doc(2, { path: 'a/b/y.pdf' }));
    const { call } = await harness();
    const t = ok(await call('library:tree'));
    expect(t.folders.map((f: any) => [f.path, f.direct, f.total])).toEqual([['a', 1, 2], ['a/b', 1, 1]]);
  });

  it('no response carries an absolute path', async () => {
    await store.writeTaxonomy(taxonomyFileSchema.parse({ nodes: [node('a')] }));
    await store.documents.put(doc(1, { legacy: { path: String.raw`C:\Users\%USERNAME%\old.pdf` }, tags: ['a'] }));
    const { call } = await harness();
    const all = [
      await call('taxonomy:get'),
      await call('documents:update', { docId: hex(1), patch: { title: 'T' } }),
      await call('documents:tag', { docIds: [hex(1)], remove: ['a'] }),
      await call('library:tree'),
      await call('history:list', {}),
      await call('projects:create', { name: 'P', docIds: [hex(1)] }),
      await call('projects:list', {}),
      await call('projects:get', { id: 'p' }),
    ];
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    for (const r of all) walk(ok(r));
    expect(strings.length).toBeGreaterThan(10);
    for (const s of strings) {
      expect(s.includes(root)).toBe(false);
      expect(/^[A-Za-z]:[\\/]/.test(s) || s.startsWith('/') || s.includes('\\Users\\')).toBe(false);
    }
  });
});

describe('documents:open / documents:reveal', () => {
  it('opens a present file with the path resolved by main', async () => {
    await mkdir(path.join(root, 'papers'), { recursive: true });
    await writeFile(path.join(root, 'papers', 'f1.pdf'), 'x');
    await store.documents.put(doc(1));
    const { call } = await harness();
    expect(ok(await call('documents:open', { docId: hex(1) }))).toEqual({ ok: true });
    expect(opened).toEqual([path.join(await realRoot(), 'papers', 'f1.pdf')]);
    expect(ok(await call('documents:reveal', { docId: hex(1) }))).toEqual({ ok: true });
    expect(revealed).toHaveLength(1);
  });

  it('unknown id, missing document, file gone, refused types, system failure', async () => {
    await mkdir(path.join(root, 'papers'), { recursive: true });
    await writeFile(path.join(root, 'papers', 'run.bat'), 'x');
    await writeFile(path.join(root, 'papers', 'f4.pdf'), 'x');
    await store.documents.put(doc(1, { missing: true }));
    await store.documents.put(doc(2)); // record present, file not on disk
    await store.documents.put(doc(3, { path: 'papers/run.bat' }));
    await store.documents.put(doc(4));
    const { call } = await harness();
    for (const ch of ['documents:open', 'documents:reveal']) {
      expect(fail(await call(ch, { docId: hex(99) })).code).toBe('NOT_FOUND');
      expect(fail(await call(ch, { docId: 'not-an-id' })).code).toBe('INVALID_REQUEST');
      expect(fail(await call(ch, { docId: hex(1) }))).toMatchObject({ code: 'NOT_FOUND', details: { reason: 'missing' } });
      expect(fail(await call(ch, { docId: hex(2) }))).toMatchObject({ code: 'NOT_FOUND', details: { reason: 'missing' } });
    }
    expect(fail(await call('documents:open', { docId: hex(3) })).code).toBe('PERMISSION_DENIED');
    openError = `cannot open ${root}`;
    const e = fail(await call('documents:open', { docId: hex(4) }));
    expect(e.code).toBe('IO_ERROR');
    expect(JSON.stringify(e)).not.toContain(root);
    expect(opened).toHaveLength(1);
    expect(revealed).toEqual([]);
  });
});

async function realRoot(): Promise<string> {
  const { realpath } = await import('node:fs/promises');
  return realpath(root);
}

describe('history:list state and project events', () => {
  it('canUndo / canRedo follow the rule of undo and redo without an id', async () => {
    await store.writeTaxonomy(taxonomyFileSchema.parse({ nodes: [node('a'), node('b')] }));
    await store.documents.put(doc(1));
    const { call } = await harness();
    expect(ok(await call('history:list', {}))).toMatchObject({ canUndo: false, canRedo: false });
    const t = ok(await call('documents:tag', { docIds: [hex(1)], add: ['a'] }));
    expect(ok(await call('history:list', {}))).toMatchObject({ canUndo: true, canRedo: false });
    ok(await call('history:undo', { changeId: t.changeId }));
    expect(ok(await call('history:list', {}))).toMatchObject({ canUndo: false, canRedo: true });
    ok(await call('documents:tag', { docIds: [hex(1)], add: ['b'] }));
    expect(ok(await call('history:list', {}))).toMatchObject({ canUndo: true, canRedo: false });
  });

  it('a document edit announces the projects that contain it', async () => {
    await store.documents.put(doc(1));
    await store.documents.put(doc(2));
    const { call } = await harness();
    const p = ok(await call('projects:create', { name: 'P', docIds: [hex(1)] }));
    events.length = 0;
    ok(await call('documents:update', { docId: hex(1), patch: { title: 'New' } }));
    expect(events).toContainEqual(['library:changed', { kind: 'projects', ids: [p.project.id] }]);
    events.length = 0;
    ok(await call('documents:update', { docId: hex(2), patch: { title: 'Other' } }));
    expect(events.some(([, e]) => (e as { kind: string }).kind === 'projects')).toBe(false);
  });
});
