import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, STUDY_LIMITS, channels, createDispatcher, createMemoryLogger, documentRecordSchema, type DocumentId, type IpcEnvelope } from '@rl/core';
import { createLibraryStore, createOrganizer, type FileLibraryStore } from '@rl/data';
import { createSearchIndex } from '@rl/search';
import { buildIndexable, makeTaxonomyLookup } from '../library/indexable.js';
import { buildHandlers, type MainServices } from './handlers/index.js';
import { plainExcerpt } from './handlers/study-handlers.js';

const NOW = '2026-01-02T03:04:05.000Z';
const HASH = 'ab'.repeat(32);
const hex = (n: number) => n.toString(16).padStart(16, '0');
const doc = (n: number, over: Record<string, unknown> = {}) =>
  documentRecordSchema.parse({ id: hex(n), hash: HASH, path: `papers/f${n}.pdf`, size: 10, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, title: `Paper ${n}`, ...over });
const PDF = Buffer.from('%PDF-1.4\nbody of the file\n%%EOF\n');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

let root: string;
let store: FileLibraryStore;
let events: Array<[string, unknown]>;
let reindexed: string[][];
let opened: string[];
let index: ReturnType<typeof createSearchIndex>;
let failIndex = false;

async function harness() {
  const log = createMemoryLogger();
  const organizer = createOrganizer({ store, deviceId: 'dev-1', cacheTtlMs: 0 });
  index = createSearchIndex();
  await index.open(path.join(root, 'index.sqlite'));
  const rt = {
    libraryId: 'lib-1',
    organizer,
    store,
    reindexDocuments: async (ids: string[]) => {
      reindexed.push([...ids]);
      if (failIndex) throw new Error('index down');
      const lookup = makeTaxonomyLookup(await store.readTaxonomy());
      for (const id of ids) {
        const rec = await store.documents.get(id as DocumentId);
        if (rec) await index.upsert(await buildIndexable(store, lookup, rec));
      }
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
    shell: { openPath: async () => '', showItemInFolder: () => {}, openExternal: async (u: string) => void opened.push(u) },
  } as unknown as MainServices;
  const dispatch = createDispatcher(channels, buildHandlers(services), log);
  return async (c: string, p: unknown = {}) => dispatch(c, p);
}

const ok = (r: IpcEnvelope) => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.data as Record<string, any>;
};
const fail = (r: IpcEnvelope) => {
  if (r.ok) throw new Error('expected an error');
  return r.error;
};
const search = async (text: string) => (await index.ids({ text })).ids;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rl-study-'));
  store = createLibraryStore({ rootPath: root, deviceId: 'dev-1' });
  events = [];
  reindexed = [];
  opened = [];
  failIndex = false;
  await store.init();
  await mkdir(path.join(root, 'papers'), { recursive: true });
  await writeFile(path.join(root, 'papers', 'f1.pdf'), PDF);
  await writeFile(path.join(root, 'papers', 'f2.pdf'), 'not a pdf');
  await writeFile(path.join(root, 'papers', 'f3.txt'), PDF);
  await store.documents.put(doc(1));
  await store.documents.put(doc(2));
  await store.documents.put(doc(3, { path: 'papers/f3.txt' }));
  await store.documents.put(doc(4)); // no file on disk
  await store.documents.put(doc(5, { missing: true }));
});
afterEach(async () => {
  await index?.close().catch(() => {});
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('reader:open', () => {
  it('answers an rl-doc URL with the first 8 hex of the hash, never a path', async () => {
    const call = await harness();
    const d = ok(await call('reader:open', { docId: hex(1) }));
    expect(d.url).toBe(`rl-doc://doc/${hex(1)}?v=${HASH.slice(0, 8)}`);
    expect(d.hash).toBe(HASH);
    expect(d.title).toBe('Paper 1');
    expect(JSON.stringify(d)).not.toContain(root.replaceAll('\\', '/'));
  });

  it('refuses what is not a present PDF', async () => {
    const call = await harness();
    const reason = async (id: string) => {
      const e = fail(await call('reader:open', { docId: id }));
      return [e.code, (e.details as { reason?: string } | undefined)?.reason];
    };
    expect(await reason(hex(2))).toEqual(['PERMISSION_DENIED', 'not-pdf']); // .pdf name, other bytes
    expect(await reason(hex(3))).toEqual(['PERMISSION_DENIED', 'not-pdf']); // not a .pdf name
    expect(await reason(hex(4))).toEqual(['PERMISSION_DENIED', 'missing']); // file gone
    expect(await reason(hex(5))).toEqual(['PERMISSION_DENIED', 'missing']); // marked missing
    expect(fail(await call('reader:open', { docId: hex(99) })).code).toBe('NOT_FOUND');
  });
});

describe('reader:openLink', () => {
  it('opens only http and https', async () => {
    const call = await harness();
    ok(await call('reader:openLink', { url: 'https://example.org/a?b=1' }));
    ok(await call('reader:openLink', { url: 'http://example.org/' }));
    expect(opened).toEqual(['https://example.org/a?b=1', 'http://example.org/']);
    for (const url of ['file:///c:/windows/system32/calc.exe', 'javascript:alert(1)', 'ftp://example.org/x', 'rl-doc://doc/' + hex(1), 'data:text/html,hi', 'https://user:pw@example.org/', 'mailto:a@b.c']) {
      expect(fail(await call('reader:openLink', { url })).code).toBe('PERMISSION_DENIED');
    }
    expect(opened).toHaveLength(2);
  });
});

describe('notes', () => {
  it('gets, lists (file note first, then pages) and saves', async () => {
    const call = await harness();
    expect(ok(await call('notes:get', { docId: hex(1) })).note).toBeNull();
    const p2 = ok(await call('notes:save', { docId: hex(1), page: 2, body: '# Heading\nsecond **page** note', expectedUpdatedAt: null })).note;
    const p1 = ok(await call('notes:save', { docId: hex(1), page: 1, body: 'first page', expectedUpdatedAt: null })).note;
    const file = ok(await call('notes:save', { docId: hex(1), body: 'whole file with [a link](https://x.example)', expectedUpdatedAt: null })).note;
    expect(file).toMatchObject({ docId: hex(1), body: 'whole file with [a link](https://x.example)' });
    expect(file.page).toBeUndefined();
    expect(p1.page).toBe(1);
    expect(ok(await call('notes:get', { docId: hex(1), page: 2 })).note).toMatchObject({ body: p2.body, page: 2 });
    const items = ok(await call('notes:list', { docId: hex(1) })).items as Array<{ page: number | null; excerpt: string }>;
    expect(items.map((i) => i.page)).toEqual([null, 1, 2]);
    expect(items[0]!.excerpt).toBe('whole file with a link');
    expect(items[2]!.excerpt).toBe('Heading second page note');
    expect(fail(await call('notes:get', { docId: hex(99) })).code).toBe('NOT_FOUND');
    expect(fail(await call('notes:save', { docId: hex(99), body: 'x', expectedUpdatedAt: null })).code).toBe('NOT_FOUND');
  });

  it('keeps createdAt across edits and moves updatedAt forward', async () => {
    const call = await harness();
    const a = ok(await call('notes:save', { docId: hex(1), body: 'one', expectedUpdatedAt: null })).note;
    const b = ok(await call('notes:save', { docId: hex(1), body: 'two', expectedUpdatedAt: a.updatedAt })).note;
    expect(b.createdAt).toBe(a.createdAt);
    expect(Date.parse(b.updatedAt)).toBeGreaterThan(Date.parse(a.updatedAt));
    expect(ok(await call('notes:get', { docId: hex(1) })).note.body).toBe('two');
  });

  it('answers CONFLICT and writes nothing when the note changed meanwhile', async () => {
    const call = await harness();
    const a = ok(await call('notes:save', { docId: hex(1), body: 'mine', expectedUpdatedAt: null })).note;
    ok(await call('notes:save', { docId: hex(1), body: 'theirs', expectedUpdatedAt: a.updatedAt }));
    events.length = 0;
    reindexed.length = 0;
    const e = fail(await call('notes:save', { docId: hex(1), body: 'stale edit', expectedUpdatedAt: a.updatedAt }));
    expect(e.code).toBe('CONFLICT');
    expect(ok(await call('notes:get', { docId: hex(1) })).note.body).toBe('theirs');
    expect(events).toEqual([]);
    expect(reindexed).toEqual([]);
    // A new note while one exists is a conflict too.
    expect(fail(await call('notes:save', { docId: hex(1), body: 'x', expectedUpdatedAt: null })).code).toBe('CONFLICT');
  });

  it('removes the file for a blank body, and a blank body on nothing changes nothing', async () => {
    const call = await harness();
    const a = ok(await call('notes:save', { docId: hex(1), page: 3, body: 'to be removed', expectedUpdatedAt: null })).note;
    expect(await readdir(path.join(root, '.lab', 'notes', hex(1)))).toEqual(['p3.md']);
    expect(ok(await call('notes:save', { docId: hex(1), page: 3, body: ' \n\t ', expectedUpdatedAt: a.updatedAt })).note).toBeNull();
    expect(await readdir(path.join(root, '.lab', 'notes', hex(1)))).toEqual([]);
    expect(ok(await call('notes:get', { docId: hex(1), page: 3 })).note).toBeNull();
    events.length = 0;
    expect(ok(await call('notes:save', { docId: hex(1), page: 3, body: '', expectedUpdatedAt: null })).note).toBeNull();
    expect(events).toEqual([]);
  });

  it('reindexes the document and emits library:changed, so a word only in the note finds the document', async () => {
    const call = await harness();
    expect(await search('zorblax')).toEqual([]);
    const n = ok(await call('notes:save', { docId: hex(1), page: 4, body: 'the zorblax lemma', expectedUpdatedAt: null })).note;
    expect(reindexed).toEqual([[hex(1)]]);
    expect(events).toEqual([['library:changed', { kind: 'notes', ids: [hex(1)] }]]);
    expect(await search('zorblax')).toEqual([hex(1)]);
    ok(await call('notes:save', { docId: hex(1), page: 4, body: '', expectedUpdatedAt: n.updatedAt }));
    expect(await search('zorblax')).toEqual([]);
    expect(events).toHaveLength(2);
  });

  it('a failed index refresh does not fail the save', async () => {
    const call = await harness();
    failIndex = true;
    const n = ok(await call('notes:save', { docId: hex(1), body: 'kept', expectedUpdatedAt: null })).note;
    expect(n.body).toBe('kept');
    expect(events).toHaveLength(1);
  });

  it('two saves at once on the same note do not lose data', async () => {
    const call = await harness();
    const rs = await Promise.all([
      call('notes:save', { docId: hex(1), body: 'first', expectedUpdatedAt: null }),
      call('notes:save', { docId: hex(1), body: 'second', expectedUpdatedAt: null }),
    ]);
    // One wins, the other is told about the conflict; the file holds the winner whole.
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(fail(rs.find((r) => !r.ok)!).code).toBe('CONFLICT');
    const winner = rs.find((r) => r.ok) as Extract<IpcEnvelope, { ok: true }>;
    expect(ok(await call('notes:get', { docId: hex(1) })).note.body).toBe((winner.data as { note: { body: string } }).note.body);

    // Different notes of one document in parallel are all kept.
    await Promise.all([1, 2, 3, 4, 5].map((p) => call('notes:save', { docId: hex(1), page: p, body: `page ${p}`, expectedUpdatedAt: null })));
    expect(ok(await call('notes:list', { docId: hex(1) })).items).toHaveLength(6);
  });

  it('chained saves with the fresh updatedAt all go through, in order', async () => {
    const call = await harness();
    let at: string | null = null;
    for (let i = 0; i < 8; i++) at = ok(await call('notes:save', { docId: hex(1), body: `v${i}`, expectedUpdatedAt: at })).note.updatedAt;
    expect(ok(await call('notes:get', { docId: hex(1) })).note.body).toBe('v7');
  });

  it('refuses a body over the limit (schema)', async () => {
    const call = await harness();
    expect(fail(await call('notes:save', { docId: hex(1), body: 'x'.repeat(STUDY_LIMITS.noteBody + 1), expectedUpdatedAt: null })).code).toBe('INVALID_REQUEST');
  });

  it('plainExcerpt makes one short plain line', () => {
    expect(plainExcerpt('# T\n\n- item *one*\n> quote `code`\n```ts\nlet x\n```')).toBe('T item one quote code let x');
    expect(plainExcerpt('é'.repeat(500))).toHaveLength(STUDY_LIMITS.excerpt);
  });
});

const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.02 };
const ann = (over: Record<string, unknown> = {}) => ({ kind: 'highlight', page: 1, rects: [rect], text: 'important finding', ...over });

describe('annotations', () => {
  it('stores the geom marker on create and sets it on update without dropping it later', async () => {
    const call = await harness();
    const legacy = ok(await call('annotations:save', { docId: hex(1), annotation: ann() })).annotation;
    expect(legacy.geom).toBeUndefined();
    const fixed = ok(await call('annotations:save', { docId: hex(1), annotation: ann({ id: legacy.id, geom: 2 }) })).annotation;
    expect(fixed.geom).toBe(2);
    const recolored = ok(await call('annotations:save', { docId: hex(1), annotation: ann({ id: legacy.id, color: 'green' }) })).annotation;
    expect(recolored.geom, 'update keeps').toBe(2);
    const created = ok(await call('annotations:save', { docId: hex(1), annotation: ann({ geom: 2 }) })).annotation;
    expect(created.geom, 'create stores').toBe(2);
    expect(fail(await call('annotations:save', { docId: hex(1), annotation: ann({ geom: 1 }) })).code).toBe('INVALID_REQUEST');
  });

  it('clears the geom marker on update with null and ignores null on create', async () => {
    const call = await harness();
    const a = ok(await call('annotations:save', { docId: hex(1), annotation: ann({ geom: 2 }) })).annotation;
    const cleared = ok(await call('annotations:save', { docId: hex(1), annotation: ann({ id: a.id, geom: null }) })).annotation;
    expect('geom' in cleared).toBe(false);
    const listed = ok(await call('annotations:list', { docId: hex(1) })).annotations.find((x: { id: string }) => x.id === a.id);
    expect(listed && 'geom' in listed).toBe(false);
    const created = ok(await call('annotations:save', { docId: hex(1), annotation: ann({ geom: null }) })).annotation;
    expect('geom' in created).toBe(false);
  });

  it('creates, updates by id, lists and removes', async () => {
    const call = await harness();
    expect(ok(await call('annotations:list', { docId: hex(1) }))).toEqual({ annotations: [], stale: false, staleIds: [] });
    const a = ok(await call('annotations:save', { docId: hex(1), annotation: ann() })).annotation;
    expect(a).toMatchObject({ kind: 'highlight', page: 1, color: 'yellow', text: 'important finding' });
    expect(a.id).toMatch(/^[a-z0-9]/);
    expect(a.createdAt).toBe(a.updatedAt);
    const b = ok(await call('annotations:save', { docId: hex(1), annotation: ann({ kind: 'underline', page: 3 }) })).annotation;
    expect(b.id).not.toBe(a.id);

    await new Promise((r) => setTimeout(r, 5));
    const upd = ok(await call('annotations:save', { docId: hex(1), annotation: ann({ id: a.id, color: 'green', comment: 'check this' }) })).annotation;
    expect(upd).toMatchObject({ id: a.id, color: 'green', comment: 'check this', createdAt: a.createdAt });
    expect(upd.updatedAt).not.toBe(a.updatedAt);
    // An update without a comment drops it.
    expect(ok(await call('annotations:save', { docId: hex(1), annotation: ann({ id: a.id }) })).annotation.comment).toBeUndefined();

    const list = ok(await call('annotations:list', { docId: hex(1) })).annotations as Array<{ id: string }>;
    expect(list.map((x) => x.id)).toEqual([a.id, b.id]);
    expect(fail(await call('annotations:save', { docId: hex(1), annotation: ann({ id: 'does-not-exist' }) })).code).toBe('NOT_FOUND');
    expect(fail(await call('annotations:save', { docId: hex(99), annotation: ann() })).code).toBe('NOT_FOUND');

    expect(ok(await call('annotations:remove', { docId: hex(1), id: a.id })).removed).toBe(true);
    expect(ok(await call('annotations:remove', { docId: hex(1), id: a.id })).removed).toBe(false);
    expect((ok(await call('annotations:list', { docId: hex(1) })).annotations as unknown[]).length).toBe(1);
  });

  it('refuses colours and shapes outside the contract', async () => {
    const call = await harness();
    expect(fail(await call('annotations:save', { docId: hex(1), annotation: ann({ color: 'red; background:url(x)' }) })).code).toBe('INVALID_REQUEST');
    expect(fail(await call('annotations:save', { docId: hex(1), annotation: ann({ rects: [] }) })).code).toBe('INVALID_REQUEST');
  });

  it('stops at the per-document limit with the reason and the limit', async () => {
    const call = await harness();
    const rects = [rect];
    const base = { schemaVersion: 1, docId: hex(1), forHash: HASH, annotations: Array.from({ length: STUDY_LIMITS.annotationsPerDoc }, (_, i) => ({ id: `a${i}`, kind: 'highlight', page: 1, rects, text: '', color: 'yellow', createdAt: NOW, updatedAt: NOW })) };
    await store.annotations.put(base as never);
    const e = fail(await call('annotations:save', { docId: hex(1), annotation: ann() }));
    expect(e).toMatchObject({ code: 'INVALID_REQUEST', details: { reason: 'annotations-limit', limit: STUDY_LIMITS.annotationsPerDoc } });
    // Changing one that exists is still allowed.
    ok(await call('annotations:save', { docId: hex(1), annotation: ann({ id: 'a0', color: 'blue' }) }));
  });

  it('judges staleness per annotation: a new save does not hide the older misaligned ones (D-198)', async () => {
    const call = await harness();
    const NEW = 'cd'.repeat(32);
    const a = ok(await call('annotations:save', { docId: hex(1), annotation: ann() })).annotation;
    expect(a.forHash).toBe(HASH);
    expect(ok(await call('annotations:list', { docId: hex(1) }))).toMatchObject({ stale: false, staleIds: [] });
    await store.documents.update(hex(1) as DocumentId, (c) => ({ ...c!, hash: NEW }));
    expect(ok(await call('annotations:list', { docId: hex(1) }))).toMatchObject({ stale: true, staleIds: [a.id] });
    // A new annotation is made on the file as it is now; the old one stays flagged, and the file-level hash is kept.
    const b = ok(await call('annotations:save', { docId: hex(1), annotation: ann({ page: 2 }) })).annotation;
    expect(b.forHash).toBe(NEW);
    expect((await store.annotations.get(hex(1) as DocumentId))?.forHash).toBe(HASH);
    expect(ok(await call('annotations:list', { docId: hex(1) }))).toMatchObject({ stale: true, staleIds: [a.id] });
    // Re-confirming the old one (saving it again) stamps the current hash.
    ok(await call('annotations:save', { docId: hex(1), annotation: ann({ id: a.id }) }));
    expect(ok(await call('annotations:list', { docId: hex(1) }))).toMatchObject({ stale: false, staleIds: [] });
  });

  it('an old file without per-annotation hashes inherits the file-level one', async () => {
    const call = await harness();
    const old = { id: 'old1', kind: 'highlight', page: 1, rects: [rect], text: 'x', color: 'yellow', createdAt: NOW, updatedAt: NOW };
    await store.annotations.put({ schemaVersion: 1, docId: hex(1), forHash: 'ee'.repeat(32), annotations: [old] } as never);
    expect(ok(await call('annotations:list', { docId: hex(1) }))).toMatchObject({ stale: true, staleIds: ['old1'] });
    await store.annotations.put({ schemaVersion: 1, docId: hex(1), forHash: HASH, annotations: [old] } as never);
    expect(ok(await call('annotations:list', { docId: hex(1) }))).toMatchObject({ stale: false, staleIds: [] });
    // No hash anywhere (never recorded): nothing is claimed.
    await store.annotations.put({ schemaVersion: 1, docId: hex(1), annotations: [old] } as never);
    expect(ok(await call('annotations:list', { docId: hex(1) })).stale).toBe(false);
  });

  it('an update that names only the comment keeps the colour and the text (D-198)', async () => {
    const call = await harness();
    const a = ok(await call('annotations:save', { docId: hex(1), annotation: ann({ color: 'pink', text: 'kept text' }) })).annotation;
    const upd = ok(await call('annotations:save', { docId: hex(1), annotation: { id: a.id, kind: 'highlight', page: 1, rects: [rect], comment: 'only this' } })).annotation;
    expect(upd).toMatchObject({ color: 'pink', text: 'kept text', comment: 'only this' });
    const stored = (await store.annotations.get(hex(1) as DocumentId))!.annotations[0];
    expect(stored).toMatchObject({ color: 'pink', text: 'kept text' });
    // On create the missing fields take their defaults.
    const c = ok(await call('annotations:save', { docId: hex(1), annotation: { kind: 'underline', page: 2, rects: [rect] } })).annotation;
    expect(c).toMatchObject({ color: 'yellow', text: '' });
  });

  it('refuses a save that would make the file larger than the cap, and writes nothing (D-198)', async () => {
    const call = await harness();
    const text = 'x'.repeat(STUDY_LIMITS.annotationText);
    // Close to the cap (a few KB below it): annotations of about 10 KB each, written directly.
    const item = (i: number) => ({ id: `a${i}`, kind: 'highlight', page: 1, rects: [rect], text, color: 'yellow', createdAt: NOW, updatedAt: NOW });
    const each = Buffer.byteLength(JSON.stringify(item(0), null, 2)) + 100;
    const count = Math.floor((STUDY_LIMITS.annotationsFileBytes - 20_000) / each);
    const list = Array.from({ length: count }, (_, i) => item(i));
    await store.annotations.put({ schemaVersion: 1, docId: hex(1), forHash: HASH, annotations: list } as never);
    const file = path.join(root, '.lab', 'annotations', `${hex(1)}.json`);
    const before = await readFile(file);
    expect(before.length).toBeLessThan(STUDY_LIMITS.annotationsFileBytes);
    const bigRects = Array.from({ length: STUDY_LIMITS.rectsPerAnnotation }, () => rect);
    let refused = false;
    for (let i = 0; i < 6 && !refused; i++) {
      const r = await call('annotations:save', { docId: hex(1), annotation: ann({ text, rects: bigRects, comment: 'c'.repeat(STUDY_LIMITS.annotationComment) }) });
      if (!r.ok) {
        refused = true;
        expect(r.error).toMatchObject({ code: 'INVALID_REQUEST', details: { reason: 'annotations-size', limit: STUDY_LIMITS.annotationsFileBytes } });
      }
    }
    expect(refused).toBe(true);
    // The file on disk is valid, under the cap, and still readable and listable.
    const after = await readFile(file);
    expect(after.length).toBeLessThanOrEqual(STUDY_LIMITS.annotationsFileBytes);
    expect(after.length).toBeGreaterThan(before.length - 1);
    expect(ok(await call('annotations:list', { docId: hex(1) })).annotations.length).toBeGreaterThanOrEqual(count);
  });

  it('reindexes, emits library:changed and makes the annotated text searchable', async () => {
    const call = await harness();
    const a = ok(await call('annotations:save', { docId: hex(1), annotation: ann({ text: 'quasiparticle', comment: 'wibblefrotz' }) })).annotation;
    expect(reindexed.at(-1)).toEqual([hex(1)]);
    expect(events.filter(([e, p]) => e === 'library:changed' && (p as { kind: string }).kind === 'annotations')).toEqual([['library:changed', { kind: 'annotations', ids: [hex(1)] }]]);
    expect(await search('quasiparticle')).toEqual([hex(1)]);
    expect(await search('wibblefrotz')).toEqual([hex(1)]);
    events.length = 0;
    ok(await call('annotations:remove', { docId: hex(1), id: a.id }));
    expect(events.some(([e, p]) => e === 'library:changed' && (p as { kind: string }).kind === 'annotations')).toBe(true);
    expect(await search('quasiparticle')).toEqual([]);
    // Removing what is not there emits nothing.
    events.length = 0;
    ok(await call('annotations:remove', { docId: hex(1), id: 'nope' }));
    expect(events).toEqual([]);
  });

  it('keeps every annotation of parallel saves', async () => {
    const call = await harness();
    await Promise.all(Array.from({ length: 12 }, (_, i) => call('annotations:save', { docId: hex(1), annotation: ann({ page: i + 1 }) })));
    expect((ok(await call('annotations:list', { docId: hex(1) })).annotations as unknown[]).length).toBe(12);
  });
});

describe('underlined flag', () => {
  const flag = async () => (await store.documents.get(hex(1) as DocumentId))!.study.underlined;

  it('follows the annotations when its origin is annotations', async () => {
    const call = await harness();
    expect(await flag()).toEqual({ value: false, origin: 'manual' });
    const r1 = ok(await call('annotations:save', { docId: hex(1), annotation: ann() }));
    expect(r1.underlined).toEqual({ value: true, origin: 'annotations' });
    expect(await flag()).toEqual({ value: true, origin: 'annotations' });
    const r2 = ok(await call('annotations:save', { docId: hex(1), annotation: ann({ page: 2 }) }));
    expect(r2.underlined).toEqual({ value: true, origin: 'annotations' });
    ok(await call('annotations:remove', { docId: hex(1), id: r1.annotation.id }));
    expect(await flag()).toEqual({ value: true, origin: 'annotations' });
    const last = ok(await call('annotations:remove', { docId: hex(1), id: r2.annotation.id }));
    expect(last.underlined).toEqual({ value: false, origin: 'annotations' });
    expect(await flag()).toEqual({ value: false, origin: 'annotations' });
    // The flag lives in the document record: its changes announce the document as well (first save, last removal).
    expect(events.filter(([, p]) => (p as { kind: string }).kind === 'documents')).toHaveLength(2);
  });

  it('keeps a manual true, also through removals', async () => {
    const call = await harness();
    ok(await call('documents:update', { docId: hex(1), patch: { underlined: true } }));
    expect(await flag()).toEqual({ value: true, origin: 'manual' });
    const a = ok(await call('annotations:save', { docId: hex(1), annotation: ann() }));
    expect(a.underlined).toEqual({ value: true, origin: 'manual' });
    const r = ok(await call('annotations:remove', { docId: hex(1), id: a.annotation.id }));
    expect(r.underlined).toEqual({ value: true, origin: 'manual' });
  });

  it('turns a manual false into annotations true as soon as there is an annotation', async () => {
    const call = await harness();
    ok(await call('documents:update', { docId: hex(1), patch: { underlined: false } }));
    const a = ok(await call('annotations:save', { docId: hex(1), annotation: ann() }));
    expect(a.underlined).toEqual({ value: true, origin: 'annotations' });
    expect(ok(await call('annotations:remove', { docId: hex(1), id: a.annotation.id })).underlined).toEqual({ value: false, origin: 'annotations' });
  });

  it('documents:update with underlined sets origin manual', async () => {
    const call = await harness();
    const a = ok(await call('annotations:save', { docId: hex(1), annotation: ann() }));
    const u = ok(await call('documents:update', { docId: hex(1), patch: { underlined: false } }));
    expect(u.document.study.underlined).toEqual({ value: false, origin: 'manual' });
    expect(a.underlined.origin).toBe('annotations');
  });
});

describe('the original file', () => {
  it('is never written: bytes and the folder around it stay as they were, everything goes to the data folder', async () => {
    const call = await harness();
    const before = sha(await readFile(path.join(root, 'papers', 'f1.pdf')));
    const listing = (await readdir(path.join(root, 'papers'))).sort();
    ok(await call('reader:open', { docId: hex(1) }));
    const n = ok(await call('notes:save', { docId: hex(1), page: 1, body: 'note', expectedUpdatedAt: null })).note;
    const a = ok(await call('annotations:save', { docId: hex(1), annotation: ann() })).annotation;
    ok(await call('annotations:save', { docId: hex(1), annotation: ann({ id: a.id, color: 'pink' }) }));
    ok(await call('annotations:remove', { docId: hex(1), id: a.id }));
    ok(await call('notes:save', { docId: hex(1), page: 1, body: '', expectedUpdatedAt: n.updatedAt }));
    expect(sha(await readFile(path.join(root, 'papers', 'f1.pdf')))).toBe(before);
    expect((await readdir(path.join(root, 'papers'))).sort()).toEqual(listing);
    expect(await readdir(path.join(root, '.lab', 'annotations'))).toEqual([`${hex(1)}.json`]);
  });
});
