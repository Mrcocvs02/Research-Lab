import { copyFile, mkdir, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError, defaultLibraryConfig, documentIdFromHash, type ScanOptions, type ScanProgress, type ScanResult } from '@rl/core';
import { sha256File } from '@rl/core/node';
import { createFixtureLibrary, diffSnapshots, formatDiff, fsPath, snapshotTree, type FixtureLibrary } from '@rl/testkit';
import { createScanner, type FileLibraryStore } from './index.js';
import { createLibraryStore } from './store.js';

const NOW = new Date('2026-03-01T12:00:00.000Z');
const LATER = new Date('2026-03-02T12:00:00.000Z');

interface Ctx {
  lib: FixtureLibrary;
  store: FileLibraryStore;
  hashed: string[];
  scan(extra?: Partial<ScanOptions>, at?: Date): Promise<ScanResult>;
  abs(rel: string): string;
  config: ReturnType<typeof defaultLibraryConfig>;
}

async function setup(kind: 'full' | 'papers' = 'full'): Promise<Ctx> {
  const lib = await createFixtureLibrary(kind);
  const store = createLibraryStore({ rootPath: lib.root, deviceId: 'device-test' });
  await store.init();
  const config = defaultLibraryConfig();
  config.scan.extensions = ['pdf', 'md', 'txt', 'tex'];
  const hashed: string[] = [];
  const ctx: Ctx = {
    lib,
    store,
    hashed,
    config,
    abs: (rel) => path.join(lib.root, ...rel.split('/')),
    scan: (extra = {}, at = NOW) =>
      createScanner({
        now: () => at,
        hashFile: async (file, signal) => {
          hashed.push(path.relative(lib.root, file).split(path.sep).join('/'));
          return sha256File(fsPath(file), signal);
        },
      }).scan(lib.root, { config: ctx.config, store, ...extra }),
  };
  return ctx;
}

const write = (p: string, data: string | Uint8Array) => mkdir(fsPath(path.dirname(p)), { recursive: true }).then(() => writeFile(fsPath(p), data));

describe('scanner', () => {
  let c: Ctx;
  beforeEach(async () => {
    c = await setup();
  });
  afterEach(async () => c.lib.cleanup());

  it('creates one record per file with the content hash as id, stable path and size (accents and a 260+ char path included)', async () => {
    const res = await c.scan();
    const m = c.lib.manifest.files;
    expect(res.errors).toEqual([]);
    expect(res.cancelled).toBe(false);
    expect(res.added).toHaveLength(m.length);
    expect(res.unchanged + res.changed.length + res.moved.length + res.missing.length).toBe(0);
    expect(m.some((f) => f.relPath.length > 200 && path.join(c.lib.root, f.relPath).length > 260)).toBe(true);
    const docs = await c.store.documents.list();
    expect(docs).toHaveLength(m.length);
    for (const f of m) {
      const d = docs.find((x) => x.path === f.relPath);
      expect(d, f.relPath).toBeDefined();
      expect(d?.id).toBe(f.sha256.slice(0, 16));
      expect(d?.hash).toBe(f.sha256);
      expect(d?.size).toBe(f.size);
      expect(d?.missing).toBe(false);
      expect(d?.tags).toEqual([]); // no automatic tags
      expect(d?.title).toBeNull();
      expect(d?.inbox).toEqual({ since: NOW.toISOString(), reason: 'new' });
    }
    expect(c.store.issues()).toEqual([]);
  });

  it('never writes outside the data dir and never modifies an original', async () => {
    const before = await snapshotTree(c.lib.root, { exclude: ['.lab'] });
    await c.scan();
    await rename(c.abs('misc/notes.md'), c.abs('misc/renamed-notes.md')).catch(() => {});
    await rename(c.abs('misc/renamed-notes.md'), c.abs('misc/notes.md'));
    await c.scan({}, LATER);
    const after = await snapshotTree(c.lib.root, { exclude: ['.lab'] });
    const diff = diffSnapshots(before, after);
    expect(diff.clean, formatDiff(diff)).toBe(true);
  });

  it('skips the data dir, excluded folders, hidden folders and unconfigured extensions', async () => {
    await write(c.abs('.hidden/secret.pdf'), 'hidden');
    await write(c.abs('papers/.cache/x.pdf'), 'hidden2');
    await write(c.abs('.lab/stray.pdf'), 'in the data dir');
    await write(c.abs('misc/photo.png'), 'not configured');
    await write(c.abs('misc/~$lock.md'), 'office lock file');
    await write(c.abs('skipme/deep/a.pdf'), 'excluded');
    c.config.excludedFolders = ['skipme', 'Area A/Subtopic 1'];
    const res = await c.scan();
    const paths = res.added.map((f) => f.path);
    expect(paths.some((p) => p.startsWith('.hidden') || p.includes('/.cache/') || p.startsWith('.lab') || p.startsWith('skipme') || p.startsWith('Area A/Subtopic 1'))).toBe(false);
    expect(paths).not.toContain('misc/photo.png');
    expect(paths).not.toContain('misc/~$lock.md');
    expect(paths).toContain('Area A/Subtopic 2/another-nested.pdf');
    // Hidden folders can be switched on; the data dir stays out.
    const again = await c.scan({ includeHiddenFolders: true }, LATER);
    expect(again.added.map((f) => f.path).sort()).toEqual(['.hidden/secret.pdf', 'papers/.cache/x.pdf']);
  });

  it('is incremental: unchanged files are not read at all', async () => {
    await c.scan();
    expect(c.hashed.length).toBeGreaterThan(10);
    c.hashed.length = 0;
    const res = await c.scan({}, LATER);
    expect(c.hashed).toEqual([]);
    expect(res.unchanged).toBe(c.lib.manifest.files.length);
    expect(res.added.length + res.changed.length + res.moved.length + res.missing.length + res.duplicates.length).toBe(0);
    // And it wrote nothing: revisions are untouched.
    for (const d of await c.store.documents.list()) expect(d.revision).toBe(0);
  });

  it('uses the records handed in as `known` instead of listing the store', async () => {
    await c.scan();
    const known = await c.store.documents.list();
    c.hashed.length = 0;
    const res = await c.scan({ known }, LATER);
    expect(c.hashed).toEqual([]);
    expect(res.unchanged).toBe(known.length);
  });

  it('detects a modified file: same id, previous hash kept, flagged as changed', async () => {
    await c.scan({ markInbox: false });
    const rel = 'papers/paper-01.pdf';
    const before = (await c.store.documents.list()).find((d) => d.path === rel)!;
    await write(c.abs(rel), Buffer.concat([await readFile(c.abs(rel)), Buffer.from('\n% edited')]));
    c.hashed.length = 0;
    const res = await c.scan({}, LATER);
    expect(c.hashed).toEqual([rel]);
    expect(res.changed).toHaveLength(1);
    expect(res.changed[0]?.docId).toBe(before.id);
    expect(res.added.length + res.moved.length + res.missing.length).toBe(0);
    const after = (await c.store.documents.get(before.id))!;
    expect(after.id).toBe(before.id);
    expect(after.hash).not.toBe(before.hash);
    expect(after.hash).toBe(await sha256File(fsPath(c.abs(rel))));
    expect(after.previousHashes).toEqual([before.hash]);
    expect(after.inbox).toEqual({ since: LATER.toISOString(), reason: 'changed' });
    expect(after.size).toBe(before.size + 9);
    expect(after.revision).toBe(before.revision + 1);
    // A second edit appends to the history.
    await write(c.abs(rel), 'third version');
    await c.scan({}, LATER);
    const third = (await c.store.documents.get(before.id))!;
    expect(third.previousHashes).toEqual([before.hash, after.hash]);
    expect(third.inbox?.since).toBe(LATER.toISOString());
  });

  it('a new timestamp with the same content is read once and is not a change', async () => {
    await c.scan();
    const rel = 'misc/notes.md';
    await utimes(fsPath(c.abs(rel)), new Date('2020-01-01'), new Date('2020-01-01'));
    c.hashed.length = 0;
    const res = await c.scan({}, LATER);
    expect(c.hashed).toEqual([rel]);
    expect(res.changed).toEqual([]);
    expect(res.unchanged).toBe(c.lib.manifest.files.length);
    const d = (await c.store.documents.list()).find((x) => x.path === rel)!;
    expect(d.mtimeMs).toBe(new Date('2020-01-01').getTime());
    c.hashed.length = 0;
    await c.scan({}, LATER);
    expect(c.hashed).toEqual([]);
  });

  it('recognises a renamed or moved file by its hash and keeps the history', async () => {
    await c.scan();
    const from = 'papers/paper-02.pdf';
    const to = 'moved here/Paper 02 — è.pdf';
    const old = (await c.store.documents.list()).find((d) => d.path === from)!;
    await mkdir(c.abs('moved here'), { recursive: true });
    await rename(c.abs(from), c.abs(to));
    c.hashed.length = 0;
    const res = await c.scan({}, LATER);
    expect(c.hashed).toEqual([to]); // only the new path is read
    expect(res.moved).toEqual([expect.objectContaining({ docId: old.id, from, file: expect.objectContaining({ path: to }) })]);
    expect(res.added.length + res.missing.length + res.duplicates.length).toBe(0);
    const d = (await c.store.documents.get(old.id))!;
    expect(d.path).toBe(to);
    expect(d.pathHistory).toEqual([{ path: from, seenUntil: LATER.toISOString() }]);
    expect(d.hash).toBe(old.hash);
    expect(d.missing).toBe(false);
    expect(await c.store.documents.listIds()).toHaveLength(c.lib.manifest.files.length);
  });

  it('a copy goes to aliasPaths, never a new document; copies are known on later scans', async () => {
    await c.scan();
    const src = 'papers/paper-03.pdf';
    const copy = 'backup/copy of paper-03.pdf';
    const orig = (await c.store.documents.list()).find((d) => d.path === src)!;
    await mkdir(c.abs('backup'), { recursive: true });
    await copyFile(c.abs(src), c.abs(copy));
    const res = await c.scan({}, LATER);
    expect(res.duplicates).toEqual([{ docId: orig.id, path: copy }]);
    expect(res.added).toEqual([]);
    expect((await c.store.documents.get(orig.id))!.aliasPaths).toEqual([copy]);
    expect(await c.store.documents.listIds()).toHaveLength(c.lib.manifest.files.length);
    // Known now: no reading, no change.
    c.hashed.length = 0;
    const again = await c.scan({}, LATER);
    expect(c.hashed).toEqual([]);
    expect(again.duplicates).toEqual([]);
    expect((await c.store.documents.get(orig.id))!.revision).toBe(orig.revision + 1);
    // The copy disappears: the alias goes away quietly, the document is not missing.
    await rm(c.abs(copy));
    const gone = await c.scan({}, LATER);
    expect(gone.missing).toEqual([]);
    expect((await c.store.documents.get(orig.id))!.aliasPaths).toEqual([]);
    expect((await c.store.documents.get(orig.id))!.missing).toBe(false);
  });

  it('when the original is deleted but a copy remains, the copy becomes the path', async () => {
    await c.scan();
    const src = 'papers/paper-04.pdf';
    const copy = 'backup/p4.pdf';
    const orig = (await c.store.documents.list()).find((d) => d.path === src)!;
    await mkdir(c.abs('backup'), { recursive: true });
    await copyFile(c.abs(src), c.abs(copy));
    await c.scan({}, LATER);
    await rm(c.abs(src));
    const res = await c.scan({}, LATER);
    expect(res.missing).toEqual([]);
    expect(res.moved).toHaveLength(1);
    const d = (await c.store.documents.get(orig.id))!;
    expect(d.path).toBe(copy);
    expect(d.aliasPaths).toEqual([]);
    expect(d.pathHistory.map((h) => h.path)).toEqual([src]);
    expect(d.missing).toBe(false);
  });

  it('copies already listed in aliasPaths by the importer are known files, not new documents (D-032)', async () => {
    await c.scan();
    const src = 'Area A/Subtopic 2/another-nested.pdf';
    const copy = 'elsewhere/paper-05-copy.pdf';
    const orig = (await c.store.documents.list()).find((d) => d.path === src)!;
    await mkdir(c.abs('elsewhere'), { recursive: true });
    await copyFile(c.abs(src), c.abs(copy));
    await c.store.documents.update(orig.id, (d) => ({ ...d!, aliasPaths: [copy] }));
    c.hashed.length = 0;
    const res = await c.scan({}, LATER);
    expect(c.hashed).toEqual([]);
    expect(res.added).toEqual([]);
    expect(res.duplicates).toEqual([]);
  });

  it('marks a vanished file missing without ever deleting the record, and restores it when it is back', async () => {
    await c.scan();
    const rel = 'misc/readme.txt';
    const orig = (await c.store.documents.list()).find((d) => d.path === rel)!;
    const content = await readFile(c.abs(rel));
    await rm(c.abs(rel));
    const res = await c.scan({}, LATER);
    expect(res.missing).toEqual([orig.id]);
    const d = (await c.store.documents.get(orig.id))!;
    expect(d.missing).toBe(true);
    expect(d.path).toBe(rel);
    expect(d.tags).toEqual(orig.tags);
    // Reported once; a second scan neither re-reports it nor rewrites the record.
    const again = await c.scan({}, LATER);
    expect(again.missing).toEqual([]);
    expect((await c.store.documents.get(orig.id))!.revision).toBe(d.revision);
    // Back with the same content (new mtime): restored, same id.
    await writeFile(c.abs(rel), content);
    const back = await c.scan({}, LATER);
    expect(back.restored).toEqual([orig.id]);
    expect(back.added).toEqual([]);
    expect((await c.store.documents.get(orig.id))!.missing).toBe(false);
  });

  it('documents in a folder that became excluded are left alone, not marked missing', async () => {
    await c.scan();
    c.config.excludedFolders = ['papers'];
    const res = await c.scan({}, LATER);
    expect(res.missing).toEqual([]);
    expect((await c.store.documents.list()).some((d) => d.missing)).toBe(false);
  });

  it('keeps going past an unreadable file and reports it with path and reason', async () => {
    const bad = 'Über naïve Größen/Doc with spaces   and  accents èàü.pdf';
    const scanner = createScanner({
      now: () => NOW,
      retry: { attempts: 1 },
      hashFile: async (file) => {
        if (file.endsWith('èàü.pdf')) throw new AppError('IO_ERROR', 'locked', { code: 'EBUSY' });
        return sha256File(fsPath(file));
      },
    });
    const res = await scanner.scan(c.lib.root, { config: c.config, store: c.store });
    expect(res.errors).toEqual([{ path: bad, reason: expect.stringContaining('EBUSY') }]);
    expect(res.added).toHaveLength(c.lib.manifest.files.length - 1);
    // Next time it is read normally.
    const res2 = await c.scan({}, LATER);
    expect(res2.added.map((f) => f.path)).toEqual([bad]);
  });

  it('does not mark a file missing when its folder cannot be listed right now', async () => {
    await c.scan();
    // Simulated by a scan restricted to a path that does not exist: nothing known lives there.
    const res = await c.scan({ paths: ['no/such/folder'] }, LATER);
    expect(res.missing).toEqual([]);
    expect(res.errors).toEqual([]);
  });

  it('can be cancelled with an AbortSignal and reports progress', async () => {
    const ac = new AbortController();
    const phases: ScanProgress['phase'][] = [];
    const res = await c.scan({
      signal: ac.signal,
      onProgress: (p) => {
        phases.push(p.phase);
        if (p.phase === 'hashing' && p.seen >= 3) ac.abort();
      },
    });
    expect(res.cancelled).toBe(true);
    expect(phases).toContain('walking');
    expect(phases).toContain('hashing');
    expect(phases.at(-1)).toBe('done');
    // Nothing half-written: a following scan completes the job.
    const full = await c.scan({}, LATER);
    expect(full.cancelled).toBe(false);
    expect(await c.store.documents.listIds()).toHaveLength(c.lib.manifest.files.length);
    expect(c.store.issues()).toEqual([]);
    const pre = new AbortController();
    pre.abort();
    expect((await c.scan({ signal: pre.signal }, LATER)).cancelled).toBe(true);
  });

  it('scans only the given paths (files or folders), including renames and deletions', async () => {
    await c.scan();
    const a = 'papers/paper-01.pdf';
    const b = 'papers/paper-02.pdf';
    await write(c.abs(a), 'changed a');
    await write(c.abs(b), 'changed b');
    c.hashed.length = 0;
    const res = await c.scan({ paths: [a] }, LATER);
    expect(c.hashed).toEqual([a]);
    expect(res.changed.map((x) => x.file.path)).toEqual([a]);
    expect(res.unchanged).toBe(0);
    // A deleted file named in the batch is marked missing; others are untouched.
    await rm(c.abs('misc/draft.tex'));
    await rm(c.abs('misc/notes.md'));
    const del = await c.scan({ paths: ['misc/draft.tex'] }, LATER);
    expect(del.missing).toHaveLength(1);
    expect((await c.store.documents.list()).filter((d) => d.missing).map((d) => d.path)).toEqual(['misc/draft.tex']);
    // A renamed folder: old and new names in the batch give a move for every file inside.
    await rename(c.abs('Area A'), c.abs('Area B'));
    const mv = await c.scan({ paths: ['Area A', 'Area B'] }, LATER);
    expect(mv.moved.map((m) => m.file.path).sort()).toEqual(['Area B/Subtopic 1/Deeper level/Third level/nested-paper.pdf', 'Area B/Subtopic 2/another-nested.pdf']);
    expect(mv.missing).toEqual([]);
    // Only the new name of a moved file in the batch (old one never mentioned): still a move, not a copy.
    await rename(c.abs('papers/paper-03.pdf'), c.abs('papers/three.pdf'));
    const solo = await c.scan({ paths: ['papers/three.pdf'] }, LATER);
    expect(solo.moved).toHaveLength(1);
    expect(solo.duplicates).toEqual([]);
    // Paths outside the root or with traversal are refused, not followed.
    const bad = await c.scan({ paths: ['../x.pdf', '/abs.pdf'] }, LATER);
    expect(bad.errors.map((e) => e.reason)).toEqual(['path not allowed', 'path not allowed']);
  });

  it('a hash the importer could not know is filled in without calling it a change', async () => {
    await c.scan();
    const rel = 'scans/scanned-only-image.pdf';
    const d = (await c.store.documents.list()).find((x) => x.path === rel)!;
    await c.store.documents.update(d.id, (cur) => ({ ...cur!, hash: 'a'.repeat(64), missing: true, legacy: { hashUnknown: true, keep: 1 } }));
    const res = await c.scan({}, LATER);
    expect(res.changed).toEqual([]);
    expect(res.restored).toEqual([d.id]);
    const after = (await c.store.documents.get(d.id))!;
    expect(after.hash).toBe(d.hash);
    expect(after.previousHashes).toEqual([]);
    expect(after.legacy).toEqual({ keep: 1 });
    expect(after.missing).toBe(false);
  });

  it('gives a new document whose id is already taken by an older version a different, deterministic id', async () => {
    await c.scan();
    const rel = 'hostile/hidden-instructions.pdf';
    const d = (await c.store.documents.list()).find((x) => x.path === rel)!;
    const original = await readFile(c.abs(rel));
    await write(c.abs(rel), 'second version of paper 8');
    await c.scan({}, LATER); // the record now has the original hash only in previousHashes
    await write(c.abs('other/old-version.pdf'), original);
    const res = await c.scan({}, LATER);
    expect(res.errors).toEqual([]);
    expect(res.added).toHaveLength(1);
    const newId = res.added[0]!.docId!;
    expect(newId).not.toBe(d.id);
    expect(newId).toMatch(/^[0-9a-f]{16}$/);
    expect((await c.store.documents.get(newId))!.path).toBe('other/old-version.pdf');
    expect((await c.store.documents.get(d.id))!.path).toBe(rel);
    expect(documentIdFromHash(d.hash)).toBe(d.id);
  });
});
