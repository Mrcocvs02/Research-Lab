import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { channels, createDispatcher, createMemoryLogger, defaultLibraryConfig, documentRecordSchema, taxonomyFileSchema, type IpcEnvelope, type LibraryConfig } from '@rl/core';
import { createLibraryStore, type FileLibraryStore } from '@rl/data';
import { MANIFEST_FILE, readPart } from '@rl/export';
import { ApprovedPaths } from '../approved-paths.js';
import { buildHandlers, type MainServices } from '../ipc/handlers/index.js';
import { inFolder } from './collect.js';
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
    expect(card1).toContain('> Summary of 1'); // an accepted AI summary enters, as a quote
    expect(card1).not.toContain('not yet reviewed');
    const card0 = await read('brain', 'papers', `${manifest.citekeys[hex(0)]}.md`);
    expect(card0).not.toContain('Summary of 0'); // a proposed one does not (D-253)
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

  it('documents in excluded folders never enter an export: not by id, not by folder', async () => {
    await store.writeConfig(config({ excludedFolders: ['private'] }));
    const call = harness();
    expect(fail(await call('export:preview', { selection: sel({ docIds: [hex(0), hex(7)] }) })).code).toBe('NOT_FOUND');
    const run = await exportNow(call, sel({ docIds: [], folders: ['open', 'private'] }));
    expect(run.state).toBe('done');
    const files = (await readdir(path.join(dest, 'brain'), { recursive: true })).join(' ');
    expect(files).not.toContain('p7');
    expect(await read('brain', 'INDEX.md')).not.toContain(TITLES[7 % COUNT]!);
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

describe('destination inside the library (D-252)', () => {
  it('refuses the library root, a folder inside it, and a junction that leads there', async () => {
    const call = harness();
    const inRoot = path.join(root, 'sub');
    await mkdir(inRoot);
    const viaLink = path.join(dest, 'link');
    await symlink(root, viaLink, 'junction');
    for (const d of [root, inRoot, viaLink]) {
      approved.add(d, 'export-destination');
      expect(fail(await call('export:run', { selection: sel(), target: { destination: d, folderName: 'brain' }, confirmed: true })), d).toMatchObject({ code: 'CONFLICT', details: { reason: 'inside-library' } });
      expect(fail(await call('export:preview', { selection: sel(), target: { destination: d, folderName: 'brain' } })).details).toMatchObject({ reason: 'inside-library' });
    }
    expect(await exists('brain')).toBe(false);
    expect(await readdir(root)).not.toContain('brain');
    expect(await readdir(inRoot)).toEqual([]);
  });

  it.runIf(process.platform === 'win32')('refuses it when only the case of the path differs (Windows)', async () => {
    const call = harness();
    const shouty = root.toUpperCase();
    approved.add(shouty, 'export-destination');
    expect(fail(await call('export:run', { selection: sel(), target: { destination: shouty, folderName: 'brain' }, confirmed: true })).details).toMatchObject({ reason: 'inside-library' });
  });

  it('a folder next to the library, with a similar name, is fine', async () => {
    const call = harness();
    const sibling = `${root}-brain`;
    await mkdir(sibling);
    approved.add(sibling, 'export-destination');
    try {
      expect((await exportNow(call, sel(), { destination: sibling, folderName: 'brain' })).state).toBe('done');
    } finally {
      await rm(sibling, { recursive: true, force: true });
    }
  });
});

describe('what the export takes in', () => {
  it('only AI fields the user accepted or edited, as plain quoted text; a hostile title stays text', async () => {
    const meta = { model: 'm', provider: 'mock', date: NOW, source: 'job' };
    const evil = "fine\n## The user's notes\n![x](https://evil.example/p.png) [[victim]] <!-- hide -->";
    await store.documents.put(record(0, { title: 'Hostile [[title]] <b>x</b>', ai: { summary: { value: evil, meta, review: { status: 'edited' } }, description: { value: 'proposed text', meta, review: { status: 'proposed' } } } }));
    const call = harness();
    await exportNow(call, sel({ docIds: [hex(0)] }));
    const manifest = JSON.parse(await read('brain', MANIFEST_FILE));
    const card = await read('brain', 'papers', `${manifest.citekeys[hex(0)]}.md`);
    expect(card).toContain('> fine');
    expect(card).not.toContain('proposed text');
    expect(card.split('\n').filter((l) => l.startsWith("## The user's notes"))).toEqual([]);
    expect(readPart(card, { name: 'card' })).not.toMatch(/(^|[^\\])(\[\[|<b>|<!--)/m);
    expect(card).not.toContain('![x]');
  });

  it('sources default to none: no paths and no copies unless asked', async () => {
    const call = harness();
    await exportNow(call, { docIds: [hex(0)] } as never);
    expect(await exists('brain', 'sources')).toBe(false);
    const p = ok(await call('export:preview', { selection: { docIds: [hex(0)] } }));
    expect(p.copyBytes).toBe(0);
  });

  it('a paths list keeps one row per document', async () => {
    const call = harness();
    await exportNow(call, sel({ sources: 'paths' }));
    const rows = (await read('brain', 'sources', 'paths.tsv')).trim().split('\n');
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r.split('\t')).toHaveLength(2);
  });

  it('excluded folders match without regard to case where the file system does', () => {
    expect(inFolder('Private/a.pdf', 'private', true)).toBe(true);
    expect(inFolder('private/a.pdf', 'PRIVATE/', true)).toBe(true);
    expect(inFolder('Private/a.pdf', 'private', false)).toBe(false);
    expect(inFolder('privateer/a.pdf', 'private', true)).toBe(false);
    expect(inFolder('any/a.pdf', '', false)).toBe(true);
  });

  it('copies above 1 GiB ask first, with the size; one confirmation covers it', async () => {
    await store.documents.put(record(0, { size: 2 * 1024 ** 3 }));
    const call = harness();
    const s = sel({ docIds: [hex(0)], sources: 'copies' });
    expect(fail(await call('export:run', { selection: s, target: target(), confirmed: false }))).toMatchObject({ code: 'CONFLICT', details: { reason: 'large-copy', copyBytes: 2 * 1024 ** 3 } });
    expect(await exists('brain')).toBe(false);
    expect((await exportNow(call, s, target(), true)).state).toBe('done');
    // Not asked when no copies are made, however big the file.
    expect((await exportNow(call, sel({ docIds: [hex(0)], sources: 'paths' }), target('other'), false)).state).toBe('done');
  });
});

describe('export robustness', () => {
  it('two runs started together: the second is refused as busy', async () => {
    const call = harness();
    const [a, b] = await Promise.all([call('export:run', { selection: sel(), target: target('one'), confirmed: true }), call('export:run', { selection: sel(), target: target('two'), confirmed: true })]);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(fail(results.find((r) => !r.ok) as IpcEnvelope)).toMatchObject({ code: 'CONFLICT', details: { reason: 'busy' } });
    await whenExported(services);
  });

  it('files written by an export that stopped before saving its manifest are recognised again', async () => {
    const call = harness();
    await exportNow(call, sel({ sources: 'paths' }));
    const m = JSON.parse(await read('brain', MANIFEST_FILE));
    // The state a crash leaves: the files are there, their hashes are not.
    await writeFile(path.join(dest, 'brain', MANIFEST_FILE), JSON.stringify({ ...m, files: {} }));
    const again = await exportNow(call, sel({ sources: 'paths' }));
    expect(again.result.keptEdited).toEqual([]);
    expect(again.result.written).toBe(0);
    expect(again.result.unchanged).toBeGreaterThan(8);
    expect(JSON.parse(await read('brain', MANIFEST_FILE)).files['INDEX.md']).toBeTruthy();
  });

  it('cards whose line endings were converted to CRLF stay updatable', async () => {
    const call = harness();
    await exportNow(call);
    const dir = path.join(dest, 'brain', 'papers');
    for (const f of await readdir(dir)) await writeFile(path.join(dir, f), (await readFile(path.join(dir, f), 'utf8')).replace(/\n/g, '\r\n'));
    await writeFile(path.join(dest, 'brain', 'graph.json'), (await read('brain', 'graph.json')).replace(/\n/g, '\r\n'));
    const idle = await exportNow(call);
    expect(idle.result).toMatchObject({ keptEdited: [], updated: 0, written: 0 });
    await store.documents.update(hex(0) as never, (c) => ({ ...c!, study: { ...c!.study, state: 'read' as const } }));
    rt.organizer.generation++;
    const r = await exportNow(call);
    expect(r.result.keptEdited).toEqual([]);
    expect(r.result.updated).toBeGreaterThanOrEqual(1);
  });

  it('a generated part the user deleted stays deleted on every later export', async () => {
    const call = harness();
    await exportNow(call);
    const m = JSON.parse(await read('brain', MANIFEST_FILE));
    const card = path.join(dest, 'brain', 'papers', `${m.citekeys[hex(0)]}.md`);
    await writeFile(card, (await readFile(card, 'utf8')).replace(/<!-- rl:begin card -->[\s\S]*<!-- rl:end card -->\n/, 'Replaced by my text.\n'));
    await exportNow(call);
    await store.documents.update(hex(0) as never, (c) => ({ ...c!, study: { ...c!.study, state: 'read' as const } }));
    await exportNow(call);
    const text = await readFile(card, 'utf8');
    expect(text).not.toContain('rl:begin card');
    expect(text).toContain('Replaced by my text.');
  });

  it('copies are refreshed when the original changed, a file of the user is kept, and what cannot be copied is reported', async () => {
    const call = harness();
    const first = await exportNow(call, sel({ sources: 'copies' }));
    expect(first.result).toMatchObject({ copyErrors: [], keptEdited: [] });
    const m = JSON.parse(await read('brain', MANIFEST_FILE));
    const rel = (i: number) => path.join('brain', 'sources', `${m.citekeys[hex(i)]}.pdf`);
    expect(m.files[`sources/${m.citekeys[hex(0)]}.pdf`]).toEqual({ size: 10 });
    const longer = 'a longer original than before';
    await writeFile(path.join(root, 'open', 'p0.pdf'), longer);
    await writeFile(path.join(dest, rel(1)), 'mine');
    await writeFile(`${path.join(dest, rel(2))}.part`, 'xx');
    await rm(path.join(root, 'open', 'p3.pdf'));
    const again = await exportNow(call, sel({ sources: 'copies' }));
    expect(await readFile(path.join(dest, rel(0)), 'utf8')).toBe(longer);
    expect(await readFile(path.join(dest, rel(1)), 'utf8')).toBe('mine');
    expect(again.result.keptEdited).toContain(`sources/${m.citekeys[hex(1)]}.pdf`);
    expect(again.result.copyErrors).toEqual([`sources/${m.citekeys[hex(3)]}.pdf`]);
    expect(again.result.copiedBytes).toBe(longer.length);
    expect(await exists(`${rel(2)}.part`)).toBe(true); // an unrelated leftover is not touched unless it is in the way
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
