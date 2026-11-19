import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AppError,
  DEFAULT_DATA_DIR_NAME,
  RevisionConflictError,
  dataPath,
  documentRecordSchema,
  taxonomyFileSchema,
  taxonomyOpSchema,
  type ChangeEntry,
  type DocumentRecord,
  type TaxonomyOp,
} from '@rl/core';
import { createLibraryStore, MAX_LOG_READ_BYTES, type FileLibraryStore } from './store.js';
import { createOrganizer, type Organizer } from './organize/organizer.js';
import { restoreProject, restoreTaxonomy } from './organize/history.js';
import { hex, removeDir, tempDir } from './test-utils.js';

const NOW = '2026-01-02T03:04:05.000Z';
const doc = (n: number, over: Record<string, unknown> = {}): DocumentRecord =>
  documentRecordSchema.parse({ id: hex(n), hash: 'a'.repeat(64), path: `docs/file-${n}.pdf`, size: 10, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, ...over });
const node = (id: string, over: Record<string, unknown> = {}) => ({ id, label: id.toUpperCase(), parents: [], aliases: [], implies: [], status: 'active', origin: 'user', ...over });
const ops = (...o: unknown[]): TaxonomyOp[] => o.map((x) => taxonomyOpSchema.parse(x));
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof AppError ? e : new AppError('INTERNAL', `not an AppError: ${String(e)}`);
  }
  return null;
};

let root: string;
let store: FileLibraryStore;
let org: Organizer;
const tagsOf = async (n: number) => (await store.documents.get(hex(n)))?.tags;

async function seed(nodes: unknown[], docs: DocumentRecord[] = []) {
  await store.init();
  await store.writeTaxonomy(taxonomyFileSchema.parse({ nodes }));
  for (const d of docs) await store.documents.put(d);
}

beforeEach(async () => {
  root = await tempDir();
  store = createLibraryStore({ rootPath: root, deviceId: 'dev-1' });
  org = createOrganizer({ store, deviceId: 'dev-1', cacheTtlMs: 0 });
});
afterEach(() => removeDir(root));

describe('undo treats the change log as untrusted input (2)', () => {
  const entry = (over: Partial<ChangeEntry>): ChangeEntry => ({ type: 'change', at: NOW, deviceId: 'dev-1', actor: 'user', target: { kind: 'document', id: hex(1) }, action: 'document.fields', ...over }) as ChangeEntry;

  it('refuses an edited entry that would write a path, id, hash or AI field', async () => {
    await seed([], [doc(1, { title: 'T' })]);
    for (const evil of [{ path: '../../outside.exe' }, { id: hex(9) }, { hash: 'b'.repeat(64) }, { aliasPaths: ['x.exe'] }, { ai: {} }, { legacy: { a: 1 } }]) {
      const cs = store.withChange({ changeId: `chg-evil-${Object.keys(evil)[0]}`, summary: 'edited by hand' });
      await cs.appendLog(entry({ before: { title: 'T', ...evil }, after: { title: 'T' } }));
      const e = await code(org.undo(`chg-evil-${Object.keys(evil)[0]}`));
      expect(e?.code, Object.keys(evil)[0]).toBe('SCHEMA_INVALID');
    }
    const rec = await store.documents.get(hex(1));
    expect(rec?.path).toBe('docs/file-1.pdf');
    expect(rec?.title).toBe('T');
  });

  it('restoreProject: id of the entry must match; schema is checked', () => {
    const ent = entry({ action: 'project.remove', target: { kind: 'project', id: 'p1' }, before: { project: { schemaVersion: 1, id: 'other', name: 'x', createdAt: NOW, updatedAt: NOW } } });
    expect(() => restoreProject(null, [ent], 'p1', NOW)).toThrow(/not valid/);
    const wrong = entry({ action: 'project.update', target: { kind: 'project', id: 'p2' }, before: { name: 'a' }, after: { name: 'b' } });
    const cur = { schemaVersion: 1, id: 'p1', name: 'b', description: '', status: 'active', members: [], notes: '', readingPlan: [], createdAt: NOW, updatedAt: NOW } as never;
    expect(() => restoreProject(cur, [wrong], 'p1', NOW)).toThrow(/not valid/);
    const forbidden = entry({ action: 'project.update', target: { kind: 'project', id: 'p1' }, before: { name: 'a', id: 'zzz' }, after: { name: 'b' } });
    expect(() => restoreProject(cur, [forbidden], 'p1', NOW)).toThrow(/not valid/);
    const notAString = entry({ action: 'project.update', target: { kind: 'project', id: 'p1' }, before: { name: 42 }, after: { name: 'b' } });
    expect(() => restoreProject(cur, [notAString], 'p1', NOW)).toThrow(/not valid/);
  });

  it('restoreTaxonomy: a node under another key, or an invalid node, is refused', () => {
    const cur = taxonomyFileSchema.parse({ nodes: [node('a', { label: 'B' })] });
    const e1 = entry({ action: 'taxonomy.update', target: { kind: 'taxonomy' }, before: { nodes: { a: node('zzz') } }, after: { nodes: { a: cur.nodes[0] } } });
    expect(() => restoreTaxonomy(cur, [e1])).toThrow(/not valid/);
    const e2 = entry({ action: 'taxonomy.update', target: { kind: 'taxonomy' }, before: { nodes: { a: { id: 'a', label: '' } } }, after: { nodes: { a: cur.nodes[0] } } });
    expect(() => restoreTaxonomy(cur, [e2])).toThrow(/not valid/);
  });
});

describe('targeted taxonomy undo leaves no orphan tag and no cycle (3)', () => {
  it('undoing the creation of a node that documents now carry is refused', async () => {
    await seed([], [doc(1), doc(2), doc(3)]);
    const c = await org.applyTaxonomy(ops({ op: 'create', id: 'x', label: 'X' }));
    await org.tagDocuments([hex(1), hex(2), hex(3)], ['x']);
    const e = await code(org.undo(c.changeId));
    expect(e).toMatchObject({ code: 'CONFLICT', details: { conflict: 'in-use', id: 'x' } });
    expect((await org.taxonomy()).nodes.map((n) => n.id)).toEqual(['x']);
  });

  it('undoing the creation of a node another node refers to is refused', async () => {
    await seed([node('a')]);
    const c = await org.applyTaxonomy(ops({ op: 'create', id: 'x', label: 'X' }));
    await org.applyTaxonomy(ops({ op: 'move', id: 'a', parents: ['x'] }));
    expect(await code(org.undo(c.changeId))).toMatchObject({ code: 'CONFLICT', details: { conflict: 'in-use' } });
  });

  it('move N under Q, then P under N: undoing the first would make a cycle', async () => {
    await seed([node('p'), node('q'), node('n', { parents: ['p'] })]);
    const c1 = await org.applyTaxonomy(ops({ op: 'move', id: 'n', parents: ['q'] }));
    await org.applyTaxonomy(ops({ op: 'move', id: 'p', parents: ['n'] }));
    expect(await code(org.undo(c1.changeId))).toMatchObject({ code: 'CONFLICT', details: { conflict: 'cycle', field: 'parents' } });
    expect((await org.taxonomy()).nodes.find((x) => x.id === 'n')?.parents).toEqual(['q']);
  });

  it('same with implications', async () => {
    await seed([node('p'), node('q'), node('n', { implies: ['p'] })]);
    const c1 = await org.applyTaxonomy(ops({ op: 'setImplies', id: 'n', implies: ['q'] }));
    await org.applyTaxonomy(ops({ op: 'setImplies', id: 'p', implies: ['n'] }));
    expect(await code(org.undo(c1.changeId))).toMatchObject({ code: 'CONFLICT', details: { conflict: 'cycle', field: 'implies' } });
  });

  it('undoing a merge is refused when other documents received the surviving node since', async () => {
    await seed([node('a'), node('b')], [doc(1, { tags: ['a'] }), doc(2)]);
    const m = await org.applyTaxonomy(ops({ op: 'merge', from: 'a', into: 'b' }));
    await org.tagDocuments([hex(2)], ['b']);
    expect(await code(org.undo(m.changeId))).toMatchObject({ code: 'CONFLICT', details: { conflict: 'in-use', id: 'b' } });
    expect(await tagsOf(1)).toEqual(['b']);
    expect((await org.taxonomy()).nodes.map((n) => n.id)).toEqual(['b']);
  });
});

describe('a run of overlapping steps unwinds like a stack (D-504)', () => {
  /** Taxonomy nodes (without counters) and the tags of every document: what "the exact previous state" means. */
  const state = async () => {
    const tax = await store.readTaxonomy();
    const docs = await store.documents.list();
    return JSON.stringify({ nodes: tax.nodes, distinct: tax.distinct ?? [], docs: docs.map((d) => [d.id, [...d.tags].sort()]).sort() });
  };
  const seedShared = () =>
    seed(
      ['a', 'a2', 'b', 'b2', 'c', 'c2', 'd', 'e'].map((id) => node(id)),
      [1, 2, 3, 4].map((n) => doc(n, { tags: n % 2 ? ['a', 'b', 'c', 'd'] : ['a2', 'b', 'e'] })),
    );
  const steps = [
    ops({ op: 'merge', from: 'a2', into: 'a' }),
    ops({ op: 'merge', from: 'b2', into: 'b' }),
    ops({ op: 'merge', from: 'c2', into: 'c' }),
    ops({ op: 'merge', from: 'e', into: 'a' }),
    ops({ op: 'merge', from: 'd', into: 'b' }),
    ops({ op: 'merge', from: 'c', into: 'a' }),
  ];

  it('apply six steps on shared documents, then undo in reverse order: the same taxonomy and tags', async () => {
    await seedShared();
    await org.tagDocuments([hex(3)], ['b2', 'c2']);
    const initial = await state();
    const ids: string[] = [];
    for (const o of steps) ids.push((await org.applyTaxonomy(o)).changeId);
    expect(await state()).not.toBe(initial);
    // A plain undo of the first merge is refused (the later ones touched the same documents)...
    expect(await code(org.undo(ids[0]))).toMatchObject({ code: 'CONFLICT' });
    // ...while the unwind, later steps first and carrying the documents it already put back, always works.
    const settled = new Set<string>();
    for (const id of [...ids].reverse()) for (const d of (await org.undo(id, settled)).docIds) settled.add(d);
    expect(await state()).toBe(initial);
  });

  it('undoing step 2 while steps 3 and 4 stand is refused and changes nothing', async () => {
    await seedShared();
    const ids: string[] = [];
    for (const o of steps.slice(0, 4)) ids.push((await org.applyTaxonomy(o)).changeId);
    const after = await state();
    expect(await code(org.undo(ids[1]))).toMatchObject({ code: 'CONFLICT' });
    expect(await state()).toBe(after);
  });
});

describe('a taxonomy batch is all or nothing (4)', () => {
  /** A store whose taxonomy write fails as if another device had changed the file. */
  const conflicting = (inner: FileLibraryStore) =>
    new Proxy(inner, {
      get(t, prop) {
        if (prop === 'withChange') {
          return (ctx: never) =>
            new Proxy(t.withChange(ctx), {
              get(cs, p) {
                if (p === 'writeTaxonomy') return async () => Promise.reject(new RevisionConflictError('taxonomy', 1, 2));
                const v = Reflect.get(cs, p, cs);
                return typeof v === 'function' ? v.bind(cs) : v;
              },
            });
        }
        const v = Reflect.get(t, prop, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });

  it('a conflict on the final taxonomy write leaves no document retagged', async () => {
    await seed([node('a'), node('b')], [doc(1, { tags: ['a'] }), doc(2, { tags: ['a', 'b'] })]);
    const o = createOrganizer({ store: conflicting(store), deviceId: 'dev-1', cacheTtlMs: 0 });
    expect((await code(o.applyTaxonomy(ops({ op: 'merge', from: 'a', into: 'b' }))))?.code).toBe('CONFLICT');
    expect(await tagsOf(1)).toEqual(['a']);
    expect(await tagsOf(2)).toEqual(['a', 'b']);
    // nothing of it is an undoable change
    expect(await org.listHistory()).toEqual([]);
  });

  it('a merge into a node created in the same batch is consistent', async () => {
    await seed([node('a')], [doc(1, { tags: ['a'] })]);
    const r = await org.applyTaxonomy(ops({ op: 'create', id: 'c', label: 'C' }, { op: 'merge', from: 'a', into: 'c' }));
    expect(await tagsOf(1)).toEqual(['c']);
    expect((await org.taxonomy()).nodes.map((n) => n.id)).toEqual(['c']);
    // and the whole thing undoes with the retagged documents
    await org.undo(r.changeId);
    expect(await tagsOf(1)).toEqual(['a']);
    expect((await org.taxonomy()).nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('the same merge with a conflict leaves the documents on the old node', async () => {
    await seed([node('a')], [doc(1, { tags: ['a'] })]);
    const o = createOrganizer({ store: conflicting(store), deviceId: 'dev-1', cacheTtlMs: 0 });
    expect((await code(o.applyTaxonomy(ops({ op: 'create', id: 'c', label: 'C' }, { op: 'merge', from: 'a', into: 'c' }))))?.code).toBe('CONFLICT');
    expect(await tagsOf(1)).toEqual(['a']);
    expect((await org.taxonomy()).nodes.map((n) => n.id)).toEqual(['a']);
  });
});

describe('big files from a synced folder (6)', () => {
  const MIB = 1024 * 1024;
  async function writeBig(file: string, mib: number, block: string): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '');
    for (let i = 0; i < mib; i++) await appendFile(file, block);
  }

  it('a taxonomy over 32 MiB is refused as unreadable, nothing crashes', async () => {
    await seed([]);
    const f = path.join(root, DEFAULT_DATA_DIR_NAME, dataPath.taxonomy);
    await writeBig(f, 40, ' '.repeat(MIB));
    expect((await code(store.readTaxonomy()))?.code).toBe('SCHEMA_INVALID');
  });

  it('a record over 32 MiB is skipped by the listing and reported', async () => {
    await seed([], [doc(1), doc(2)]);
    const f = path.join(root, DEFAULT_DATA_DIR_NAME, 'documents', `${hex(2)}.json`);
    await writeBig(f, 40, ' '.repeat(MIB));
    const fresh = createLibraryStore({ rootPath: root, deviceId: 'dev-1' });
    expect((await fresh.documents.list()).map((d) => d.id)).toEqual([hex(1)]);
    expect(fresh.issues()).toHaveLength(1);
  });

  it('a huge log is read from its end, with a ceiling; the rest is reported', async () => {
    await seed([node('a')], [doc(1)]);
    const month = new Date().toISOString().slice(0, 7);
    const f = path.join(root, DEFAULT_DATA_DIR_NAME, dataPath.logFile('changes', 'dev-1', month));
    await writeBig(f, 40, `${'x'.repeat(1023)}\n`.repeat(1024));
    await appendFile(f, `${'y'.repeat(2 * MIB)}\n`); // one endless line
    await org.tagDocuments([hex(1)], ['a']);
    const log = await store.readLog({ type: 'change' });
    expect(log.some((e) => e.type === 'change' && e.action === 'tags.update')).toBe(true);
    expect(MAX_LOG_READ_BYTES).toBe(32 * MIB);
    expect(store.issues().map((i) => i.code)).toEqual(expect.arrayContaining(['LOG_TRUNCATED', 'LOG_LINES_SKIPPED']));
  });

  it('the taxonomy schema bounds what the IPC channels bound', () => {
    expect(taxonomyFileSchema.safeParse({ schemaVersion: 1, nodes: [node('a', { label: 'x'.repeat(201) })] }).success).toBe(false);
    expect(taxonomyFileSchema.safeParse({ schemaVersion: 1, nodes: [node('a', { parents: Array.from({ length: 201 }, (_, i) => `p${i}`) })] }).success).toBe(false);
    expect(taxonomyFileSchema.safeParse({ schemaVersion: 1, nodes: [node('a', { aliases: Array.from({ length: 501 }, (_, i) => `a${i}`) })] }).success).toBe(false);
    expect(taxonomyFileSchema.safeParse({ schemaVersion: 1, nodes: [node('a')] }).success).toBe(true);
  });
});

describe('history canUndo / canRedo and its cache (7)', () => {
  it('canRedo is false after an undo followed by a new change', async () => {
    await seed([node('a'), node('b')], [doc(1)]);
    expect(await org.historyView()).toMatchObject({ canUndo: false, canRedo: false });
    const c1 = await org.tagDocuments([hex(1)], ['a']);
    expect(await org.historyView()).toMatchObject({ canUndo: true, canRedo: false });
    await org.undo(c1.changeId as string);
    expect(await org.historyView()).toMatchObject({ canRedo: true });
    await org.tagDocuments([hex(1)], ['b']);
    const v = await org.historyView();
    expect(v.canRedo).toBe(false);
    expect(v.canUndo).toBe(true);
    expect((await code(org.redo()))?.code).toBe('NOT_FOUND');
  });

  it('the log is read again only when a log file changed', async () => {
    await seed([node('a')], [doc(1)]);
    let reads = 0;
    const counting = new Proxy(store, {
      get(t, prop) {
        if (prop === 'readLogReport') return (...a: never[]) => (reads++, (t.readLogReport as (...x: unknown[]) => unknown)(...a));
        const v = Reflect.get(t, prop, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    const o = createOrganizer({ store: counting, deviceId: 'dev-1', cacheTtlMs: 0 });
    await o.tagDocuments([hex(1)], ['a']);
    await o.listHistory();
    await o.historyView();
    await o.historyView();
    expect(reads).toBe(1);
    await org.updateDocument(hex(1), { title: 'T' }); // another writer on the same files
    await o.listHistory();
    expect(reads).toBe(2);
  });
});

describe('reading plan state has one source (9)', () => {
  it('a per-item status is accepted but not saved; the view shows the document state, counts agree', async () => {
    await seed([], [doc(1, { study: { state: 'read' } }), doc(2)]);
    const p = (await org.createProject({ name: 'P', docIds: [hex(1), hex(2)] })).detail.project.id;
    const r = await org.setReadingPlan(p, [
      { docId: hex(1), order: 0, status: 'to-read' },
      { docId: hex(2), order: 1, status: 'read' },
    ]);
    expect((await store.projects.get(p))?.readingPlan.every((i) => i.status === undefined)).toBe(true);
    expect(r.detail.readingPlan.map((i) => [i.studyState, i.status])).toEqual([
      ['read', 'read'],
      ['to-read', 'to-read'],
    ]);
    expect(r.detail.project.counts).toMatchObject({ read: 1, toRead: 1 });
  });
});
