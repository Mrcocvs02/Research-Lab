import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { channels, createDispatcher, createMemoryLogger, defaultLibraryConfig, documentRecordSchema, taxonomyFileSchema, type IpcEnvelope, type LibraryConfig } from '@rl/core';
import { createLibraryStore, type FileLibraryStore } from '@rl/data';
import { MANIFEST_FILE } from '@rl/export';
import { ApprovedPaths } from '../approved-paths.js';
import { buildHandlers, type MainServices } from '../ipc/handlers/index.js';
import { whenExported } from './service.js';

const NOW = '2026-01-02T03:04:05.000Z';
const hex = (n: number) => n.toString(16).padStart(16, '0');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const COUNT = 8;
const TITLES = ['Attention in graph networks', 'Sparse methods for retrieval', 'A study of tokenizers', 'Citation structure of surveys', 'Robust estimation basics', 'Language models and notes', 'Layouts for large graphs', 'On clustering stability'];

const record = (i: number, extra: Record<string, unknown> = {}) =>
  documentRecordSchema.parse({
    id: hex(i),
    hash: sha(`doc-${i}`),
    path: `${i < 6 ? 'open' : 'private'}/p${i}.pdf`,
    size: 5,
    mtimeMs: 1,
    addedAt: NOW,
    updatedAt: NOW,
    title: TITLES[i % COUNT],
    year: 2010 + i,
    authors: [`Quillon${i % 3}, Wren`, 'Fenwick, Ada'],
    ref: i === 1 ? { venue: 'Journal of Tests' } : {},
    arxivId: i === 2 ? '2101.00001' : null,
    doi: i === 3 ? '10.1234/abc' : null,
    tags: i % 2 === 0 ? ['tagA'] : ['tagB'],
    study: { state: i === 1 ? 'reading' : 'to-read', underlined: { value: i === 1, origin: 'manual' } },
    ai: { summary: { value: `Summary of ${i}`, meta: { model: 'm', provider: 'mock', date: NOW, source: 'job' }, review: { status: i === 1 ? 'accepted' : 'proposed' } } },
    ...extra,
  });

let root: string;
let local: string;
let dest: string;
let store: FileLibraryStore;
let approved: ApprovedPaths;
let events: Array<{ channel: string; payload: any }>;
let services: MainServices;
let rt: any;
let opened: string[];

const config = (over: Partial<LibraryConfig> = {}): LibraryConfig => ({ ...defaultLibraryConfig({ name: 'Test library', language: 'en' }), aiEnabledFolders: ['open', 'private'], ...over }) as LibraryConfig;

function harness() {
  const log = createMemoryLogger();
  services = {
    log,
    localDataDir: local,
    emit: (channel: string, payload: unknown) => events.push({ channel, payload }),
    approved,
    runtime: { sync: async () => {}, hold: () => () => {}, status: () => ({}), require: async () => rt },
    settings: { get: async () => ({ deviceId: 'device-12345678' }) },
    shell: { openPath: async (p: string) => (opened.push(p), ''), showItemInFolder: () => {}, openExternal: async () => {} },
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
const sel = (over: Record<string, unknown> = {}) => ({ docIds: [hex(0), hex(1), hex(2), hex(3)], sources: 'paths', ...over });
const target = (name = 'brain') => ({ destination: dest, folderName: name });
const read = (...p: string[]) => readFile(path.join(dest, ...p), 'utf8');
const exists = (...p: string[]) => stat(path.join(dest, ...p)).then(() => true, () => false);
async function exportNow(call: ReturnType<typeof harness>, s = sel(), t = target(), confirmed = true) {
  const { jobId } = ok(await call('export:run', { selection: s, target: t, confirmed }));
  await whenExported(services);
  return ok(await call('export:status', { jobId })) as { state: string; result: any; error: any };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rl-exp-'));
  local = await mkdtemp(path.join(os.tmpdir(), 'rl-exp-local-'));
  dest = await mkdtemp(path.join(os.tmpdir(), 'rl-exp-dest-'));
  store = createLibraryStore({ rootPath: root, deviceId: 'device-12345678' });
  await store.init();
  await store.writeConfig(config());
  await store.writeTaxonomy(taxonomyFileSchema.parse({ nodes: [{ id: 'tagA', label: 'Topic A' }, { id: 'tagB', label: 'Topic B' }] }));
  for (let i = 0; i < COUNT; i++) {
    await store.documents.put(record(i));
    await mkdir(path.join(root, i < 6 ? 'open' : 'private'), { recursive: true });
    await writeFile(path.join(root, i < 6 ? 'open' : 'private', `p${i}.pdf`), `original ${i}`);
  }
  await store.notes.put({ frontmatter: { docId: hex(1), scope: 'file', createdAt: NOW, updatedAt: NOW }, body: 'My own thoughts on this one.' });
  await store.annotations.put({ schemaVersion: 1, docId: hex(1), annotations: [{ id: 'a1', kind: 'highlight', page: 4, rects: [{ x: 0, y: 0, w: 1, h: 1 }], text: 'a key sentence', color: 'yellow', createdAt: NOW, updatedAt: NOW }] } as never);
  await store.citations.put({
    schemaVersion: 1,
    docId: hex(0),
    references: [
      { matchedDocId: hex(1), title: 'Sparse methods for retrieval', authors: [], source: 'manual', checkedAt: NOW },
      { matchedDocId: null, title: 'An outside work', year: 1999, doi: '10.9/zzz', authors: [], source: 'manual', checkedAt: NOW },
    ],
    citedBy: [],
  } as never);
  approved = new ApprovedPaths();
  approved.add(dest, 'export-destination');
  rt = { libraryId: 'lib-1', store, textCacheDir: path.join(local, 'cache'), organizer: { generation: 1 } };
  events = [];
  opened = [];
});
afterEach(async () => {
  for (const d of [root, local, dest]) await rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('export:preview', () => {
  it('counts documents, files and tokens, and reports the state of the target', async () => {
    const call = harness();
    const p = ok(await call('export:preview', { selection: sel({ includeCited: false }), target: target() }));
    expect(p).toMatchObject({ documents: 4, citedAdded: 0, aiDisabledDocuments: 0, missingFiles: 0, target: { state: 'new', previousExportAt: null, editedFiles: 0 } });
    expect(p.files).toBeGreaterThan(8);
    expect(p.approxTokens).toBeGreaterThan(100);
    expect(p.indexTokens).toBeLessThanOrEqual(3000);
    expect(await readdir(dest)).toEqual([]);
  });
  it('counts the documents of folders not enabled for the AI', async () => {
    await store.writeConfig(config({ aiEnabledFolders: ['open'] }));
    const call = harness();
    const p = ok(await call('export:preview', { selection: sel({ docIds: [hex(0), hex(7)] }) }));
    expect(p.aiDisabledDocuments).toBe(1);
  });
  it('clusters need a graph model', async () => {
    const call = harness();
    expect(fail(await call('export:preview', { selection: { clusterIds: ['c1'] } }))).toMatchObject({ code: 'NOT_FOUND', details: { reason: 'no-model' } });
  });
  it('cited works join the selection to the depth asked', async () => {
    const call = harness();
    const p = ok(await call('export:preview', { selection: { docIds: [hex(0)], includeCited: true, citedDepth: 1 } }));
    expect(p).toMatchObject({ documents: 1, citedAdded: 1 });
  });
});

describe('export:run', () => {
  it('writes the layout of plan section 6 and never touches the originals', async () => {
    const call = harness();
    const st = await exportNow(call, sel({ includeCited: false }));
    expect(st.state).toBe('done');
    expect(st.result).toMatchObject({ written: expect.any(Number), updated: 0, keptEdited: [], orphaned: 0 });
    for (const f of ['CLAUDE.md', 'INDEX.md', 'graph.json', 'notes/README.md', 'sources/paths.tsv', MANIFEST_FILE, '.claude/commands/read-next.md', '.claude/commands/update-brain.md']) {
      expect(await exists('brain', f), f).toBe(true);
    }
    const papers = await readdir(path.join(dest, 'brain', 'papers'));
    expect(papers).toHaveLength(4);
    const manifest = JSON.parse(await read('brain', MANIFEST_FILE));
    const key1 = manifest.citekeys[hex(1)] as string;
    expect(key1).toMatch(/^quillon1\d{4}sparse$/);
    const card1 = await read('brain', 'papers', `${key1}.md`);
    expect(card1).toContain('ref: Journal of Tests');
    expect(card1).toContain('study: reading');
    expect(card1).toContain('underlined: true');
    expect(card1).toContain('My own thoughts on this one.');
    expect(card1).toContain('p. 4: "a key sentence"');
    expect(card1).not.toContain('not yet reviewed'); // accepted AI summary is not marked
    const card0 = await read('brain', 'papers', `${manifest.citekeys[hex(0)]}.md`);
    expect(card0).toContain('not yet reviewed'); // proposed one is
    expect(card0).toContain(`[[${key1}]]`);
    expect(card0).toContain('An outside work (1999) doi:10.9/zzz');
    expect(await read('brain', 'papers', `${key1}.md`)).toContain(`[[${manifest.citekeys[hex(0)]}]]`); // cited by
    expect(await read('brain', 'sources', 'paths.tsv')).toContain(path.join(root, 'open', 'p1.pdf'));
    expect(await read('brain', 'INDEX.md')).toContain('Topic A');
    const graph = JSON.parse(await read('brain', 'graph.json'));
    expect(graph.edges.some((e: any) => e.type === 'cites')).toBe(true);
    // The library is as it was.
    expect(await readFile(path.join(root, 'open', 'p1.pdf'), 'utf8')).toBe('original 1');
    expect(events.some((e) => e.channel === 'export:progress' && e.payload.state === 'done')).toBe(true);
  });

  it('names the commands in the library language', async () => {
    await store.writeConfig(config({ language: 'it' }));
    const call = harness();
    await exportNow(call);
    expect(await exists('brain', '.claude', 'commands', 'leggi-prossimo.md')).toBe(true);
    expect(await exists('brain', '.claude', 'commands', 'aggiorna-brain.md')).toBe(true);
  });

  it('refuses a destination that was not chosen with the dialog', async () => {
    const call = harness();
    const other = await mkdtemp(path.join(os.tmpdir(), 'rl-exp-other-'));
    try {
      expect(fail(await call('export:run', { selection: sel(), target: { destination: other, folderName: 'x' }, confirmed: true })).code).toBe('INVALID_REQUEST');
      // A sub-folder of an approved folder is not approved either (exact match).
      expect(fail(await call('export:run', { selection: sel(), target: { destination: path.join(dest, 'sub'), folderName: 'x' }, confirmed: true })).code).toBe('INVALID_REQUEST');
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it('needs confirmation for documents of folders not enabled for the AI', async () => {
    await store.writeConfig(config({ aiEnabledFolders: ['open'] }));
    const call = harness();
    const s = sel({ docIds: [hex(0), hex(7)] });
    expect(fail(await call('export:run', { selection: s, target: target(), confirmed: false }))).toMatchObject({ code: 'CONFLICT', details: { reason: 'needs-confirmation' } });
    expect(await exists('brain')).toBe(false);
    expect((await exportNow(call, s, target(), true)).state).toBe('done');
  });

  it('refuses a folder that is not empty or that belongs to another library, and writes nothing there', async () => {
    const call = harness();
    await mkdir(path.join(dest, 'full'));
    await writeFile(path.join(dest, 'full', 'mine.txt'), 'keep me');
    expect(fail(await call('export:run', { selection: sel(), target: target('full'), confirmed: true }))).toMatchObject({ code: 'CONFLICT', details: { reason: 'not-empty' } });
    expect(await readdir(path.join(dest, 'full'))).toEqual(['mine.txt']);
    await exportNow(call);
    const manifest = JSON.parse(await read('brain', MANIFEST_FILE));
    await writeFile(path.join(dest, 'brain', MANIFEST_FILE), JSON.stringify({ ...manifest, libraryId: 'someone-else' }));
    expect(fail(await call('export:run', { selection: sel(), target: target(), confirmed: true }))).toMatchObject({ code: 'CONFLICT', details: { reason: 'other-library' } });
    // An empty existing folder is fine.
    await mkdir(path.join(dest, 'empty'));
    expect((await exportNow(call, sel(), target('empty'))).state).toBe('done');
  });

  it('a link inside the export folder is never followed', async () => {
    const call = harness();
    await exportNow(call);
    const outside = await mkdtemp(path.join(os.tmpdir(), 'rl-exp-out-'));
    try {
      await rm(path.join(dest, 'brain', 'concepts'), { recursive: true, force: true });
      await symlink(outside, path.join(dest, 'brain', 'concepts'), 'junction');
      const st = await exportNow(call);
      expect(st.state).toBe('failed');
      expect(st.error.code).toBe('INVALID_PATH');
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('copies sources without overwriting, reading the originals only', async () => {
    const call = harness();
    const st = await exportNow(call, sel({ sources: 'copies' }));
    expect(st.result.copiedBytes).toBeGreaterThan(0);
    const manifest = JSON.parse(await read('brain', MANIFEST_FILE));
    const copy = path.join('brain', 'sources', `${manifest.citekeys[hex(0)]}.pdf`);
    expect(await read(copy)).toBe('original 0');
    await writeFile(path.join(dest, copy), 'edited copy');
    const again = await exportNow(call, sel({ sources: 'copies' }));
    expect(again.result.copiedBytes).toBe(0);
    expect(await read(copy)).toBe('edited copy');
    expect(await readFile(path.join(root, 'open', 'p0.pdf'), 'utf8')).toBe('original 0');
    expect(await exists('brain', 'sources', 'paths.tsv')).toBe(false);
  });

  it('cancel stops between files and leaves a recognisable folder', async () => {
    const call = harness();
    const { jobId } = ok(await call('export:run', { selection: sel(), target: target(), confirmed: true }));
    expect(ok(await call('export:cancel', { jobId })).cancelled).toBe(true);
    await whenExported(services);
    expect(ok(await call('export:status', { jobId })).state).toBe('cancelled');
    expect(await exists('brain', MANIFEST_FILE)).toBe(true);
    // The next export of the same library completes the folder.
    expect((await exportNow(call)).state).toBe('done');
    expect(ok(await call('export:cancel', { jobId: 'nope' })).cancelled).toBe(false);
  });

  it('reveal opens only the folder of a finished export of this session', async () => {
    const call = harness();
    const { jobId } = ok(await call('export:run', { selection: sel(), target: target(), confirmed: true }));
    await whenExported(services);
    ok(await call('export:reveal', { jobId }));
    expect(opened).toEqual([path.join(dest, 'brain')]);
    expect(fail(await call('export:reveal', { jobId: 'unknown' })).code).toBe('NOT_FOUND');
  });
});

describe('re-export', () => {
  it('rewrites only changed cards, keeps hand-written text, lists edits inside generated parts, keeps orphans', async () => {
    const call = harness();
    await exportNow(call);
    const m1 = JSON.parse(await read('brain', MANIFEST_FILE));
    const k0 = m1.citekeys[hex(0)] as string;
    const k1 = m1.citekeys[hex(1)] as string;
    const k2 = m1.citekeys[hex(2)] as string;
    // Nothing changed: nothing is written.
    const idle = await exportNow(call);
    expect(idle.result).toMatchObject({ written: 0, updated: 0, keptEdited: [], orphaned: 0 });
    // Hand-written text after a card (outside the markers) survives a change of that card.
    const f0 = path.join(dest, 'brain', 'papers', `${k0}.md`);
    await writeFile(f0, `${await readFile(f0, 'utf8')}\nMy hand-written paragraph.\n`);
    await store.documents.update(hex(0) as never, (c) => ({ ...c!, study: { ...c!.study, state: 'read' as const } }));
    // A card edited INSIDE its generated part is kept as it is.
    const f2 = path.join(dest, 'brain', 'papers', `${k2}.md`);
    await writeFile(f2, (await readFile(f2, 'utf8')).replace(/\n# (?!rl:)/, '\n# EDITED '));
    await store.documents.update(hex(2) as never, (c) => ({ ...c!, study: { ...c!.study, state: 'read' as const } }));
    rt.organizer.generation++;
    const preview = ok(await call('export:preview', { selection: sel(), target: target() }));
    expect(preview.target).toMatchObject({ state: 'previous-export', editedFiles: 1 });
    const r = await exportNow(call);
    expect(r.result.keptEdited).toEqual([`papers/${k2}.md`]);
    expect(r.result.updated).toBeGreaterThanOrEqual(1);
    const t0 = await readFile(f0, 'utf8');
    expect(t0).toContain('study: read');
    expect(t0).toContain('My hand-written paragraph.');
    expect(await readFile(f2, 'utf8')).toContain('\n# EDITED ');
    // Deselect a document: its card stays, it is counted and listed in INDEX.md; citekeys do not move.
    const fewer = sel({ docIds: [hex(0), hex(2), hex(3)] });
    const o = await exportNow(call, fewer);
    expect(o.result.orphaned).toBe(1);
    expect(await exists('brain', 'papers', `${k1}.md`)).toBe(true);
    expect(await read('brain', 'INDEX.md')).toContain(`[[${k1}]]`);
    const m2 = JSON.parse(await read('brain', MANIFEST_FILE));
    expect(m2.citekeys[hex(1)]).toBe(k1);
    expect(m2.citekeys[hex(0)]).toBe(k0);
  });

  it('the notes folder is created once and never touched again', async () => {
    const call = harness();
    await exportNow(call);
    await writeFile(path.join(dest, 'brain', 'notes', 'README.md'), 'my own readme');
    await writeFile(path.join(dest, 'brain', 'notes', 'idea.md'), 'an idea');
    await exportNow(call);
    expect(await read('brain', 'notes', 'README.md')).toBe('my own readme');
    expect(await read('brain', 'notes', 'idea.md')).toBe('an idea');
  });

  it('a file the export did not write is never overwritten', async () => {
    const call = harness();
    await exportNow(call);
    const m = JSON.parse(await read('brain', MANIFEST_FILE));
    const k0 = m.citekeys[hex(0)] as string;
    // The user deleted the manifest entry of a card and wrote their own file under that name.
    delete m.files[`papers/${k0}.md`];
    await writeFile(path.join(dest, 'brain', MANIFEST_FILE), JSON.stringify(m));
    await writeFile(path.join(dest, 'brain', 'papers', `${k0}.md`), 'my own card');
    const r = await exportNow(call);
    expect(r.result.keptEdited).toContain(`papers/${k0}.md`);
    expect(await read('brain', 'papers', `${k0}.md`)).toBe('my own card');
  });
});

describe('INDEX.md size', () => {
  it('stays under 3000 tokens with many papers', async () => {
    for (let i = 10; i < 400; i++) await store.documents.put(record(i % COUNT, { id: hex(i), hash: sha(`doc-${i}`), path: `open/q${i}.pdf`, title: `Generated paper number ${i} about topic ${i % 7}`, year: 2000 + (i % 25) }));
    const call = harness();
    const p = ok(await call('export:preview', { selection: { folders: ['open'] } }));
    expect(p.documents).toBeGreaterThan(300);
    expect(p.indexTokens).toBeLessThanOrEqual(3000);
    const st = await exportNow(call, { folders: ['open'], sources: 'none' } as never);
    expect(st.state).toBe('done');
    const index = await read('brain', 'INDEX.md');
    expect(Math.ceil(index.length / 4)).toBeLessThanOrEqual(3100);
  });
});
