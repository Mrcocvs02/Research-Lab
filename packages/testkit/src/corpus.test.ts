import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateCorpus, generateIndexableDocuments, pdfContainsText, SENTINEL_WORDS, type Corpus } from './index';

const toClean: Corpus[] = [];
afterEach(async () => {
  for (const c of toClean.splice(0)) await c.cleanup();
});
const abs = (root: string, rel: string) => path.join(root, ...rel.split('/'));

describe('generateCorpus', () => {
  it('writes the documents with the requested PDF share and unique content', async () => {
    const c = await generateCorpus(120, { pdfShare: 0.1 });
    toClean.push(c);
    const m = c.manifest;
    expect(m.files).toHaveLength(120);
    expect(m.pdfCount).toBeGreaterThanOrEqual(10);
    expect(m.pdfCount).toBeLessThanOrEqual(14);
    expect(new Set(m.files.map((f) => f.sha256)).size).toBe(120);
    expect(new Set(m.files.map((f) => f.relPath)).size).toBe(120);
    for (const f of m.files.slice(0, 20)) {
      const buf = await readFile(abs(c.root, f.relPath));
      expect(buf.length).toBe(f.size);
    }
    expect(m.queries).toHaveLength(20);
    for (const q of m.queries) if (q.expectRelPath) expect(m.get(q.expectRelPath)).toBeTruthy();
  });

  it('is deterministic for a given seed and differs across seeds', async () => {
    const a = generateIndexableDocuments(50, { seed: 3 });
    const b = generateIndexableDocuments(50, { seed: 3 });
    const d = generateIndexableDocuments(50, { seed: 4 });
    expect(a.documents.map((x) => x.record.hash)).toEqual(b.documents.map((x) => x.record.hash));
    expect(a.documents.map((x) => x.record.hash)).not.toEqual(d.documents.map((x) => x.record.hash));
  });

  it('places each sentinel in exactly one document, in the declared place and page', async () => {
    const c = await generateCorpus(200, { sentinelPage: 3 });
    toClean.push(c);
    const words = Object.values(SENTINEL_WORDS);
    for (const w of words) {
      const holders = c.manifest.files.filter((f) => [f.title, f.abstract, ...f.pages].join(' ').toLowerCase().includes(w));
      expect(holders, w).toHaveLength(1);
    }
    for (const s of c.manifest.sentinels) {
      const e = c.manifest.get(s.relPath)!;
      expect(e.format).toBe(s.format);
      const where = s.field === 'title' ? e.title : s.field === 'abstract' ? e.abstract : e.pages[s.page - 1]!;
      expect(where.toLowerCase()).toContain(s.word);
      if (s.field === 'body' && s.format === 'pdf') {
        expect(e.pages.length).toBeGreaterThanOrEqual(3);
        for (const [i, p] of e.pages.entries()) expect(p.includes(s.word), `page ${i + 1}`).toBe(i + 1 === s.page);
      }
    }
    // The PDF really holds the sentinel on page 3 (text stream check, whole file).
    const pdf = c.manifest.sentinel('body', 'pdf');
    expect(await pdfContainsText(abs(c.root, pdf.relPath), pdf.word)).toBe(true);
  });

  it('rejects counts too small for the sentinels', async () => {
    await expect(generateCorpus(3)).rejects.toThrow(/count/);
  });

  it('creates 1000 documents in well under 30 seconds', async () => {
    const t0 = performance.now();
    const c = await generateCorpus(1000);
    const ms = performance.now() - t0;
    toClean.push(c);
    console.info(`generateCorpus(1000): ${Math.round(ms)} ms, ${c.manifest.pdfCount} PDF`);
    expect(c.manifest.files).toHaveLength(1000);
    expect(ms).toBeLessThan(30_000);
  }, 60_000);
});

describe('generateIndexableDocuments', () => {
  it('produces records and pages without touching the disk', () => {
    const { documents, manifest } = generateIndexableDocuments(1000);
    expect(documents).toHaveLength(1000);
    expect(new Set(documents.map((d) => d.record.id)).size).toBe(1000);
    const s = manifest.sentinel('body', 'pdf');
    const doc = documents.find((d) => d.record.path === s.relPath)!;
    expect(doc.pages![s.page - 1]!.text).toContain(s.word);
    expect(doc.record.title).toBeTruthy();
  });
});
