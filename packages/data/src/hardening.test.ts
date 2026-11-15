import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AppError,
  DOCUMENT_LIMITS,
  documentRecordSchema,
  isRevisionConflict,
  taxonomyFileSchema,
  type Annotation,
  type DocumentRecord,
} from '@rl/core';
import { createLegacyImporter } from './index.js';
import { createLibraryStore, type FileLibraryStore } from './store.js';
import { hex, removeDir, tempDir } from './test-utils.js';

const NOW = '2026-01-02T03:04:05.000Z';

function doc(n: number, over: Partial<DocumentRecord> = {}): DocumentRecord {
  return documentRecordSchema.parse({ id: hex(n), hash: 'a'.repeat(64), path: `docs/file-${n}.pdf`, size: 10, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, ...over });
}

const annotation = (id: string): Annotation => ({
  id,
  kind: 'highlight',
  page: 1,
  rects: [{ x: 0, y: 0, w: 0.5, h: 0.1 }],
  text: id,
  color: 'yellow',
  createdAt: NOW,
  updatedAt: NOW,
});

const node = (id: string) => ({ id, label: id.toUpperCase(), parents: [], aliases: [], implies: [], status: 'active' as const, origin: 'user' as const });

describe('serialised updates and revision checks', () => {
  let root: string;
  let store: FileLibraryStore;
  beforeEach(async () => {
    root = await tempDir();
    store = createLibraryStore({ rootPath: root, deviceId: 'device-1' });
  });
  afterEach(() => removeDir(root));

  it('does not lose concurrent annotation upserts on the same file', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `a${i}`);
    await Promise.all(ids.map((id) => store.annotations.upsert(hex(1), annotation(id))));
    const saved = await store.annotations.get(hex(1));
    expect(saved?.annotations.map((a) => a.id).sort()).toEqual([...ids].sort());
  });

  it('keeps both a scan update and a tag edit made concurrently on the same document', async () => {
    await store.documents.put(doc(1, { tags: ['a'] }));
    const scan = store.withActor('system').documents.update(hex(1), async (d) => {
      await new Promise((r) => setTimeout(r, 30)); // a slow read-modify-write
      return { ...(d as DocumentRecord), mtimeMs: 999, size: 77 };
    });
    const edit = store.documents.update(hex(1), (d) => ({ ...(d as DocumentRecord), tags: ['a', 'b'] }));
    await Promise.all([scan, edit]);
    const after = await store.documents.get(hex(1));
    expect(after).toMatchObject({ mtimeMs: 999, size: 77, tags: ['a', 'b'] });
    expect(after?.revision).toBe(2);
  });

  it('serialises puts and updates of the same item across store views', async () => {
    await store.documents.put(doc(1));
    const other = store.withActor('import');
    await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? store : other).documents.update(hex(1), (d) => ({ ...(d as DocumentRecord), tags: [...(d as DocumentRecord).tags, `t${i}`] }))));
    expect((await store.documents.get(hex(1)))?.tags).toHaveLength(10);
  });

  it('rejects a document put made on an outdated revision with a typed conflict', async () => {
    const first = await store.documents.put(doc(1));
    expect(first.revision).toBe(0);
    const second = await store.documents.put({ ...first, title: 'mine' }, { expectedRevision: 0 });
    expect(second.revision).toBe(1);
    const stale = store.documents.put({ ...first, title: 'stale' }, { expectedRevision: 0 });
    await expect(stale).rejects.toSatisfy(isRevisionConflict);
    await expect(stale).rejects.toMatchObject({ details: { conflict: 'revision', expected: 0, actual: 1 } });
    expect((await store.documents.get(hex(1)))?.title).toBe('mine');
    // a missing item is a conflict too when a revision is expected
    await expect(store.documents.put(doc(2), { expectedRevision: 0 })).rejects.toSatisfy(isRevisionConflict);
    // repositories whose items carry no revision refuse the option
    await expect(store.projects.put({} as never, { expectedRevision: 0 })).rejects.toBeInstanceOf(Error);
  });

  it('detects a taxonomy writer with an old revision', async () => {
    const base = taxonomyFileSchema.parse({});
    await store.writeTaxonomy({ ...base, nodes: [node('n1')] }, { expectedRevision: 0 });
    const seen = await store.readTaxonomy();
    expect(seen.revision).toBe(1);
    await store.writeTaxonomy({ ...seen, nodes: [node('n1'), node('n2')] }, { expectedRevision: seen.revision });
    // second caller still holds revision 1
    await expect(store.writeTaxonomy({ ...seen, nodes: [node('n1'), node('n3')] }, { expectedRevision: seen.revision })).rejects.toSatisfy(isRevisionConflict);
    expect((await store.readTaxonomy()).nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
  });

  it('updateTaxonomy keeps concurrent additions', async () => {
    await Promise.all(['x1', 'x2', 'x3', 'x4'].map((id) => store.updateTaxonomy((t) => ({ ...t, nodes: [...t.nodes, node(id)] }))));
    expect((await store.readTaxonomy()).nodes.map((n) => n.id).sort()).toEqual(['x1', 'x2', 'x3', 'x4']);
  });

  it('a failed update does not block the queue', async () => {
    await store.documents.put(doc(1));
    await expect(store.documents.update(hex(1), () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await store.documents.update(hex(1), (d) => ({ ...(d as DocumentRecord), title: 'ok' }));
    expect((await store.documents.get(hex(1)))?.title).toBe('ok');
  });

  it('starts a new log line after a torn one and counts the unreadable lines', async () => {
    await store.documents.put(doc(1, { tags: ['a'] }));
    const dir = path.join(store.dataDir, 'log');
    const [file] = await readdir(dir);
    await appendFile(path.join(dir, file as string), '{"type":"chan'); // process died mid-line
    await store.documents.put(doc(1, { tags: ['a', 'b'] }));
    const log = await store.readLog();
    expect(log).toHaveLength(2); // before the fix the new entry was glued to the fragment and lost
    expect(log.map((e) => (e.type === 'change' ? e.action : ''))).toEqual(['document.create', 'tags.update']);
    expect(store.issues()).toContainEqual(expect.objectContaining({ code: 'LOG_LINES_SKIPPED', file: `log/${file}` }));
  });
});

describe('document model limits', () => {
  it('rejects oversized free text and path lists', () => {
    const base = { id: hex(1), hash: 'a'.repeat(64), path: 'a.pdf', size: 1, mtimeMs: 1, addedAt: NOW, updatedAt: NOW };
    expect(documentRecordSchema.safeParse({ ...base, title: 'x'.repeat(DOCUMENT_LIMITS.title + 1) }).success).toBe(false);
    expect(documentRecordSchema.safeParse({ ...base, authors: ['x'.repeat(DOCUMENT_LIMITS.author + 1)] }).success).toBe(false);
    expect(documentRecordSchema.safeParse({ ...base, aliasPaths: Array.from({ length: DOCUMENT_LIMITS.paths + 1 }, (_, i) => `p${i}.pdf`) }).success).toBe(false);
    expect(documentRecordSchema.safeParse({ ...base, path: `${'d/'.repeat(600)}x.pdf` }).success).toBe(false);
    expect(documentRecordSchema.parse(base)).toMatchObject({ aliasPaths: [], revision: 0 });
  });
});

describe('legacy importer hardening', () => {
  let tmp: string;
  let root: string;
  let dataDir: string;

  const rec = (p: string, tags: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ p, mt: '2026-01-01T10:00:00Z', sz: 5, h: '', tags: { title: 'T', ...tags }, ...extra });

  async function writeIndex(lines: string[], taxonomy: unknown = {}) {
    const idx = path.join(root, '.phd_index');
    await mkdir(idx, { recursive: true });
    await writeFile(path.join(idx, 'files.jsonl'), lines.join('\n') + '\n');
    await writeFile(path.join(idx, 'taxonomy.json'), typeof taxonomy === 'string' ? taxonomy : JSON.stringify(taxonomy));
  }
  const json = (xs: unknown[]) => xs.map((x) => JSON.stringify(x));

  const run = (options: Parameters<typeof createLegacyImporter>[0] = {}) =>
    createLegacyImporter({ now: () => new Date('2026-02-01T00:00:00Z'), retry: { baseDelayMs: 1 }, ...options }).run({ sourceDir: root, libraryRoot: root, dataDir, deviceId: 'device-1' });

  async function tree(dir: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (d: string) => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) await walk(f);
        else out.push(path.relative(tmp, f).split(path.sep).join('/'));
      }
    };
    await walk(dir);
    return out.sort();
  }

  beforeEach(async () => {
    tmp = await tempDir();
    root = path.join(tmp, 'library');
    dataDir = path.join(root, '.lab');
    await mkdir(path.join(root, 'docs'), { recursive: true });
    await mkdir(path.join(tmp, 'outside'), { recursive: true });
    await writeFile(path.join(tmp, 'outside', 'secret.pdf'), 'outside content');
    await writeFile(path.join(root, 'docs', 'a.pdf'), 'content-a');
    await writeFile(path.join(root, 'docs', 'b.pdf'), 'content-b');
    await writeFile(path.join(root, 'docs', 'c.pdf'), 'content-a'); // same bytes as a.pdf
    await writeFile(path.join(root, 'docs', 'd.pdf'), 'content-a');
  });
  afterEach(() => removeDir(tmp));

  it('keeps names that share a slug apart ("C++" vs "C#") for tags, types and venues', async () => {
    await writeIndex(
      json([rec('docs/a.pdf', { micro: ['C++'], type: 'C++', venue: 'C++' }), rec('docs/b.pdf', { micro: ['C#'], type: 'C#', venue: 'C#' })]),
      { types: ['C++'], venues: { 'C++': {}, 'C#': {} }, micro: { 'C++': {}, 'C#': {}, 'c++': {} } },
    );
    await run();
    const store = createLibraryStore({ rootPath: root, dataDir, deviceId: 'd' });
    const tax = await store.readTaxonomy();
    expect(tax.nodes.map((n) => n.label)).toEqual(['C++', 'C#']); // 'c++' is the same name as 'C++' and is folded in
    expect(new Set(tax.nodes.map((n) => n.id)).size).toBe(2);
    expect(tax.documentTypes.map((t) => t.label)).toEqual(['C++', 'C#']);
    expect(new Set(tax.documentTypes.map((t) => t.id)).size).toBe(2);
    expect(tax.venues.map((v) => v.name)).toEqual(['C++', 'C#']);
    expect(new Set(tax.venues.map((v) => v.id)).size).toBe(2);
    const docs = await store.documents.list();
    const a = docs.find((d) => d.path === 'docs/a.pdf');
    const b = docs.find((d) => d.path === 'docs/b.pdf');
    expect(a?.tags).toHaveLength(1);
    expect(b?.tags).toHaveLength(1);
    expect(a?.tags[0]).not.toBe(b?.tags[0]);
    expect(a?.type).not.toBe(b?.type);
    expect(a?.ref.venueId).not.toBe(b?.ref.venueId);
  });

  it('still recognises a node the user renamed when the same index is imported again', async () => {
    await writeIndex(json([rec('docs/a.pdf', { micro: ['Topic'] })]), { micro: { Topic: {} } });
    await run();
    const store = createLibraryStore({ rootPath: root, dataDir, deviceId: 'd' });
    const tax = await store.readTaxonomy();
    await store.writeTaxonomy({ ...tax, nodes: tax.nodes.map((n) => ({ ...n, label: 'Renamed' })) });
    await writeIndex(json([rec('docs/a.pdf', { micro: ['Topic'] }), rec('docs/b.pdf', { micro: ['Topic'] })]), { micro: { Topic: {} } });
    const report = await run();
    expect(report.taxonomyNodes).toBe(0);
    expect((await store.readTaxonomy()).nodes).toHaveLength(1);
    expect((await store.documents.list()).find((d) => d.path === 'docs/b.pdf')?.tags).toEqual([tax.nodes[0]?.id]);
  });

  it('keeps every path of identical content in aliasPaths, and a re-import adds nothing', async () => {
    await writeIndex(json([rec('docs/a.pdf', { macro: ['x'] }), rec('docs/c.pdf', { macro: ['y'] }), rec('docs/d.pdf'), rec('docs/b.pdf')]));
    const report = await run();
    expect(report).toMatchObject({ documents: 2, duplicates: 2 });
    const store = createLibraryStore({ rootPath: root, dataDir, deviceId: 'd' });
    const docs = await store.documents.list();
    const a = docs.find((d) => d.path === 'docs/a.pdf');
    expect(a?.aliasPaths).toEqual(['docs/c.pdf', 'docs/d.pdf']);
    expect(docs.find((d) => d.path === 'docs/b.pdf')?.aliasPaths).toEqual([]);
    expect(docs).toHaveLength(2);
    const again = await run();
    expect(again).toMatchObject({ documents: 0, duplicates: 0 });
    expect((await store.documents.get(a?.id as never))?.aliasPaths).toEqual(['docs/c.pdf', 'docs/d.pdf']);
  });

  it('retries a file that is briefly locked instead of skipping it', async () => {
    await writeIndex(json([rec('docs/a.pdf'), rec('docs/b.pdf')]));
    const attempts = new Map<string, number>();
    const report = await run({
      hashFile: async (file) => {
        const n = (attempts.get(file) ?? 0) + 1;
        attempts.set(file, n);
        if (file.endsWith('a.pdf') && n < 3) throw new AppError('IO_ERROR', 'Cannot hash file', { code: 'EBUSY' });
        return (await import('node:crypto')).createHash('sha256').update(await readFile(file)).digest('hex');
      },
    });
    expect(report.documents).toBe(2);
    expect(report.skipped).toBe(0);
    expect(report.skippedFiles).toEqual([]);
    expect([...attempts.entries()].find(([f]) => f.endsWith('a.pdf'))?.[1]).toBe(3);
  });

  it('lists every skipped record with its path and reason in the report', async () => {
    await writeIndex(json([rec('docs/a.pdf'), rec('docs/b.pdf'), rec('docs')]));
    const report = await run({
      hashFile: async (file) => {
        if (file.endsWith('b.pdf')) throw Object.assign(new Error('locked'), { code: 'EBUSY' });
        return 'a'.repeat(64);
      },
    });
    expect(report.documents).toBe(1);
    expect(report.skipped).toBe(2);
    expect(report.skippedFiles).toEqual(
      expect.arrayContaining([
        { path: 'docs/b.pdf', reason: 'unreadable', line: 2 },
        { path: 'docs', reason: 'not-a-file', line: 3 },
      ]),
    );
    expect(report.skippedFiles).toHaveLength(2);
  });

  it('returns the self names of the old index, cleaned and without duplicates', async () => {
    await writeIndex(json([rec('docs/a.pdf')]), { settings: { self_names: ['Jane Roe', ' Jane Roe ', 'J. Roe', '', 'x'.repeat(5000)] } });
    const report = await run();
    expect(report.selfNames).toHaveLength(3);
    expect(report.selfNames.slice(0, 2)).toEqual(['Jane Roe', 'J. Roe']);
    expect(report.selfNames[2]?.length).toBeLessThanOrEqual(300);
    await writeIndex(json([rec('docs/b.pdf')]), {});
    expect((await run()).selfNames).toEqual([]);
  });

  it('survives a hostile index without writing outside the data folder', async () => {
    const hugeName = `docs/${'n'.repeat(5000)}.pdf`;
    const lines = [
      ...json([
        rec('../outside/secret.pdf'),
        rec('docs/../../outside/secret.pdf'),
        rec('/etc/passwd'),
        rec('C:/Windows/win.ini'),
        rec('C:\\Windows\\win.ini'),
        rec('\\\\server\\share\\x.pdf'),
        rec('//server/share/x.pdf'),
        rec('docs/a\0.pdf'),
        rec(''),
        rec(hugeName),
        rec('docs/a.pdf', { title: 'T'.repeat(100_000), authors: Array.from({ length: 600 }, (_, i) => `Author ${i} ${'z'.repeat(500)}`), doi: 'd'.repeat(50_000) }),
      ]),
      `{"p":"docs/b.pdf","junk":"${'j'.repeat(700_000)}"}`, // longer than the line ceiling set below
      '[1,2,3]',
      'not json at all',
    ];
    await writeIndex(lines);
    const before = await tree(tmp);
    const report = await run({ limits: { maxLineBytes: 600_000 } });
    // only a.pdf (clipped fields) is imported; the rest is skipped cleanly and listed
    expect(report.documents).toBe(1);
    expect(report.skipped).toBe(lines.length - 1);
    expect(report.skippedFiles).toHaveLength(lines.length - 1);
    expect(report.skippedFiles.every((s) => s.path.length <= 300)).toBe(true);
    expect(report.skippedFiles.map((s) => s.reason)).toEqual(expect.arrayContaining(['unsafe-path', 'line-too-long', 'invalid-line']));
    const store = createLibraryStore({ rootPath: root, dataDir, deviceId: 'd' });
    const [only] = await store.documents.list();
    expect(only?.title).toHaveLength(DOCUMENT_LIMITS.title);
    expect(only?.authors).toHaveLength(DOCUMENT_LIMITS.authors);
    expect(only?.authors[0]?.length).toBeLessThanOrEqual(DOCUMENT_LIMITS.author);
    expect(only?.doi?.length).toBe(DOCUMENT_LIMITS.identifier);
    // nothing new outside the data dir; the file outside the library was never read into the data
    const after = await tree(tmp);
    expect(after.filter((f) => !before.includes(f) && !f.startsWith('library/.lab/'))).toEqual([]);
    expect(await readFile(path.join(tmp, 'outside', 'secret.pdf'), 'utf8')).toBe('outside content');
  });

  it('refuses an index with too many records, or files that are too large', async () => {
    await writeIndex(json(Array.from({ length: 6 }, () => rec('docs/a.pdf'))));
    await expect(run({ limits: { maxRecords: 5 } })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(run({ limits: { maxFilesBytes: 100 } })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await writeIndex(json([rec('docs/a.pdf')]), { types: ['x'.repeat(2000)] });
    await expect(run({ limits: { maxTaxonomyBytes: 500 } })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(readdir(dataDir)).rejects.toThrow(); // nothing was created
  });

  it('streams a long index line by line without confusing a multi-byte character split across reads', async () => {
    const title = 'é'.repeat(70_000); // > 64 KiB read chunk, 2 bytes per character
    await writeIndex(json([rec('docs/a.pdf', { title }), rec('docs/b.pdf')]));
    const report = await run();
    expect(report.documents).toBe(2);
    const store = createLibraryStore({ rootPath: root, dataDir, deviceId: 'd' });
    expect((await store.documents.list()).find((d) => d.path === 'docs/a.pdf')?.title).toBe(title.slice(0, DOCUMENT_LIMITS.title));
  });
});
