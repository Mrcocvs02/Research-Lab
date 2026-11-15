import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, type ImportJobStatus } from '@rl/core';
import { createLegacyImporter } from './index.js';
import { createLibraryStore } from './store.js';
import { removeDir, tempDir } from './test-utils.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const TAXONOMY = {
  version: 3,
  settings: { self_names: ['Someone'], extensions: ['pdf', 'txt'], name_only_extensions: ['png'], prune_deleted_days: 90 },
  venues: { 'Journal One': { aliases: ['J1'] }, Preprints: { aliases: ['preprint server'] } },
  types: ['paper', 'notes'],
  macro: { Physics: { aliases: ['Phys'] }, 'Data science': {} },
  micro: {
    'Deep learning': { macro: ['Data science', 'Physics'], aliases: ['DL'], status: 'confirmed', implies: ['Machine learning'] },
    'Machine learning': { macro: ['Data science'], aliases: [], status: 'confirmed' },
    'Odd tag': { macro: ['Nowhere'], status: 'weird', implies: ['Ghost'] },
  },
  extra: { Résumé_term: { group: 'Sidecar', source: 'x/y.pdf', added: '2026-01-05' } },
  imports_done: { a: 1 },
};

function record(p: string, tags: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    p,
    mt: '2026-01-01T10:00:00Z',
    sz: 5,
    h: '',
    first: '2026-01-02',
    tagged: '2026-01-03',
    st: 'ok',
    tags: {
      title: 'T',
      authors: [],
      type: 'paper',
      macro: [],
      implied_macro: [],
      micro: [],
      implied: [],
      keywords: [],
      extra: [],
      year: null,
      lang: 'en',
      summary: '',
      confidence: 'high',
      source: 'content',
      origin: 'unknown',
      venue: '',
      venue_ref: '',
      doi: '',
      arxiv: '',
      pub_status: 'n/a',
      pub_source: '',
      pub_checked: null,
      ...tags,
    },
    ...extra,
  };
}

const CONTENT: Record<string, string> = {
  'docs/a.pdf': 'content-a',
  'docs/b.pdf': 'content-b',
  'docs/copy-of-a.pdf': 'content-a',
  'docs/note.txt': 'plain text',
};

let tmp: string;
let root: string;
let dataDir: string;

async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) await walk(f);
      else out[path.relative(dir, f)] = sha(await readFile(f, 'utf8'));
    }
  };
  await walk(dir);
  return out;
}

async function writeIndex(records: unknown[], taxonomy: unknown = TAXONOMY) {
  const idx = path.join(root, '.phd_index');
  await mkdir(idx, { recursive: true });
  await writeFile(path.join(idx, 'files.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  await writeFile(path.join(idx, 'taxonomy.json'), JSON.stringify(taxonomy));
}

const RECORDS = [
  record('docs/a.pdf', {
    title: 'Paper A',
    authors: ['Ann Author', 'Bob Writer'],
    macro: ['physics'],
    micro: ['DL', 'Odd tag'],
    implied: ['Machine learning'],
    implied_macro: ['Data science'],
    extra: ['resume term'],
    keywords: ['kw one', 'kw two'],
    summary: 'A short summary.',
    year: 2024,
    venue: 'J1',
    venue_ref: 'Vol. 3, 12',
    doi: '10.1000/xyz',
    arxiv: '2401.00001',
    pub_status: 'published',
    pub_source: 'crossref',
    pub_checked: '2026-01-04',
  }),
  record('docs/b.pdf', { title: 'Paper B', micro: ['Machine learning'], year: '2023', venue: 'Unlisted venue', type: 'notes' }, { xt: ['resume_term', 'manual only tag'] }),
  record('docs/copy-of-a.pdf', { title: 'Copy of A', macro: ['Data science'] }),
  record('docs/gone.pdf', { title: 'Vanished' }),
  record('docs/note.txt', { title: '', type: 'unknown-kind' }),
];

beforeEach(async () => {
  tmp = await tempDir();
  root = path.join(tmp, 'library');
  dataDir = path.join(root, '.lab');
  for (const [rel, text] of Object.entries(CONTENT)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), text);
  }
  await writeIndex(RECORDS);
});
afterEach(() => removeDir(tmp));

const run = (extra: { onProgress?: (s: ImportJobStatus) => void; signal?: AbortSignal; sourceDir?: string } = {}) =>
  createLegacyImporter({ now: () => new Date('2026-02-01T00:00:00Z') }).run({
    sourceDir: root,
    libraryRoot: root,
    dataDir,
    deviceId: 'device-1',
    ...extra,
  });

describe('legacy importer (synthetic index)', () => {
  it('imports taxonomy, documents and counts, without touching the sources', async () => {
    const before = await snapshot(root);
    const phases: string[] = [];
    const report = await run({ onProgress: (s) => phases.push(s.phase ?? '') });
    const after = await snapshot(root);
    // Only the data dir is new; every other file is byte-identical.
    const outside = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith('.lab')));
    expect(outside(after)).toEqual(outside(before));
    expect(new Set(phases)).toEqual(new Set(['reading', 'taxonomy', 'documents', 'finalizing']));

    expect(report.documents).toBe(4); // 5 records, one is a duplicate of a.pdf
    expect(report.duplicates).toBe(1);
    expect(report.missing).toBe(1);
    expect(report.documentTypes).toBe(3); // 2 listed + 1 found on a document
    expect(report.venues).toBe(2);
    expect(report.nodesByLevel).toMatchObject({ '1': expect.any(Number), '2': 2 });
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it('builds the free-level taxonomy with aliases, multiple parents, implications and groups', async () => {
    await run();
    const tax = await createLibraryStore({ rootPath: root, dataDir, deviceId: 'd' }).readTaxonomy();
    const byLabel = new Map(tax.nodes.map((n) => [n.label, n]));
    const physics = byLabel.get('Physics');
    const data = byLabel.get('Data science');
    const dl = byLabel.get('Deep learning');
    const ml = byLabel.get('Machine learning');
    expect(physics).toMatchObject({ parents: [], aliases: ['Phys'], group: 'macro', origin: 'import', status: 'active' });
    expect(dl?.parents).toEqual([data?.id, physics?.id]);
    expect(dl?.implies).toEqual([ml?.id]);
    expect(dl?.aliases).toEqual(['DL']);
    const odd = byLabel.get('Odd tag');
    expect(odd?.status).toBe('active');
    expect(odd?.legacy).toMatchObject({ status: 'weird', unresolvedImplies: ['Ghost'] });
    expect(odd?.parents).toEqual([]);
    const extra = byLabel.get('Résumé_term');
    expect(extra).toMatchObject({ group: 'extra:Sidecar', origin: 'import', legacy: { group: 'Sidecar', source: 'x/y.pdf' } });
    expect(tax.documentTypes.map((t) => t.label)).toEqual(['paper', 'notes', 'unknown-kind']);
    expect(tax.venues.find((v) => v.name === 'Journal One')?.aliases).toEqual(['J1']);
    expect(tax.legacy).toMatchObject({ imports_done: { a: 1 }, settings: { self_names: ['Someone'] } });
    expect(new Set(tax.nodes.map((n) => n.id)).size).toBe(tax.nodes.length);
  });

  it('maps document fields, tags, AI fields and leftovers', async () => {
    await run();
    const store = createLibraryStore({ rootPath: root, dataDir, deviceId: 'd' });
    const docs = await store.documents.list();
    const tax = await store.readTaxonomy();
    const label = (id: string) => tax.nodes.find((n) => n.id === id)?.label;
    const a = docs.find((d) => d.path === 'docs/a.pdf');
    expect(a?.id).toBe(sha('content-a').slice(0, 16));
    expect(a?.hash).toBe(sha('content-a'));
    expect(a).toMatchObject({
      title: 'Paper A',
      authors: ['Ann Author', 'Bob Writer'],
      year: 2024,
      lang: 'en',
      doi: '10.1000/xyz',
      arxivId: '2401.00001',
      type: 'paper',
      missing: false,
      size: 9,
      ref: { venue: 'J1', venueRef: 'Vol. 3, 12' },
      publication: { status: 'published', source: 'crossref' },
      addedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(a?.ref.venueId).toBe(tax.venues.find((v) => v.name === 'Journal One')?.id);
    // alias-resolved tags; implied ones are not stored as tags
    expect(a?.tags.map(label).sort()).toEqual(['Data science', 'Deep learning', 'Odd tag', 'Physics', 'Résumé_term']);
    expect(a?.ai.summary).toMatchObject({ value: 'A short summary.', meta: { source: 'legacy-import' }, review: { status: 'accepted' } });
    expect(a?.ai.keywords?.value).toEqual(['kw one', 'kw two']);
    expect(a?.legacy).toMatchObject({
      index: { p: 'docs/a.pdf', st: 'ok', tagged: '2026-01-03' },
      tags: { implied: ['Machine learning'], implied_macro: ['Data science'], confidence: 'high', pub_status: 'published', origin: 'unknown' },
    });
    // the duplicate was folded in: tags unioned (Data science comes from it), its record kept
    expect((a?.legacy?.['duplicates'] as { p: string }[])[0]?.p).toBe('docs/copy-of-a.pdf');
    expect(docs.find((d) => d.path === 'docs/copy-of-a.pdf')).toBeUndefined();

    const b = docs.find((d) => d.path === 'docs/b.pdf');
    expect(b?.year).toBe(2023);
    expect(b?.type).toBe('notes');
    expect(b?.ref).toEqual({ venue: 'Unlisted venue' });
    // manual (xt) tags: known one resolved to the same node as the extra tag, unknown one created
    expect(b?.tags.map(label).sort()).toEqual(['Machine learning', 'Résumé_term', 'manual only tag'].sort());
    expect(tax.nodes.find((n) => n.label === 'manual only tag')).toMatchObject({ group: 'extra:manual', origin: 'import' });
    expect(b?.ai.summary).toBeUndefined();
    expect(b?.ai.keywords).toBeUndefined();

    const gone = docs.find((d) => d.path === 'docs/gone.pdf');
    expect(gone).toMatchObject({ missing: true, title: 'Vanished', size: 5 });
    expect(gone?.legacy).toMatchObject({ hashUnknown: true });
    expect(gone?.hash).toMatch(/^[0-9a-f]{64}$/);

    expect(docs.find((d) => d.path === 'docs/note.txt')?.title).toBeNull();
  });

  it('writes scan settings to library.json and one change-log summary', async () => {
    await run();
    const store = createLibraryStore({ rootPath: root, dataDir, deviceId: 'd' });
    expect((await store.readConfig()).scan).toEqual({ extensions: ['pdf', 'txt'], nameOnlyExtensions: ['png'], pruneDeletedDays: 90 });
    const log = await store.readLog();
    const actions = log.map((e) => (e.type === 'change' ? e.action : ''));
    expect(actions).toContain('taxonomy.update');
    expect(actions).toContain('import.legacy');
    expect(actions).not.toContain('document.create');
    expect(log.every((e) => e.type !== 'change' || e.actor === 'import')).toBe(true);
  });

  it('is idempotent and never overwrites later edits', async () => {
    const first = await run();
    const store = createLibraryStore({ rootPath: root, dataDir, deviceId: 'd' });
    const a = (await store.documents.list()).find((d) => d.path === 'docs/a.pdf');
    expect(a).toBeDefined();
    await store.documents.put({ ...(a as NonNullable<typeof a>), title: 'Edited by the user', tags: [] });
    const tax = await store.readTaxonomy();
    await store.writeTaxonomy({ ...tax, nodes: tax.nodes.map((n) => (n.label === 'Physics' ? { ...n, label: 'Physics (renamed)' } : n)) });
    const snap = await snapshot(dataDir);
    const second = await run();
    expect(second.documents).toBe(0);
    expect(second.taxonomyNodes).toBe(0);
    expect(second.skipped).toBe(first.documents + first.duplicates!);
    const afterSnap = await snapshot(dataDir);
    const stripLog = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith('log')));
    expect(stripLog(afterSnap)).toEqual(stripLog(snap));
    expect((await store.documents.list()).find((d) => d.id === a?.id)?.title).toBe('Edited by the user');
  });

  it('accepts the old index folder itself as the source', async () => {
    const report = await run({ sourceDir: path.join(root, '.phd_index') });
    expect(report.documents).toBe(4);
  });

  it('skips unreadable index lines and unsafe paths with warnings', async () => {
    const idx = path.join(root, '.phd_index');
    await writeFile(
      path.join(idx, 'files.jsonl'),
      [JSON.stringify(RECORDS[1]), '{ broken', JSON.stringify(record('../outside.pdf', {})), JSON.stringify(record('/abs.pdf', {}))].join('\n'),
    );
    const report = await run();
    expect(report.documents).toBe(1);
    expect(report.skipped).toBe(3);
    expect(report.warnings.some((w) => w.includes('line 2'))).toBe(true);
  });

  it('fails with a typed error when there is no index, and leaves nothing behind', async () => {
    const empty = path.join(tmp, 'empty');
    await mkdir(empty);
    await expect(createLegacyImporter().run({ sourceDir: empty, libraryRoot: root, dataDir, deviceId: 'device-1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(stat(dataDir)).rejects.toThrow();
  });

  it('does not touch a corrupt existing taxonomy', async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(path.join(dataDir, 'taxonomy.json'), 'garbage');
    await expect(run()).rejects.toBeInstanceOf(AppError);
    expect(await readFile(path.join(dataDir, 'taxonomy.json'), 'utf8')).toBe('garbage');
  });

  it('can be cancelled', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(run({ signal: ctl.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('updates library.json through the updateConfig callback when given, never writing it itself', async () => {
    const store = createLibraryStore({ rootPath: root, dataDir, deviceId: 'd' });
    await store.init();
    const calls: number[] = [];
    let current = await store.readConfig();
    await createLegacyImporter({
      now: () => new Date('2026-02-01T00:00:00Z'),
      updateConfig: async (fn) => {
        calls.push(1);
        current = await fn(current);
      },
    }).run({ sourceDir: root, libraryRoot: root, dataDir, deviceId: 'device-1' });
    expect(calls).toEqual([1]);
    expect(current.scan).toEqual({ extensions: ['pdf', 'txt'], nameOnlyExtensions: ['png'], pruneDeletedDays: 90 });
    // The importer's own store instance is separate; what matters is that library.json on disk still has the defaults,
    // because the caller owns the write.
    expect((await createLibraryStore({ rootPath: root, dataDir, deviceId: 'd' }).readConfig()).scan.extensions).toEqual(['pdf']);
  });

  it('leaves a library.json that the user already changed alone, with or without updateConfig', async () => {
    const store = createLibraryStore({ rootPath: root, dataDir, deviceId: 'd' });
    await store.init();
    const custom = { ...(await store.readConfig()), scan: { extensions: ['md'], nameOnlyExtensions: [] as string[], pruneDeletedDays: 5 } };
    await store.writeConfig(custom);
    let current = custom;
    await createLegacyImporter({ updateConfig: async (fn) => void (current = await fn(current)) }).run({ sourceDir: root, libraryRoot: root, dataDir, deviceId: 'device-1' });
    expect(current.scan).toEqual(custom.scan);
    expect((await store.readConfig()).scan).toEqual(custom.scan);
  });
});
