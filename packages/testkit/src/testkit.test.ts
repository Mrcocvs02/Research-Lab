import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFixtureLibrary,
  diffSnapshots,
  fsPath,
  listTree,
  pdfContainsText,
  pdfStreamsText,
  realFixtureSkipReason,
  saveSnapshot,
  snapshotTree,
  withRealFixtureCopy,
  type FixtureLibrary,
} from './index';

const toClean: FixtureLibrary[] = [];
async function lib(kind: Parameters<typeof createFixtureLibrary>[0], opts?: Parameters<typeof createFixtureLibrary>[1]) {
  const l = await createFixtureLibrary(kind, opts);
  toClean.push(l);
  return l;
}
afterEach(async () => {
  for (const l of toClean.splice(0)) await l.cleanup();
});

const abs = (root: string, rel: string) => path.join(root, ...rel.split('/'));

describe('snapshotTree / diffSnapshots', () => {
  it('detects added, removed, modified and touched files and honours exclusions', async () => {
    const { root } = await lib('papers');
    await mkdir(path.join(root, '.lab'));
    await writeFile(path.join(root, '.lab', 'data.json'), '{}');
    const exclude = ['.lab', 'exports'];
    const a = await snapshotTree(root, { exclude });
    expect(Object.keys(a).some((k) => k.startsWith('.lab'))).toBe(false);
    const target = path.join(root, 'papers', 'paper-01.pdf');
    const keep = await readFile(target);

    // changes inside excluded folders are invisible
    await writeFile(path.join(root, '.lab', 'data.json'), '{"x":1}');
    await mkdir(path.join(root, 'exports'));
    await writeFile(path.join(root, 'exports', 'out.md'), 'x');
    expect(diffSnapshots(a, await snapshotTree(root, { exclude })).clean).toBe(true);

    // content change
    await writeFile(target, Buffer.concat([keep, Buffer.from('x')]));
    let d = diffSnapshots(a, await snapshotTree(root, { exclude }));
    expect(d.clean).toBe(false);
    expect(d.modified).toEqual(['papers/paper-01.pdf']);

    // restoring the content with a different mtime is only "touched"
    await writeFile(target, keep);
    await utimes(target, new Date(2001, 1, 1), new Date(2001, 1, 1));
    d = diffSnapshots(a, await snapshotTree(root, { exclude }));
    expect(d.clean).toBe(true);
    expect(d.touched).toEqual(['papers/paper-01.pdf']);

    // add and remove
    await writeFile(path.join(root, 'new.txt'), 'n');
    await rm(path.join(root, 'papers', 'paper-02.pdf'));
    d = diffSnapshots(a, await snapshotTree(root, { exclude }));
    expect(d.added).toEqual(['new.txt']);
    expect(d.removed).toEqual(['papers/paper-02.pdf']);
  });

  it('CLI saves, compares and detects a deliberate change; --run wraps a command', async () => {
    const { root } = await lib('papers');
    await mkdir(path.join(root, '.lab'));
    const snap = path.join(root, '..', 'snap.json');
    const cli = path.resolve(import.meta.dirname, '../../../tools/check-nondestructive.mjs');
    const run = (...a: string[]) => spawnSync(process.execPath, [cli, root, '--exclude', '.lab', ...a], { encoding: 'utf8' });
    expect(run('--snapshot', snap, '--save').status).toBe(0);
    expect(run('--snapshot', snap).status).toBe(0);
    await writeFile(path.join(root, '.lab', 'x.json'), '{}');
    expect(run('--snapshot', snap).status).toBe(0);
    await writeFile(path.join(root, 'papers', 'paper-03.pdf'), 'tampered');
    const bad = run('--snapshot', snap);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('modified: papers/paper-03.pdf');

    // --run: the command is a node one-liner that writes (or not) inside the library
    const { root: root2 } = await lib('papers');
    const okRun = spawnSync(process.execPath, [cli, root2, '--run', `"${process.execPath}" -e "0"`], { encoding: 'utf8' });
    expect(okRun.status).toBe(0);
    const writer = path.join(root2, '..', 'writer.cjs');
    await writeFile(writer, "require('fs').writeFileSync(require('path').join(process.argv[2], 'papers', 'new.pdf'), 'x');");
    const badRun = spawnSync(process.execPath, [cli, root2, '--run', `"${process.execPath}" "${writer}" "${root2}"`], { encoding: 'utf8' });
    expect(badRun.status).toBe(1);
    expect(badRun.stderr).toContain('added: papers/new.pdf');
  });

  it('a saved snapshot holds relative paths only', async () => {
    const { root } = await lib('papers');
    const file = path.join(root, '..', 'snap2.json');
    await saveSnapshot(file, await snapshotTree(root));
    const data = JSON.parse(await readFile(file, 'utf8')) as { snapshot: Record<string, unknown> };
    for (const key of Object.keys(data.snapshot)) expect(path.isAbsolute(key)).toBe(false);
  });
});

describe('createFixtureLibrary', () => {
  it('full library: manifest matches the files on disk', async () => {
    const l = await lib('full');
    expect(await listTree(l.root)).toEqual(l.manifest.files.map((f) => f.relPath).sort());
    const snap = await snapshotTree(l.root);
    for (const f of l.manifest.files) {
      expect(snap[f.relPath]?.sha256, f.relPath).toBe(f.sha256);
      expect(snap[f.relPath]?.size).toBe(f.size);
    }
    for (const d of l.manifest.dirs) expect(snap[d + '/'], d).toBeTruthy();
  });

  it('normal papers carry title, authors, abstract, arXiv id and DOI in text and metadata', async () => {
    const l = await lib('papers');
    expect(l.manifest.byKind('paper').length).toBeGreaterThanOrEqual(3);
    for (const e of l.manifest.byKind('paper')) {
      const file = abs(l.root, e.relPath);
      const doc = await PDFDocument.load(await readFile(file));
      expect(doc.getTitle()).toBe(e.title);
      expect(doc.getAuthor()).toBe(e.authors!.join('; '));
      expect(doc.getKeywords()).toContain(e.arxivId);
      expect(doc.getKeywords()).toContain(e.doi);
      expect(doc.getPageCount()).toBe(e.pages);
      expect(await pdfContainsText(file, `arXiv:${e.arxivId}`)).toBe(true);
      expect(await pdfContainsText(file, `doi:${e.doi}`)).toBe(true);
      expect(await pdfContainsText(file, e.title!)).toBe(true);
    }
    const ids = l.manifest.files.map((f) => f.arxivId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('edge library: scanned PDF has an image and no text', async () => {
    const l = await lib('edge');
    const [scan] = l.manifest.byKind('scanned');
    expect(scan?.hasText).toBe(false);
    const file = abs(l.root, scan!.relPath);
    const bytes = (await readFile(file)).toString('latin1');
    expect(bytes).toContain('/Subtype /Image');
    expect(bytes).not.toContain('/BaseFont');
    expect(await pdfStreamsText(file)).not.toContain(' Tj');
  });

  it('edge library: accents, spaces, nesting, non-PDF files, long path', async () => {
    const l = await lib('edge');
    const accented = l.manifest.byKind('accented').map((e) => e.relPath).join('|');
    expect(accented).toMatch(/[èàü]/);
    expect(accented).toContain(' ');
    expect(Math.max(...l.manifest.byKind('nested').map((e) => e.relPath.split('/').length))).toBeGreaterThanOrEqual(5);
    expect(l.manifest.files.filter((f) => ['md', 'txt', 'tex'].includes(f.format)).map((f) => f.format).sort()).toEqual(['md', 'tex', 'txt']);
    const long = l.manifest.byKind('long-path')[0]!;
    expect(abs(l.root, long.relPath).length).toBeGreaterThan(260);
    expect(await listTree(l.root)).toContain(long.relPath);
  });

  it('can skip the long path', async () => {
    const l = await lib('edge', { longPath: false });
    expect(l.manifest.byKind('long-path')).toEqual([]);
  });

  it('hostile PDF hides instructions in white and tiny text and in the metadata', async () => {
    const l = await lib('edge');
    const h = l.manifest.byKind('hostile')[0]!;
    expect(h.hostile?.canary).toMatch(/^RL-CANARY-[0-9a-f]{12}$/);
    const file = abs(l.root, h.relPath);
    expect(await pdfContainsText(file, 'IGNORE ALL PREVIOUS INSTRUCTIONS')).toBe(true);
    expect(await pdfContainsText(file, h.hostile!.canary)).toBe(true);
    const raw = await pdfStreamsText(file);
    expect(raw).toContain('1 1 1 rg'); // white fill colour for the hidden line
    const doc = await PDFDocument.load(await readFile(file));
    expect(doc.getSubject()).toContain('IGNORE ALL PREVIOUS INSTRUCTIONS');
  });

  it('it and en libraries differ in language, titles and folders', async () => {
    const it = await lib('it');
    const en = await lib('en');
    expect(it.manifest.language).toBe('it');
    expect(en.manifest.language).toBe('en');
    expect(it.manifest.files.every((f) => f.language === 'it')).toBe(true);
    const titles = new Set(it.manifest.files.map((f) => f.title));
    for (const f of en.manifest.files) expect(titles.has(f.title)).toBe(false);
    expect(it.manifest.dirs).not.toEqual(en.manifest.dirs);
  });

  it('is deterministic for the same seed and cleanup removes everything, including the long path', async () => {
    const a = await createFixtureLibrary('full', { seed: 3 });
    const b = await lib('full', { seed: 3 });
    const strip = (m: typeof a.manifest) => m.files.map((f) => [f.relPath, f.sha256]);
    expect(strip(a.manifest)).toEqual(strip(b.manifest));
    await a.cleanup();
    await expect(readFile(fsPath(path.join(a.root, 'papers', 'paper-01.pdf')))).rejects.toThrow();
    await expect(listTree(a.root)).rejects.toThrow();
  });
});

describe('withRealFixtureCopy', () => {
  it('returns null without the variable', async () => {
    expect(await withRealFixtureCopy({ env: {} })).toBeNull();
    expect(realFixtureSkipReason({})).toContain('RL_FIXTURE_LIBRARY');
  });

  it('copies the folder without .lab and never touches the source', async () => {
    const src = await lib('papers');
    await mkdir(path.join(src.root, '.lab'));
    await writeFile(path.join(src.root, '.lab', 'secret.json'), '{}');
    const before = await snapshotTree(src.root);
    const copy = await withRealFixtureCopy({ env: { RL_FIXTURE_LIBRARY: src.root } });
    expect(copy).not.toBeNull();
    try {
      const files = await listTree(copy!.root);
      expect(files.some((f) => f.startsWith('.lab'))).toBe(false);
      expect(files).toEqual((await listTree(src.root)).filter((f) => !f.startsWith('.lab')));
      await writeFile(path.join(copy!.root, 'papers', 'paper-01.pdf'), 'changed in the copy');
    } finally {
      await copy!.cleanup();
    }
    const diff = diffSnapshots(before, await snapshotTree(src.root));
    expect(diff.clean).toBe(true);
    expect(diff.touched).toEqual([]);
  });
});
