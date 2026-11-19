import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockAiProvider } from '@rl/ai';
import { AppError, channels, createDispatcher, createMemoryLogger, defaultLibraryConfig, documentRecordSchema, taxonomyFileSchema, type IpcEnvelope, type LibraryConfig } from '@rl/core';
import { createLibraryStore, createOrganizer, createTextExtractor, type FileLibraryStore } from '@rl/data';
import { writeSyntheticPdf } from '@rl/testkit';
import { buildHandlers, type MainServices } from '../ipc/handlers/index.js';
import { familyName, isValidCopyName, proposedFileName, safeSegment } from './names.js';
import { abortAllJobs } from '../ai/jobs.js';
import { whenInboxIdle } from './service.js';

const NOW = '2026-01-02T03:04:05.000Z';
const hex = (n: number) => n.toString(16).padStart(16, '0');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

let root: string;
let local: string;
let drop: string;
let store: FileLibraryStore;
let online: boolean;
let metadataFile: string | null;
let fetched: string[];
let scans: unknown[];
let picks: string[];
let readHashOverride: string | undefined;
let completeWrap: ((p: any) => (r: any) => Promise<any>) | null;
let failFetch: boolean;
let changed: Array<[string, unknown]>;

const OPENALEX = {
  doi: 'https://doi.org/10.1234/example.1',
  title: 'Learning to plan in robotics',
  publication_year: 2021,
  type: 'article',
  authorships: [{ author: { display_name: 'Ada Example' } }],
  primary_location: { source: { display_name: 'Journal of Tests' } },
  abstract_inverted_index: { Robots: [0], learn: [1], planning: [2] },
};

const config = (over: Partial<LibraryConfig> & { ai?: Partial<LibraryConfig['ai']> } = {}): LibraryConfig => {
  const base = defaultLibraryConfig();
  return { ...base, aiEnabledFolders: ['robots'], excludedFolders: ['skipped'], ...over, ai: { ...base.ai, confirmBeforeSend: false, ...over.ai } } as LibraryConfig;
};

const doc = (n: number, p: string, extra: Record<string, unknown> = {}) =>
  documentRecordSchema.parse({ id: hex(n), hash: sha(Buffer.from(`doc${n}`)), path: p, size: 1, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, ...extra });

function harness() {
  const log = createMemoryLogger();
  const cacheDir = path.join(local, 'text');
  const rt = {
    libraryId: 'lib-1',
    store,
    textCacheDir: cacheDir,
    organizer: createOrganizer({ store, deviceId: 'device-12345678' }),
    search: async (q: { text: string }) => {
      const words = q.text.split(' OR ').map((w) => w.toLowerCase());
      const recs = await store.documents.list();
      const hits = recs.filter((r) => words.some((w) => (r.title ?? '').toLowerCase().includes(w))).map((r) => ({ docId: r.id, path: r.path, directTags: r.tags, tags: r.tags, score: 1, field: 'title', snippet: '' }));
      return { total: hits.length, hits };
    },
    reindexDocuments: async () => {},
    startScan: (o: unknown) => void scans.push(o),
    extractFile: async (rootPath: string, file: string, hash: string) => {
      const t = await createTextExtractor({ cacheDir }).extract(rootPath, file, { hash });
      return { path: file, hash, ok: true, cached: false, meta: t.meta, ...(readHashOverride ? { readHash: readHashOverride } : {}) };
    },
  };
  const services = {
    log,
    localDataDir: local,
    emit: (e: string, p: unknown) => changed.push([e, p]),
    runtime: { sync: async () => {}, hold: () => () => {}, status: () => ({}), require: async () => rt },
    libraries: { profile: async () => ({ rootPath: root, id: 'lib-1' }), dataDir: async () => store.dataDir },
    settings: { get: async () => ({ deviceId: 'device-12345678', ai: { claudeCodePath: null, tokenCap: { monthlyTokens: null, warnAtPct: 80 } } }) },
    secrets: { get: async () => null },
    aiProvider: (cfg: { models: any }) => {
      const p: any = createMockAiProvider({ models: cfg.models });
      return completeWrap ? Object.assign({ ...p }, { completeStructured: completeWrap(p), access: () => p.access(), isAvailable: () => p.isAvailable() }) : p;
    },
    isOnline: () => online,
    fetch: (async (url: string) => {
      fetched.push(url);
      if (failFetch) throw new TypeError('fetch failed');
      return new Response(JSON.stringify(OPENALEX), { status: 200 });
    }) as unknown as typeof fetch,
    get metadataFile() {
      return metadataFile;
    },
    pickPdfFiles: async () => picks,
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
const pdf = async (name: string, over: Partial<Parameters<typeof writeSyntheticPdf>[1]> = {}) => {
  const file = path.join(drop, name);
  await writeSyntheticPdf(file, { title: 'Learning to plan in robotics', authors: ['Ada Example'], year: 2021, body: 'Robots learn planning from data.', doi: '10.1234/example.1', ...over });
  return file;
};
const treeOf = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.name === '.lab') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.push(path.relative(dir, p));
    }
  };
  await walk(dir);
  return out.sort();
};

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rl-inb-'));
  local = await mkdtemp(path.join(os.tmpdir(), 'rl-inb-local-'));
  drop = await mkdtemp(path.join(os.tmpdir(), 'rl-inb-drop-'));
  store = createLibraryStore({ rootPath: root, deviceId: 'device-12345678' });
  await store.init();
  await store.writeConfig(config());
  await store.writeTaxonomy(taxonomyFileSchema.parse({ nodes: [{ id: 'robotics', label: 'Robotics' }, { id: 'vision', label: 'Vision' }, { id: 'old', label: 'Old', status: 'deprecated' }] }));
  for (const d of ['robots', 'vision', 'skipped', 'misc']) await mkdir(path.join(root, d));
  await store.documents.put(doc(1, 'robots/a.pdf', { title: 'Planning for robotics arms', tags: ['robotics'] }));
  await store.documents.put(doc(2, 'robots/b.pdf', { title: 'Robotics grasping', tags: ['robotics'] }));
  await store.documents.put(doc(3, 'vision/c.pdf', { title: 'Vision of robotics', tags: ['vision', 'robotics'] }));
  online = true;
  metadataFile = null;
  fetched = [];
  scans = [];
  picks = [];
  changed = [];
  readHashOverride = undefined;
  failFetch = false;
  completeWrap = null;
});
afterEach(async () => {
  await whenInboxIdle();
  for (const d of [root, local, drop]) await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('names', () => {
  it('builds a Windows-safe name from author, year and title, with fallbacks and a cap', () => {
    expect(familyName('Ada Example')).toBe('Example');
    expect(familyName('Example, Ada')).toBe('Example');
    expect(proposedFileName({ title: 'Plans: a/b?', authors: ['Ada Example'], year: 2021 }, 'x.pdf')).toBe('Example 2021 - Plans a b.pdf');
    expect(proposedFileName({ title: 'T', authors: [], year: null }, 'orig.pdf')).toBe('T.pdf');
    expect(proposedFileName({ title: null }, 'orig.pdf')).toBe('orig.pdf');
    expect(proposedFileName({ title: 'x'.repeat(500), authors: ['A B'], year: 2020 }, 'o.pdf').length).toBeLessThanOrEqual(180);
    expect(safeSegment('con', 50)).toBe('_con');
    expect(safeSegment('name. ', 50)).toBe('name');
    expect(isValidCopyName('ok name.pdf')).toBe(true);
    for (const bad of ['a/b.pdf', 'a\\b.pdf', 'con.pdf', 'x.txt', 'a:b.pdf', '.hidden.pdf', 'ends .pdf.']) expect(isValidCopyName(bad)).toBe(false);
  });
});

describe('inbox:add', () => {
  it('reads the identifiers, looks the work up online and never exposes the path', async () => {
    const call = harness();
    const file = await pdf('paper.pdf');
    const r = ok(await call('inbox:add', { paths: [file] }));
    expect(r.refused).toEqual([]);
    const item = r.added[0];
    expect(item).toMatchObject({ kind: 'dropped', fileName: 'paper.pdf', detected: { doi: '10.1234/example.1', year: 2021 }, lookup: { state: 'pending' } });
    expect(item.id).toBe(sha(await readFile(file)).slice(0, 16));
    await whenInboxIdle();
    const l = ok(await call('inbox:list')).items[0];
    expect(l.lookup).toMatchObject({ state: 'found', source: 'openalex' });
    expect(l.metadata).toMatchObject({ title: 'Learning to plan in robotics', authors: ['Ada Example'], year: 2021, venue: 'Journal of Tests', abstract: 'Robots learn planning', publication: 'published' });
    expect(fetched).toEqual(['https://api.openalex.org/works/doi:10.1234/example.1']);
    expect(JSON.stringify(l)).not.toContain(drop.replace(/\\/g, '\\\\'));
    expect(JSON.stringify(l)).not.toContain(path.basename(drop));
    expect(changed.some(([e]) => e === 'inbox:changed')).toBe(true);
  });

  it('refuses what is not a regular PDF, a relative path, a file of the library, and a file already queued', async () => {
    const call = harness();
    const txt = path.join(drop, 'note.pdf');
    await writeFile(txt, 'just text, not a pdf');
    const inLib = path.join(root, 'misc', 'x.pdf');
    await writeSyntheticPdf(inLib, { title: 'In library', authors: ['A B'], year: 2020, body: 'x' });
    const good = await pdf('good.pdf');
    const r = ok(await call('inbox:add', { paths: [txt, 'relative/file.pdf', path.join(drop, 'missing.pdf'), drop, inLib, good, good] }));
    expect(r.refused.map((x: any) => [x.name, x.reason])).toEqual([
      ['note.pdf', 'not-pdf'],
      ['file.pdf', 'not-found'],
      ['missing.pdf', 'not-found'],
      [path.basename(drop), 'not-pdf'],
      ['x.pdf', 'in-library'],
      ['good.pdf', 'already-queued'],
    ]);
    expect(r.added).toHaveLength(1);
  });

  it('offline: the lookup says offline; the test hook replaces the network', async () => {
    const call = harness();
    online = false;
    ok(await call('inbox:add', { paths: [await pdf('a.pdf')] }));
    await whenInboxIdle();
    const it1 = ok(await call('inbox:list')).items[0];
    expect(it1.lookup.state).toBe('offline');
    expect(fetched).toEqual([]);
    metadataFile = path.join(local, 'meta.json');
    const rec = { title: 'From the hook', authors: ['Zed Hook'], year: 2022, venue: null, doi: '10.1234/example.1', arxivId: null, abstract: null, publication: 'preprint' };
    await writeFile(metadataFile, JSON.stringify({ 'doi:10.1234/example.1': rec }));
    const again = ok(await call('inbox:lookup', { id: it1.id }));
    expect(again.lookup).toMatchObject({ state: 'found', source: 'openalex' });
    expect(again.metadata.title).toBe('From the hook');
    expect(fetched).toEqual([]);
    await writeFile(metadataFile, '{}');
    expect(ok(await call('inbox:lookup', { id: it1.id })).lookup.state).toBe('not-found');
  });

  it('skips the lookup when the file has no identifier, and the chosen files go through the same checks', async () => {
    const call = harness();
    picks = [await pdf('plain.pdf', { doi: undefined, title: 'Something unrelated entirely' })];
    const r = ok(await call('inbox:choose'));
    expect(r.added).toHaveLength(1);
    expect(r.added[0].lookup.state).toBe('skipped');
    picks = [];
    expect(ok(await call('inbox:choose'))).toEqual({ added: [], refused: [] });
  });
});

describe('duplicates and proposals', () => {
  it('recognises the same file, the same work and versions', async () => {
    const call = harness();
    // same file: a record with the very hash of the file
    const f1 = await pdf('same.pdf', { title: 'Same file', doi: undefined });
    await store.documents.put(doc(10, 'misc/same-copy.pdf', { hash: sha(await readFile(f1)), title: 'Held copy' }));
    // same work: same DOI
    const f2 = await pdf('work.pdf', { title: 'Another print', doi: '10.9999/shared.doi' });
    await store.documents.put(doc(11, 'misc/w.pdf', { doi: '10.9999/SHARED.DOI', title: 'Shared work' }));
    // version: same arXiv id, other version
    const f3 = await pdf('ver.pdf', { title: 'Versioned', doi: undefined, arxivId: '2401.01234v2' });
    await store.documents.put(doc(12, 'misc/v.pdf', { arxivId: '2401.01234v1', title: 'Versioned v1' }));
    // version: same title and first author, other content
    const f4 = await pdf('tit.pdf', { title: 'Twin title', authors: ['Ada Example'], doi: undefined });
    await store.documents.put(doc(13, 'misc/t.pdf', { title: 'Twin title', authors: ['Example, Ada'] }));
    const f5 = await pdf('fresh.pdf', { title: 'Totally new subject', doi: undefined });
    const r = ok(await call('inbox:add', { paths: [f1, f2, f3, f4, f5] }));
    await whenInboxIdle();
    const items = new Map<string, any>(ok(await call('inbox:list')).items.map((i: any) => [i.fileName, i]));
    expect(items.get('same.pdf').duplicate).toMatchObject({ kind: 'same-file', docId: hex(10), path: 'misc/same-copy.pdf' });
    expect(items.get('work.pdf').duplicate).toMatchObject({ kind: 'same-work', docId: hex(11) });
    expect(items.get('ver.pdf').duplicate).toMatchObject({ kind: 'version', docId: hex(12) });
    expect(items.get('tit.pdf').duplicate).toMatchObject({ kind: 'version', docId: hex(13) });
    expect(items.get('fresh.pdf').duplicate).toBeNull();
    expect(r.added).toHaveLength(5);
  });

  it('identity (G4b): the unannotated version of an annotated document is a duplicate; a conflict copy of it is recognised', async () => {
    const call = harness();
    // The document was annotated by us: its content before the append is `base`, the file on disk is `base` plus a revision.
    const f1 = await pdf('plain.pdf', { title: 'Annotated one', doi: undefined });
    const baseBytes = await readFile(f1);
    const grown = Buffer.concat([baseBytes, Buffer.from('\n% appended revision\n')]);
    await writeFile(path.join(root, 'misc', 'annotated.pdf'), grown);
    const pdfWrite = { base: { hash: sha(baseBytes), size: baseBytes.length }, own: [{ hash: sha(grown), size: grown.length, at: NOW }] };
    await store.documents.put(doc(40, 'misc/annotated.pdf', { hash: sha(grown), size: grown.length, title: 'Annotated one', pdfWrite }));
    // Dropping the unannotated version: same file.
    ok(await call('inbox:add', { paths: [f1] }));
    await whenInboxIdle();
    expect(ok(await call('inbox:list')).items.find((i: any) => i.fileName === 'plain.pdf').duplicate).toMatchObject({ kind: 'same-file', docId: hex(40) });
    // A copy made by a sync conflict: same prefix, other tail, a name that contains the document's name; flagged as new by the scan.
    const other = Buffer.concat([baseBytes, Buffer.from('\n% revision written on another computer\n')]);
    await writeFile(path.join(root, 'misc', 'annotated (conflicted copy).pdf'), other);
    await store.documents.put(doc(41, 'misc/annotated (conflicted copy).pdf', { hash: sha(other), size: other.length, inbox: { since: NOW, reason: 'new' } }));
    const item = ok(await call('inbox:list')).items.find((i: any) => i.id === hex(41));
    expect(item.conflictOf).toEqual({ docId: hex(40), title: 'Annotated one' });
    // An unrelated new file with a similar name but another prefix is not a conflict copy.
    await writeFile(path.join(root, 'misc', 'annotated (2).pdf'), Buffer.from('something else entirely, longer than the base file bytes at all, yes'.repeat(20)));
    await store.documents.put(doc(42, 'misc/annotated (2).pdf', { size: 1300, inbox: { since: NOW, reason: 'new' } }));
    expect(ok(await call('inbox:list')).items.find((i: any) => i.id === hex(42)).conflictOf).toBeUndefined();
  });

  it('proposes a name, tags of similar documents and the folder that holds most of them', async () => {
    const call = harness();
    metadataFile = path.join(local, 'meta.json');
    await writeFile(metadataFile, '{}');
    ok(await call('inbox:add', { paths: [await pdf('x.pdf', { title: 'Planning robotics manipulation', doi: undefined })] }));
    await whenInboxIdle();
    const p = ok(await call('inbox:list')).items[0].proposal;
    expect(p.name).toBe('Example 2021 - Planning robotics manipulation.pdf');
    expect(p.tagsFrom).toBe('similar');
    expect(p.tagIds).toEqual(['robotics']);
    expect(p.folder).toBe('robots');
    expect(p.newTags).toEqual([]);
  });

  it('falls back to the original name and the root without any similar document', async () => {
    const call = harness();
    ok(await call('inbox:add', { paths: [await pdf('odd name.pdf', { title: 'Zzzz qqqq', doi: undefined })] }));
    await whenInboxIdle();
    const it1 = ok(await call('inbox:list')).items[0];
    expect(it1.proposal).toMatchObject({ folder: '', tagsFrom: 'none', tagIds: [] });
  });
});

describe('AI tags for an item', () => {
  it('refuses a folder that is not enabled, before reading anything, and sends nothing', async () => {
    const call = harness();
    ok(await call('inbox:add', { paths: [await pdf('a.pdf')] }));
    await whenInboxIdle();
    const id = ok(await call('inbox:list')).items[0].id;
    expect(fail(await call('inbox:previewTags', { id, model: 'claude-haiku-5-5', folder: 'vision' })).code).toBe('FOLDER_NOT_AI_ENABLED');
    expect(fail(await call('inbox:proposeTags', { id, model: 'claude-haiku-5-5', reasoning: 'low', folder: 'vision' })).code).toBe('FOLDER_NOT_AI_ENABLED');
    expect(await store.readLog({ type: 'ai-send' })).toHaveLength(0);
  });

  it('previews, asks for confirmation, then fills the proposal and logs the send', async () => {
    await store.writeConfig(config({ ai: { confirmBeforeSend: true } as never }));
    const call = harness();
    ok(await call('inbox:add', { paths: [await pdf('a.pdf')] }));
    await whenInboxIdle();
    const item = ok(await call('inbox:list')).items[0];
    const prev = ok(await call('inbox:previewTags', { id: item.id, model: 'claude-haiku-5-5', folder: 'robots' }));
    expect(prev).toMatchObject({ allowed: [item.id], folders: ['robots'], needsConfirmation: true, overCap: false });
    const req = { id: item.id, model: 'claude-haiku-5-5', reasoning: 'low', folder: 'robots' };
    expect(fail(await call('inbox:proposeTags', req)).details).toMatchObject({ reason: 'needs-confirmation' });
    const done = ok(await call('inbox:proposeTags', { ...req, confirmed: true }));
    expect(done.proposal).toMatchObject({ tagsFrom: 'ai', tagIds: ['robotics'] });
    const log = (await store.readLog({ type: 'ai-send' })) as any[];
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ purpose: 'inbox:tags', docIds: [item.id], folders: ['robots'], confirmed: true });
  });

  it('uses the online record (title, authors, abstract) when it was found; same caps as the chat', async () => {
    const call = harness();
    ok(await call('inbox:add', { paths: [await pdf('a.pdf')] }));
    await whenInboxIdle();
    const id = ok(await call('inbox:list')).items[0].id;
    await store.appendLog({ type: 'ai-send', at: new Date().toISOString(), deviceId: 'd', provider: 'mock', model: 'claude-haiku-5-5', purpose: 'chat', docIds: [], folders: [], approxInputTokens: 1, estimatedCostUsd: 9, confirmed: true });
    await store.writeConfig(config({ ai: { usageCap: { monthlyUsd: 1, confirmBatchAboveUsd: 5 } } as never }));
    expect(fail(await call('inbox:proposeTags', { id, model: 'claude-haiku-5-5', reasoning: 'low', folder: 'robots' })).code).toBe('AI_BUDGET_EXCEEDED');
    await store.writeConfig(config());
    expect(fail(await call('inbox:proposeTags', { id, model: 'nope', reasoning: 'low', folder: 'robots' })).code).toBe('INVALID_REQUEST');
  });
});

describe('inbox:confirm (dropped)', () => {
  it('copies the file exclusively, verifies it, indexes it, applies metadata and tags as ONE change, keeps the original', async () => {
    const call = harness();
    const file = await pdf('orig name.pdf');
    const before = await readFile(file);
    const mtime = (await stat(file)).mtimeMs;
    ok(await call('inbox:add', { paths: [file] }));
    await whenInboxIdle();
    const item = ok(await call('inbox:list')).items[0];
    await call('inbox:proposeTags', { id: item.id, model: 'claude-haiku-5-5', reasoning: 'low', folder: 'robots', confirmed: true });
    const r = ok(
      await call('inbox:confirm', {
        id: item.id,
        name: 'Example 2021 - Learning.pdf',
        folder: 'robots',
        tagIds: ['robotics', 'vision'],
        newTags: [],
        metadata: { title: 'Learning to plan', authors: ['Ada Example'], year: 2021, venue: 'Journal of Tests', doi: 'https://doi.org/10.1234/Example.1' },
      }),
    );
    expect(r).toMatchObject({ docId: item.id, path: 'robots/Example 2021 - Learning.pdf' });
    expect(r.changeId).toBeTruthy();
    // the copy exists and equals the original; the original is untouched
    const copy = await readFile(path.join(root, 'robots', 'Example 2021 - Learning.pdf'));
    expect(sha(copy)).toBe(sha(before));
    expect(sha(await readFile(file))).toBe(sha(before));
    expect((await stat(file)).mtimeMs).toBe(mtime);
    // the record is there, known (no inbox flag), with the user's fields and tags
    const rec = (await store.documents.get(item.id))!;
    expect(rec).toMatchObject({ path: 'robots/Example 2021 - Learning.pdf', title: 'Learning to plan', authors: ['Ada Example'], year: 2021, doi: '10.1234/example.1', hash: sha(before) });
    expect(rec.ref.venue).toBe('Journal of Tests');
    expect(rec.tags).toEqual(['robotics', 'vision']);
    expect(rec.inbox).toBeUndefined();
    // the AI proposal is recorded as reviewed: robotics kept, the proposal was ['robotics'] -> accepted
    expect(rec.ai.suggestedTags).toMatchObject({ value: ['robotics'], review: { status: 'accepted' }, meta: { source: 'inbox:tags' } });
    expect(scans).toEqual([{ paths: ['robots/Example 2021 - Learning.pdf'] }]);
    expect(ok(await call('inbox:list')).items).toEqual([]);
    // one logged change: undo reverts tags and fields (the file and the record stay)
    ok(await call('history:undo', { changeId: r.changeId }));
    const undone = (await store.documents.get(item.id))!;
    expect(undone.tags).toEqual([]);
    expect(undone.title).toBeNull();
    expect(undone.ai.suggestedTags).toBeUndefined();
    expect(await treeOf(root)).toContain(path.join('robots', 'Example 2021 - Learning.pdf'));
  });

  it('never overwrites: CONFLICT exists, and the existing file is untouched', async () => {
    const call = harness();
    await writeFile(path.join(root, 'robots', 'taken.pdf'), 'precious');
    ok(await call('inbox:add', { paths: [await pdf('p.pdf')] }));
    const id = ok(await call('inbox:list')).items[0].id;
    const e = fail(await call('inbox:confirm', { id, name: 'taken.pdf', folder: 'robots' }));
    expect(e).toMatchObject({ code: 'CONFLICT', details: { conflict: 'exists' } });
    expect(await readFile(path.join(root, 'robots', 'taken.pdf'), 'utf8')).toBe('precious');
    expect(await store.documents.get(id)).toBeNull();
    expect(ok(await call('inbox:list')).items).toHaveLength(1);
  });

  it('refuses a missing, excluded or data folder, a bad name, an unknown tag; nothing is copied', async () => {
    const call = harness();
    ok(await call('inbox:add', { paths: [await pdf('p.pdf')] }));
    const id = ok(await call('inbox:list')).items[0].id;
    const before = await treeOf(root);
    expect(fail(await call('inbox:confirm', { id, folder: 'nope' })).code).toBe('NOT_FOUND');
    expect(fail(await call('inbox:confirm', { id, folder: 'skipped' })).details).toMatchObject({ reason: 'excluded' });
    expect(fail(await call('inbox:confirm', { id, folder: '.lab' })).code).toMatch(/INVALID|NOT_FOUND|PATH/);
    expect(fail(await call('inbox:confirm', { id, name: '../evil.pdf', folder: 'robots' })).code).toBe('INVALID_REQUEST');
    expect(fail(await call('inbox:confirm', { id, name: 'a.txt', folder: 'robots' })).code).toBe('INVALID_REQUEST');
    expect(fail(await call('inbox:confirm', { id, folder: 'robots', tagIds: ['zzz'] })).code).toBe('NOT_FOUND');
    expect(fail(await call('inbox:confirm', { id, folder: 'robots', tagIds: ['old'] })).code).toBe('INVALID_REQUEST');
    expect(await treeOf(root)).toEqual(before);
  });

  it('deletes only the file it just created when the copy does not match the original', async () => {
    const call = harness();
    const file = await pdf('p.pdf');
    ok(await call('inbox:add', { paths: [file] }));
    const id = ok(await call('inbox:list')).items[0].id;
    // the original changes after it was added: the copy cannot match the hash taken earlier
    await writeFile(file, Buffer.concat([await readFile(file), Buffer.from('\n% appended')]));
    const before = await treeOf(root);
    const e = fail(await call('inbox:confirm', { id, name: 'copy.pdf', folder: 'robots' }));
    expect(e).toMatchObject({ code: 'IO_ERROR', details: { reason: 'hash-mismatch' } });
    expect(await treeOf(root)).toEqual(before);
    expect(await store.documents.get(id)).toBeNull();
  });

  it('refuses the same file, and a same-work duplicate unless allowed', async () => {
    const call = harness();
    const f1 = await pdf('s.pdf', { title: 'Same one', doi: undefined });
    await store.documents.put(doc(20, 'misc/held.pdf', { hash: sha(await readFile(f1)) }));
    const f2 = await pdf('w.pdf', { title: 'Other print', doi: '10.9999/dup' });
    await store.documents.put(doc(21, 'misc/dup.pdf', { doi: '10.9999/dup' }));
    ok(await call('inbox:add', { paths: [f1, f2] }));
    const items = new Map<string, any>(ok(await call('inbox:list')).items.map((i: any) => [i.fileName, i]));
    expect(fail(await call('inbox:confirm', { id: items.get('s.pdf').id, allowDuplicate: true, folder: 'misc' })).details).toMatchObject({ conflict: 'duplicate', kind: 'same-file' });
    expect(fail(await call('inbox:confirm', { id: items.get('w.pdf').id, folder: 'misc' })).details).toMatchObject({ conflict: 'duplicate', kind: 'same-work' });
    const r = ok(await call('inbox:confirm', { id: items.get('w.pdf').id, folder: 'misc', name: 'second print.pdf', allowDuplicate: true }));
    expect(r.path).toBe('misc/second print.pdf');
  });

  it('creates the accepted new tags as taxonomy nodes of origin ai, in the same change', async () => {
    const call = harness();
    ok(await call('inbox:add', { paths: [await pdf('p.pdf')] }));
    const id = ok(await call('inbox:list')).items[0].id;
    const r = ok(await call('inbox:confirm', { id, folder: 'robots', name: 'n.pdf', tagIds: ['robotics'], newTags: [{ label: 'Soft grippers', parentId: 'robotics', aliases: ['SG'] }], metadata: {} }));
    const tax = await store.readTaxonomy();
    const node = tax.nodes.find((n) => n.label === 'Soft grippers')!;
    expect(node).toMatchObject({ origin: 'ai', status: 'active', parents: ['robotics'] });
    expect((await store.documents.get(id))!.tags).toEqual(['robotics', node.id]);
    ok(await call('history:undo', { changeId: r.changeId }));
    expect((await store.readTaxonomy()).nodes.some((n) => n.label === 'Soft grippers')).toBe(false);
    expect((await store.documents.get(id))!.tags).toEqual([]);
  });

  it('dismiss forgets a dropped item and leaves the original alone', async () => {
    const call = harness();
    const file = await pdf('p.pdf');
    ok(await call('inbox:add', { paths: [file] }));
    const id = ok(await call('inbox:list')).items[0].id;
    expect(ok(await call('inbox:dismiss', { id }))).toEqual({ ok: true });
    expect(ok(await call('inbox:list')).items).toEqual([]);
    expect((await readFile(file)).length).toBeGreaterThan(100);
    expect(fail(await call('inbox:dismiss', { id })).code).toBe('NOT_FOUND');
  });
});

describe('library items', () => {
  const flag = (n: number, p: string, extra: Record<string, unknown> = {}) => doc(n, p, { inbox: { since: NOW, reason: 'new' }, ...extra });

  it('lists the files the scan flagged, looks them up once, and confirms them without any file operation', async () => {
    await writeFile(path.join(root, 'misc', 'found.pdf'), 'x');
    await store.documents.put(flag(30, 'misc/found.pdf', { doi: '10.1234/example.1', title: 'Found file' }));
    const call = harness();
    const first = ok(await call('inbox:list')).items;
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ id: hex(30), kind: 'library', path: 'misc/found.pdf', fileName: 'found.pdf', lookup: { state: 'pending' } });
    expect(first[0].proposal.name).toBeUndefined();
    await whenInboxIdle();
    const second = ok(await call('inbox:list')).items[0];
    expect(second.lookup.state).toBe('found');
    expect(second.metadata.title).toBe('Learning to plan in robotics');
    ok(await call('inbox:list'));
    await whenInboxIdle();
    expect(fetched).toHaveLength(1);
    const before = await treeOf(root);
    const r = ok(await call('inbox:confirm', { id: hex(30), name: 'ignored.pdf', folder: 'vision', tagIds: ['vision'], metadata: { title: 'Confirmed title', year: 2020 } }));
    expect(r).toMatchObject({ docId: hex(30), path: 'misc/found.pdf' });
    expect(await treeOf(root)).toEqual(before);
    const rec = (await store.documents.get(hex(30) as never))!;
    expect(rec).toMatchObject({ title: 'Confirmed title', year: 2020, tags: ['vision'], path: 'misc/found.pdf' });
    expect(rec.inbox).toBeUndefined();
    expect(scans).toEqual([]);
    expect(ok(await call('inbox:list')).items).toEqual([]);
  });

  it('dismiss clears the flag only; a same-work duplicate is reported', async () => {
    await store.documents.put(flag(31, 'misc/one.pdf', { doi: '10.7/dup', title: 'One' }));
    await store.documents.put(doc(32, 'misc/two.pdf', { doi: '10.7/dup', title: 'Two' }));
    const call = harness();
    const item = ok(await call('inbox:list')).items[0];
    expect(item.duplicate).toMatchObject({ kind: 'same-work', docId: hex(32) });
    ok(await call('inbox:dismiss', { id: hex(31) }));
    const rec = (await store.documents.get(hex(31) as never))!;
    expect(rec.inbox).toBeUndefined();
    expect(rec.path).toBe('misc/one.pdf');
    expect(ok(await call('inbox:list')).items).toEqual([]);
  });

  it('AI tags need an enabled folder (the folder of the file)', async () => {
    await store.documents.put(flag(33, 'misc/ai.pdf', { title: 'Robotics note' }));
    await store.documents.put(flag(34, 'robots/ai2.pdf', { title: 'Robotics note two' }));
    const call = harness();
    expect(fail(await call('inbox:previewTags', { id: hex(33), model: 'claude-haiku-5-5' })).code).toBe('FOLDER_NOT_AI_ENABLED');
    expect(ok(await call('inbox:proposeTags', { id: hex(34), model: 'claude-haiku-5-5', reasoning: 'low' })).proposal.tagsFrom).toBe('ai');
  });
});

describe('inbox security and robustness (review fixes)', () => {
  const BS = String.fromCharCode(92);
  const confirmReq = (id: string, over: Record<string, unknown> = {}) => ({ id, name: 'Moved.pdf', folder: 'robots', tagIds: [], newTags: [], metadata: {}, ...over });
  const queued = async (call: ReturnType<typeof harness>, name = 'a.pdf') => {
    ok(await call('inbox:add', { paths: [await pdf(name)] }));
    await whenInboxIdle();
    return ok(await call('inbox:list')).items[0].id as string;
  };

  it('inbox:add refuses network and device paths without touching them, and a non-.pdf name; the dialog paths stay accepted', async () => {
    const call = harness();
    const unc = [`${BS}${BS}host${BS}share${BS}a.pdf`, `${BS}${BS}?${BS}UNC${BS}host${BS}share${BS}a.pdf`, `${BS}${BS}.${BS}pipe${BS}a.pdf`, '//host/share/a.pdf'];
    const r = ok(await call('inbox:add', { paths: [...unc, path.join(drop, 'note.txt')] }));
    expect(r.added).toEqual([]);
    expect(r.refused).toHaveLength(5);
    expect(r.refused.slice(0, 4).every((x: any) => x.reason === 'not-found')).toBe(true);
    expect(r.refused[4].reason).toBe('not-pdf');
    // A PDF chosen in the dialog (trusted) is accepted even when its extension is odd.
    const odd = path.join(drop, 'paper.PDFX');
    await writeSyntheticPdf(odd, { title: 'Upper', authors: ['A B'], year: 2020, body: 'x' });
    picks = [odd];
    expect(ok(await call('inbox:choose')).added).toHaveLength(1);
  });

  it('refuses a file that changed between the hash and the extraction (the worker read other bytes)', async () => {
    const call = harness();
    readHashOverride = 'f'.repeat(64);
    const r = ok(await call('inbox:add', { paths: [await pdf('swap.pdf')] }));
    expect(r.added).toEqual([]);
    expect(r.refused).toEqual([{ name: 'swap.pdf', reason: 'not-found' }]);
  });

  it('confirm: every variant of an excluded or data folder is refused and nothing is copied', async () => {
    const call = harness();
    const id = await queued(call);
    for (const folder of ['skipped', 'skipped/.', './skipped', 'skipped//', 'skipped/./']) {
      expect(fail(await call('inbox:confirm', confirmReq(id, { folder }))).details).toMatchObject({ reason: 'excluded' });
    }
    // Case variants name the same folder on a case-insensitive file system (Windows).
    if (process.platform === 'win32') for (const folder of ['Skipped', 'SKIPPED']) expect(fail(await call('inbox:confirm', confirmReq(id, { folder }))).details).toMatchObject({ reason: 'excluded' });
    for (const folder of ['.lab', '.lab/.', './.lab']) expect(['INVALID_REQUEST', 'NOT_FOUND']).toContain(fail(await call('inbox:confirm', confirmReq(id, { folder }))).code);
    expect(await treeOf(root)).toEqual([]);
    expect(await readdir(path.join(root, 'skipped'))).toEqual([]);
    expect(ok(await call('inbox:list')).items).toHaveLength(1);
  });

  it('confirm: the stored path is the normalised one, so it matches what the scanner would record', async () => {
    const call = harness();
    const id = await queued(call);
    const r = ok(await call('inbox:confirm', confirmReq(id, { folder: './robots//' })));
    expect(r.path).toBe('robots/Moved.pdf');
    expect((await store.documents.get(id as never))!.path).toBe('robots/Moved.pdf');
  });

  it('confirm failure after the copy removes the copy, the record and new nodes, so a retry works', async () => {
    const call = harness();
    const id = await queued(call);
    let failNext = true;
    const origWithChange = store.withChange.bind(store);
    (store as any).withChange = (ctx: never) => {
      const cs = origWithChange(ctx);
      const upd = cs.documents.update.bind(cs.documents);
      (cs.documents as any).update = async (...a: [never, never]) => {
        if (failNext) {
          failNext = false;
          throw new Error('disk hiccup');
        }
        return upd(...a);
      };
      return cs;
    };
    const e = fail(await call('inbox:confirm', confirmReq(id, { newTags: [{ label: 'Brand new', parentId: null, aliases: [], reason: 'x' }] })));
    expect(e.code).not.toBe('CONFLICT');
    expect(await treeOf(root)).toEqual([]);
    expect(await store.documents.get(id as never)).toBeNull();
    expect((await store.readTaxonomy()).nodes.map((n) => n.label)).not.toContain('Brand new');
    expect(ok(await call('inbox:list')).items).toHaveLength(1);
    const again = ok(await call('inbox:confirm', confirmReq(id)));
    expect(again.path).toBe('robots/Moved.pdf');
    expect(await treeOf(root)).toEqual([path.join('robots', 'Moved.pdf')]);
  });

  it('count: no document read, no network, no lookup; the badge counts the queue and the remembered flagged files', async () => {
    const call = harness();
    ok(await call('inbox:add', { paths: [await pdf('a.pdf')] }));
    await whenInboxIdle();
    await store.documents.put(doc(9, 'misc/new.pdf', { doi: '10.1001/zzz', inbox: { since: NOW, reason: 'new' } }));
    fetched.length = 0;
    const reads = { list: 0, get: 0 };
    const ol = store.documents.list.bind(store.documents);
    const og = store.documents.get.bind(store.documents);
    store.documents.list = (async () => (reads.list++, ol())) as never;
    store.documents.get = (async (i: never) => (reads.get++, og(i))) as never;
    expect(ok(await call('inbox:count', {}))).toMatchObject({ count: 1 });
    expect(reads).toEqual({ list: 0, get: 0 });
    await whenInboxIdle();
    expect(fetched).toEqual([]);
    // After a scan the renderer asks for a recount: one pass over the records, still no lookup.
    expect(ok(await call('inbox:count', { recount: true }))).toMatchObject({ count: 2 });
    // The parts of the number (tooltip of the badge): files dropped in the app and flagged library files.
    const parts = ok(await call('inbox:count', {}));
    expect(parts.dropped + parts.library).toBe(parts.count);
    expect(ok(await call('inbox:count', {}))).toMatchObject({ count: 2 });
    await whenInboxIdle();
    expect(fetched).toEqual([]);
  });

  it('a lookup that fails leaves a negative entry: listing again does not schedule it again', async () => {
    await store.documents.put(doc(9, 'misc/new.pdf', { doi: '10.1001/zzz', inbox: { since: NOW, reason: 'new' } }));
    const call = harness();
    online = true;
    failFetch = true;
    ok(await call('inbox:list'));
    await whenInboxIdle();
    expect(ok(await call('inbox:list')).items[0].lookup.state).toBe('error');
    await whenInboxIdle();
    const calls = fetched.length;
    const events = changed.filter(([e]) => e === 'inbox:changed').length;
    ok(await call('inbox:list'));
    ok(await call('inbox:list'));
    await whenInboxIdle();
    expect(fetched.length).toBe(calls);
    expect(changed.filter(([e]) => e === 'inbox:changed').length).toBe(events);
  });

  it('a damaged inbox file is kept as .bad before the queue is rewritten', async () => {
    const call = harness();
    await mkdir(path.join(local, 'inbox'), { recursive: true });
    const file = path.join(local, 'inbox', 'lib-1.json');
    await writeFile(file, JSON.stringify({ version: 99, items: [] }));
    ok(await call('inbox:add', { paths: [await pdf('a.pdf')] }));
    expect(JSON.parse(await readFile(`${file}.bad`, 'utf8'))).toEqual({ version: 99, items: [] });
  });

  it('a tag proposal can be cancelled (library switch, quit): the call gets an aborted signal and nothing is stored', async () => {
    const call = harness();
    const id = await queued(call);
    let started!: () => void;
    const running = new Promise<void>((r) => (started = r));
    completeWrap = () => (r: any) =>
      new Promise((_res, rej) => {
        started();
        r.signal.addEventListener('abort', () => rej(new AppError('CANCELLED', 'Cancelled')));
      });
    const pending = call('inbox:proposeTags', { id, model: 'claude-haiku-5-5', reasoning: 'low', folder: 'robots', confirmed: true });
    await running;
    abortAllJobs();
    expect(fail(await pending).code).toBe('CANCELLED');
    expect(ok(await call('inbox:list')).items[0].proposal.tagsFrom).not.toBe('ai');
  });

  it('the fallback file name is a safe segment (alternate data stream, reserved name)', () => {
    expect(isValidCopyName(proposedFileName({ title: null }, 'a.pdf:stream'))).toBe(true);
    expect(proposedFileName({ title: null }, 'con.pdf')).toBe('_con.pdf');
    expect(isValidCopyName(proposedFileName({ title: null }, ' . '))).toBe(true);
  });
});
