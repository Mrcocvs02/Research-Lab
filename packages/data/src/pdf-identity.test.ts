// Identity of a PDF's content (ARCHITETTURA-UI §8.3.6, D-350): appended annotations, by us or by another program,
// do not make the document "changed"; a real change does. Synthetic files only.
import { mkdir, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contentHashOf, defaultLibraryConfig, type DocumentRecord } from '@rl/core';
import { sha256Of } from '@rl/core/node';
import { createScanner, createTextExtractor } from './index.js';
import { HIGHLIGHT, PAGE_WITH_ANNOTS, acrobatStyle, appendRevision, basePdf, stream } from './pdf-annot/test-pdfs.js';
import { createLibraryStore } from './store.js';
import { removeDir, tempDir } from './test-utils.js';

const NOW = new Date('2026-03-01T12:00:00.000Z');
const LATER = new Date('2026-03-02T12:00:00.000Z');
const FILE = 'paper.pdf';

let root: string;
let store: ReturnType<typeof createLibraryStore>;

const scan = async (at = NOW) => {
  const config = defaultLibraryConfig();
  config.scan.extensions = ['pdf', 'txt'];
  return createScanner({ now: () => at }).scan(root, { config, store });
};
const put = (bytes: Buffer) => writeFile(path.join(root, FILE), bytes);
const record = async (): Promise<DocumentRecord> => (await store.documents.list())[0]!;

beforeEach(async () => {
  root = await tempDir('rl-ident-');
  await mkdir(root, { recursive: true });
  store = createLibraryStore({ rootPath: root, deviceId: 'device-test' });
  await store.init();
});
afterEach(async () => removeDir(root));

describe('content identity across annotation appends', () => {
  it('an annotation-only revision by another program keeps the identity: no "changed", base recorded, no inbox flag', async () => {
    const base = basePdf();
    await put(base);
    expect((await scan()).added).toHaveLength(1);
    const first = await record();
    const v2 = acrobatStyle(base);
    await put(v2);
    const res = await scan(LATER);
    expect(res.changed).toEqual([]);
    const rec = await record();
    expect(rec.hash).toBe(sha256Of(v2));
    expect(rec.size).toBe(v2.length);
    expect(rec.pdfWrite?.base).toEqual({ hash: first.hash, size: base.length });
    expect(contentHashOf(rec)).toBe(first.hash);
    expect(rec.inbox).toBeUndefined();
    expect(rec.previousHashes).toEqual([]);
    expect(rec.id).toBe(first.id);
  });

  it('later annotation revisions keep the first base; a second scan with nothing new reads nothing', async () => {
    const base = basePdf();
    await put(base);
    await scan();
    const baseHash = (await record()).hash;
    const v2 = appendRevision(base, [[3, PAGE_WITH_ANNOTS('[5 0 R]')], [5, HIGHLIGHT('rl-1')]]);
    await put(v2);
    await scan(LATER);
    const v3 = appendRevision(v2, [[3, PAGE_WITH_ANNOTS('[5 0 R 6 0 R]')], [6, HIGHLIGHT('rl-2')]]);
    await put(v3);
    const res = await scan(LATER);
    expect(res.changed).toEqual([]);
    const rec = await record();
    expect(rec.hash).toBe(sha256Of(v3));
    expect(contentHashOf(rec)).toBe(baseHash);
    expect((await scan(LATER)).unchanged).toBe(1);
  });

  it('a revision that adds page content is a real change: same id, previous hash kept, flagged, no pdfWrite', async () => {
    const base = basePdf();
    await put(base);
    await scan();
    const first = await record();
    const v2 = appendRevision(base, [[3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 5 0 R >>'], [5, stream('', 'BT (Other text) Tj ET')]]);
    await put(v2);
    const res = await scan(LATER);
    expect(res.changed).toHaveLength(1);
    const rec = await record();
    expect(rec.id).toBe(first.id);
    expect(rec.previousHashes).toContain(first.hash);
    expect(rec.pdfWrite).toBeUndefined();
    expect(contentHashOf(rec)).toBe(sha256Of(v2));
    expect(rec.inbox?.reason).toBe('changed');
  });

  it('a content change after an annotation also remembers the base hash, and drops pdfWrite', async () => {
    const base = basePdf();
    await put(base);
    await scan();
    const baseHash = (await record()).hash;
    await put(appendRevision(base, [[3, PAGE_WITH_ANNOTS('[5 0 R]')], [5, HIGHLIGHT('rl-1')]]));
    await scan(LATER);
    await put(basePdf('BT (Completely different) Tj ET')); // a full save by someone else: the prefix is gone
    const res = await scan(LATER);
    expect(res.changed).toHaveLength(1);
    const rec = await record();
    expect(rec.pdfWrite).toBeUndefined();
    expect(rec.previousHashes).toContain(baseHash);
  });

  it('a file whose hash is one of our own writes (pdfWrite.own) is ours: no "changed", even without looking inside', async () => {
    const base = basePdf();
    await put(base);
    await scan();
    const first = await record();
    const written = Buffer.concat([base, Buffer.from('\n% bytes of our own write, never classified\n')]);
    await store.documents.update(first.id, (cur) => ({ ...cur!, pdfWrite: { base: { hash: first.hash, size: base.length }, own: [{ hash: sha256Of(written), size: written.length, at: NOW.toISOString() }] } }));
    await put(written);
    const res = await scan(LATER);
    expect(res.changed).toEqual([]);
    const rec = await record();
    expect(rec.hash).toBe(sha256Of(written));
    expect(contentHashOf(rec)).toBe(first.hash);
  });

  it('restoring the base (truncation) keeps the identity and the pdfWrite record', async () => {
    const base = basePdf();
    await put(base);
    await scan();
    const baseHash = (await record()).hash;
    await put(appendRevision(base, [[3, PAGE_WITH_ANNOTS('[5 0 R]')], [5, HIGHLIGHT('rl-1')]]));
    await scan(LATER);
    await truncate(path.join(root, FILE), base.length);
    const res = await scan(LATER);
    expect(res.changed).toEqual([]);
    const rec = await record();
    expect(rec.hash).toBe(baseHash);
    expect(rec.pdfWrite?.base.hash).toBe(baseHash);
  });

  it('a file that merely grew (garbage after %%EOF) is a change, as before', async () => {
    const base = basePdf();
    await put(base);
    await scan();
    await put(Buffer.concat([base, Buffer.from('appended garbage')]));
    expect((await scan(LATER)).changed).toHaveLength(1);
  });
});

describe('text cache key', () => {
  it('stores the text under the content hash too, and reports no mismatch for a file we annotated', async () => {
    const cacheDir = path.join(root, '..', `${path.basename(root)}-cache`);
    try {
      const ex = createTextExtractor({ cacheDir });
      await writeFile(path.join(root, 'a.txt'), 'some searchable text');
      const content = 'a'.repeat(64);
      const r = await ex.extract(root, 'a.txt', { hash: content, contentHash: content });
      expect(r.hash).toBe(content);
      expect(r.hashMismatch).toBeUndefined();
      expect(JSON.parse(await readFile(path.join(cacheDir, `${content}.json`), 'utf8')).result.pages.length).toBeGreaterThan(0);
      const again = await ex.extract(root, 'a.txt', { hash: content });
      expect(again.fromCache).toBe(true);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
