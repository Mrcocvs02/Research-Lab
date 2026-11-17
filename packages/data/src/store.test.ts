import { appendFile, mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, defaultLibraryConfig, documentRecordSchema, taxonomyFileSchema, type DocumentRecord } from '@rl/core';
import { createLibraryStore, type FileLibraryStore } from './store.js';
import { hex, removeDir, tempDir } from './test-utils.js';

const NOW = '2026-01-02T03:04:05.000Z';

function doc(n: number, over: Partial<DocumentRecord> = {}): DocumentRecord {
  return documentRecordSchema.parse({
    id: hex(n),
    hash: 'a'.repeat(64),
    path: `docs/file-${n}.pdf`,
    size: 10,
    mtimeMs: 1,
    addedAt: NOW,
    updatedAt: NOW,
    ...over,
  });
}

const project = (id: string) => ({
  schemaVersion: 1 as const,
  id,
  name: 'P',
  description: '',
  status: 'active' as const,
  members: [],
  notes: '',
  readingPlan: [],
  createdAt: NOW,
  updatedAt: NOW,
});

let root: string;
let store: FileLibraryStore;

beforeEach(async () => {
  root = await tempDir();
  store = createLibraryStore({ rootPath: root, deviceId: 'device-1' });
});
afterEach(() => removeDir(root));

describe('library store', () => {
  it('init creates the layout and a default config, idempotently', async () => {
    await store.init();
    await store.init();
    const names = await readdir(store.dataDir);
    expect(names).toEqual(expect.arrayContaining(['documents', 'notes', 'annotations', 'citations', 'projects', 'log', 'commands', 'library.json']));
    expect(await store.readConfig()).toEqual(defaultLibraryConfig());
  });

  it('reads defaults from an empty data dir without creating it', async () => {
    expect(await store.readTaxonomy()).toEqual(taxonomyFileSchema.parse({}));
    expect((await store.readWatch()).sources).toEqual([]);
    expect(await store.documents.get(hex(1))).toBeNull();
    expect(await store.documents.list()).toEqual([]);
    await expect(readdir(store.dataDir)).rejects.toThrow();
  });

  it('round-trips documents, lists ids sorted, removes', async () => {
    await store.documents.put(doc(2));
    await store.documents.put(doc(1, { title: 'One' }));
    expect(await store.documents.listIds()).toEqual([hex(1), hex(2)]);
    expect((await store.documents.get(hex(1)))?.title).toBe('One');
    expect(await store.documents.list()).toHaveLength(2);
    await store.documents.remove(hex(1));
    await store.documents.remove(hex(1));
    expect(await store.documents.get(hex(1))).toBeNull();
  });

  it('reports a corrupt file with a typed error and still loads the rest', async () => {
    await store.documents.put(doc(1));
    await store.documents.put(doc(2));
    await writeFile(path.join(store.dataDir, 'documents', `${hex(3)}.json`), '{ not json');
    await writeFile(path.join(store.dataDir, 'documents', `${hex(4)}.json`), JSON.stringify({ id: hex(4) }));
    await expect(store.documents.get(hex(3))).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
    await expect(store.documents.get(hex(4))).rejects.toBeInstanceOf(AppError);
    const all = await store.documents.list();
    expect(all.map((d) => d.id)).toEqual([hex(1), hex(2)]);
    expect(store.issues().map((i) => i.file).sort()).toEqual([`documents/${hex(3)}.json`, `documents/${hex(4)}.json`]);
  });

  it('rejects a file whose content id differs from its name', async () => {
    await store.documents.put(doc(1));
    const file = path.join(store.dataDir, 'documents', `${hex(1)}.json`);
    const raw = (await readFile(file, 'utf8')).replace(hex(1), hex(9));
    await writeFile(file, raw);
    await expect(store.documents.get(hex(1))).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
  });

  it('refuses to write invalid data and leaves no partial file', async () => {
    await expect(store.documents.put({ ...doc(1), hash: 'nope' } as DocumentRecord)).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
    await expect(readdir(path.join(store.dataDir, 'documents'))).rejects.toThrow();
  });

  it('writes atomically: a failed rename keeps the old content and removes the temp file', async () => {
    await store.documents.put(doc(1, { title: 'Old' }));
    const failing = createLibraryStore({
      rootPath: root,
      deviceId: 'device-1',
      atomic: { attempts: 2, baseDelayMs: 1, renameImpl: () => Promise.reject(Object.assign(new Error('locked'), { code: 'EBUSY' })) },
    });
    await expect(failing.documents.put(doc(1, { title: 'New' }))).rejects.toMatchObject({ code: 'IO_ERROR' });
    expect((await store.documents.get(hex(1)))?.title).toBe('Old');
    expect((await readdir(path.join(store.dataDir, 'documents'))).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('retries a locked file and then succeeds', async () => {
    let calls = 0;
    const flaky = createLibraryStore({
      rootPath: root,
      deviceId: 'device-1',
      atomic: {
        baseDelayMs: 1,
        renameImpl: async (from, to) => {
          if (++calls < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
          await rename(from, to);
        },
      },
    });
    await flaky.documents.put(doc(1));
    expect(calls).toBe(3);
    expect(await flaky.documents.get(hex(1))).not.toBeNull();
  });

  it('confines item ids to the data dir', async () => {
    await expect(store.documents.get('../../x' as never)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(store.projects.get('..\\x')).rejects.toBeInstanceOf(AppError);
    await expect(store.notes.get('../x' as never)).rejects.toBeInstanceOf(Error);
  });

  it('does not follow a linked sub folder out of the data dir', async () => {
    const outside = await tempDir('rl-outside-');
    try {
      await mkdir(store.dataDir, { recursive: true });
      try {
        await symlink(outside, path.join(store.dataDir, 'projects'), 'junction');
      } catch {
        return; // links not permitted on this machine
      }
      await expect(store.projects.put(project('p1'))).rejects.toMatchObject({ code: 'PATH_OUTSIDE_ROOT' });
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await removeDir(outside);
    }
  });

  it('stores notes, annotations, citations, projects, watch and config', async () => {
    const id = hex(5);
    await store.notes.put({ frontmatter: { docId: id, scope: 'file', createdAt: NOW, updatedAt: NOW }, body: '# Title\n\nbody: with colon\n' });
    await store.notes.put({ frontmatter: { docId: id, scope: 'page', page: 3, createdAt: NOW, updatedAt: NOW }, body: 'p3' });
    const notes = await store.notes.listForDocument(id);
    expect(notes.map((n) => n.frontmatter.page ?? 0)).toEqual([0, 3]);
    expect(notes[0]?.body).toBe('# Title\n\nbody: with colon\n');
    await store.notes.remove(id, 3);
    expect(await store.notes.get(id, 3)).toBeNull();

    const ann = { id: 'a1', kind: 'highlight' as const, page: 1, rects: [{ x: 0, y: 0, w: 0.5, h: 0.1 }], text: 't', color: 'yellow', createdAt: NOW, updatedAt: NOW };
    await store.annotations.upsert(id, ann);
    await store.annotations.upsert(id, { ...ann, text: 'changed' });
    await store.annotations.upsert(id, { ...ann, id: 'a2' });
    expect((await store.annotations.get(id))?.annotations.map((a) => a.text)).toEqual(['changed', 't']);

    await store.citations.put({ schemaVersion: 1, docId: id, references: [], citedBy: [] });
    expect(await store.citations.listIds()).toEqual([id]);

    await store.projects.put(project('proj-1'));
    expect((await store.projects.list()).map((p) => p.id)).toEqual(['proj-1']);

    await store.writeWatch({ schemaVersion: 1, sources: [{ id: 'w1', kind: 'topic', query: 'q', label: '', enabled: true }], seen: [], dismissedRecommendations: [] });
    expect((await store.readWatch()).sources).toHaveLength(1);

    await store.writeConfig({ ...defaultLibraryConfig(), name: 'Mine' });
    expect((await store.readConfig()).name).toBe('Mine');
  });

  it('logs tag changes with before and after, and taxonomy changes as item diffs', async () => {
    const s = store.withActor('user');
    await s.documents.put(doc(1, { tags: ['a'] }));
    await s.documents.put(doc(1, { tags: ['a', 'b'], title: 'x' }));
    await s.documents.put(doc(1, { tags: ['a', 'b'], title: 'y' })); // no tag change: no entry
    const base = taxonomyFileSchema.parse({});
    await s.writeTaxonomy({ ...base, nodes: [{ id: 'n1', label: 'N1', parents: [], aliases: [], implies: [], status: 'active', origin: 'user' }] });
    await s.writeTaxonomy({ ...(await s.readTaxonomy()), nodes: [] });
    const log = await s.readLog({ type: 'change' });
    expect(log.map((e) => (e.type === 'change' ? e.action : ''))).toEqual(['document.create', 'tags.update', 'taxonomy.update', 'taxonomy.update']);
    expect(log[1]).toMatchObject({ target: { kind: 'document', id: hex(1) }, before: { tags: ['a'] }, after: { tags: ['a', 'b'] }, actor: 'user', deviceId: 'device-1' });
    const added = log[2];
    expect(added && added.type === 'change' && (added.after as { nodes: Record<string, unknown> }).nodes['n1']).toMatchObject({ label: 'N1' });
    const removed = log[3];
    expect(removed && removed.type === 'change' && (removed.before as { nodes: Record<string, unknown> }).nodes['n1']).toMatchObject({ label: 'N1' });
    expect((await s.readTaxonomy()).revision).toBe(2);
    expect(await s.readLog({ limit: 1 })).toHaveLength(1);
  });

  it('skips an unchanged taxonomy write and never overwrites a corrupt taxonomy', async () => {
    await store.writeTaxonomy(taxonomyFileSchema.parse({}));
    const rev = (await store.readTaxonomy()).revision;
    await store.writeTaxonomy(await store.readTaxonomy());
    expect((await store.readTaxonomy()).revision).toBe(rev);
    await writeFile(path.join(store.dataDir, 'taxonomy.json'), 'garbage');
    await expect(store.writeTaxonomy(taxonomyFileSchema.parse({}))).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
    expect(await readFile(path.join(store.dataDir, 'taxonomy.json'), 'utf8')).toBe('garbage');
  });

  it('tolerates a torn last log line', async () => {
    await store.documents.put(doc(1, { tags: ['a'] }));
    const dir = path.join(store.dataDir, 'log');
    const [file] = await readdir(dir);
    await appendFile(path.join(dir, file as string), '{"type":"chan');
    expect(await store.readLog()).toHaveLength(1);
  });

  it('rejects unsafe device ids', () => {
    expect(() => createLibraryStore({ rootPath: root, deviceId: '../evil' })).toThrow();
  });
});

describe('change head state is shared between instances of one change (D-182)', () => {
  it('withActor keeps one summary per group, and a failed write hands the summary to the next entry', async () => {
    const root = await tempDir();
    try {
      const s = createLibraryStore({ rootPath: root, deviceId: 'dev-1' });
      await s.init();
      const base = { type: 'change', at: '2026-01-02T03:04:05.000Z', deviceId: 'dev-1', actor: 'user', target: { kind: 'taxonomy' }, action: 'taxonomy.update' } as const;
      const cs = s.withChange({ changeId: 'chg-1', summary: 'Head' });
      await cs.appendLog(base);
      await cs.withActor('ai').appendLog(base);
      await cs.withActor('system').withActor('ai').appendLog(base);
      const log = (await s.readLog({ type: 'change' })).filter((e) => e.type === 'change' && e.changeId === 'chg-1');
      expect(log).toHaveLength(3);
      expect(log.filter((e) => e.type === 'change' && e.summary === 'Head')).toHaveLength(1);

      // The first write of a second change fails (invalid entry): the head is not consumed and goes on the next entry.
      const c2 = s.withChange({ changeId: 'chg-2', summary: 'Head 2' });
      await expect(c2.appendLog({ ...base, action: '' })).rejects.toBeDefined();
      await c2.withActor('ai').appendLog(base);
      const second = (await s.readLog({ type: 'change' })).filter((e) => e.type === 'change' && e.changeId === 'chg-2');
      expect(second.map((e) => e.type === 'change' && e.summary)).toEqual(['Head 2']);
    } finally {
      await removeDir(root);
    }
  });
});
