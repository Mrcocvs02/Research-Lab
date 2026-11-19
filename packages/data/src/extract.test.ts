import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '@rl/core';
import { createFixtureLibrary, type FixtureLibrary } from '@rl/testkit';
import { arxivYear, cleanDoi, createTextExtractor, findArxivIds, findDois } from './index.js';
import { removeDir, tempDir } from './test-utils.js';

describe('identifier regexes', () => {
  it('cleans trailing punctuation and unbalanced brackets from DOIs', () => {
    expect(cleanDoi('10.1000/abc.def.')).toBe('10.1000/abc.def');
    expect(cleanDoi('10.1000/abc(1)')).toBe('10.1000/abc(1)');
    expect(cleanDoi('10.1000/abc)')).toBe('10.1000/abc');
    expect(cleanDoi('10.1000/abc),')).toBe('10.1000/abc');
    expect(cleanDoi('10.1000/a;b;')).toBe('10.1000/a;b');
  });
  it('finds labelled and bare DOIs in running text', () => {
    const t = 'See (doi:10.1234/xyz.5678). Also https://doi.org/10.5555/AbC-1_2, and 10.9999/last.';
    expect(findDois(t).map((d) => d.doi)).toEqual(['10.1234/xyz.5678', '10.5555/AbC-1_2', '10.9999/last']);
    expect(findDois(t).map((d) => d.labelled)).toEqual([true, true, false]);
    expect(findDois('abc110.1234/xyz')).toEqual([]);
  });
  it('finds new and old arXiv ids with versions', () => {
    expect(findArxivIds('arXiv:2401.01120v3 [cs.LG] 3 Jan 2024')).toEqual([{ id: '2401.01120', version: 3 }]);
    expect(findArxivIds('arXiv: 1501.0001 and arxiv.org/abs/hep-th/9901001v2')).toEqual([{ id: '1501.0001' }, { id: 'hep-th/9901001', version: 2 }]);
    expect(findArxivIds('arXiv:math.GT/0309136')).toEqual([{ id: 'math.GT/0309136' }]);
    expect(findArxivIds('number 2401.01120 alone')).toEqual([]);
    expect(arxivYear('2401.01120')).toBe(2024);
    expect(arxivYear('hep-th/9901001')).toBe(1999);
    expect(arxivYear('math.GT/0309136')).toBe(2003);
  });
});

describe('text extraction on a synthetic library', () => {
  let lib: FixtureLibrary;
  let cache: string;
  beforeAll(async () => {
    lib = await createFixtureLibrary('full');
    cache = await tempDir('rl-textcache-');
  });
  afterAll(async () => {
    await lib.cleanup();
    await removeDir(cache);
  });

  it('extracts title, authors, DOI and arXiv id of every text PDF as in the manifest', async () => {
    const ex = createTextExtractor();
    const pdfs = lib.manifest.files.filter((f) => f.format === 'pdf' && f.hasText);
    expect(pdfs.length).toBeGreaterThan(5);
    for (const f of pdfs) {
      const r = await ex.extract(lib.root, f.relPath);
      expect(r.format).toBe('pdf');
      expect(r.hasText, f.relPath).toBe(true);
      expect(r.needsOcr).toBe(false);
      expect(r.meta.title, f.relPath).toBe(f.title);
      expect(r.meta.authors, f.relPath).toEqual(f.authors);
      expect(r.meta.doi, f.relPath).toBe(f.doi);
      expect(r.meta.arxivId, f.relPath).toBe(f.arxivId);
      expect(r.meta.pageCount).toBe(f.pages);
      expect(r.pages).toHaveLength(f.pages as number);
      expect(r.meta.year).toBe(2024);
      expect(r.hash).toBe(f.sha256);
    }
  });

  it('finds the abstract and the title even when the PDF has no usable metadata', async () => {
    const ex = createTextExtractor();
    const f = lib.manifest.files.find((x) => x.kind === 'paper') as NonNullable<ReturnType<typeof lib.manifest.get>>;
    const r = await ex.extract(lib.root, f.relPath);
    expect(r.meta.abstract?.startsWith((f.abstract as string).slice(0, 30))).toBe(true);
  });

  it('reports a scanned PDF as without text and needing OCR', async () => {
    const ex = createTextExtractor();
    const f = lib.manifest.byKind('scanned')[0] as NonNullable<ReturnType<typeof lib.manifest.get>>;
    const r = await ex.extract(lib.root, f.relPath);
    expect(r.hasText).toBe(false);
    expect(r.noTextLayer).toBe(true);
    expect(r.needsOcr).toBe(true);
    expect(r.meta.pageCount).toBe(1);
  });

  it('returns the text of a hostile PDF as plain data and does nothing else', async () => {
    const ex = createTextExtractor();
    const f = lib.manifest.byKind('hostile')[0] as NonNullable<ReturnType<typeof lib.manifest.get>>;
    const r = await ex.extract(lib.root, f.relPath);
    const all = r.pages.map((p) => p.text).join('\n');
    expect(all).toContain(f.hostile?.canary as string); // hidden text is extracted like any other text...
    expect(r.meta.title).toBe(f.title); // ...and does not change the metadata
    expect(r.meta.doi).toBe(f.doi);
    expect((await readdir(path.dirname(lib.root))).filter((n) => n.includes('outside'))).toEqual([]);
  });

  it('extracts the supported plain-text formats', async () => {
    const ex = createTextExtractor();
    for (const f of lib.manifest.files.filter((x) => x.format !== 'pdf')) {
      const r = await ex.extract(lib.root, f.relPath);
      expect(r.hasText).toBe(true);
      if (f.format !== 'txt') expect(r.meta.title, f.relPath).toBe(f.title);
      expect(r.pages[0]?.text.length).toBeGreaterThan(0);
    }
  });

  it('handles accented names and a path over 260 characters', async () => {
    const ex = createTextExtractor();
    const long = lib.manifest.byKind('long-path')[0] as NonNullable<ReturnType<typeof lib.manifest.get>>;
    expect(path.join(lib.root, long.relPath).length).toBeGreaterThan(260);
    expect((await ex.extract(lib.root, long.relPath)).meta.title).toBe(long.title);
    const acc = lib.manifest.byKind('accented')[0] as NonNullable<ReturnType<typeof lib.manifest.get>>;
    expect((await ex.extract(lib.root, acc.relPath)).meta.title).toBe(acc.title);
  });

  it('caches text by hash outside the library and serves it without reading the file', async () => {
    const ex = createTextExtractor({ cacheDir: cache });
    const f = lib.manifest.byKind('paper')[0] as NonNullable<ReturnType<typeof lib.manifest.get>>;
    const first = await ex.extract(lib.root, f.relPath);
    expect(first.fromCache).toBeUndefined();
    expect(await readdir(cache)).toEqual([`${f.sha256}.json`]);
    const second = await ex.extract(lib.root, f.relPath);
    expect(second.fromCache).toBe(true);
    expect(second.meta).toEqual(first.meta);
    // With the hash known, a missing file is not even touched.
    const third = await ex.extract(lib.root, 'does/not/exist.pdf', { hash: f.sha256 });
    expect(third.fromCache).toBe(true);
    // A corrupt cache entry is regenerated, not trusted.
    await writeFile(path.join(cache, `${f.sha256}.json`), '{not json');
    const fourth = await ex.extract(lib.root, f.relPath);
    expect(fourth.fromCache).toBeUndefined();
    expect(fourth.meta.title).toBe(f.title);
  });

  it('limits pages', async () => {
    const ex = createTextExtractor();
    const f = lib.manifest.byKind('paper')[0] as NonNullable<ReturnType<typeof lib.manifest.get>>;
    const r = await ex.extract(lib.root, f.relPath, { maxPages: 1 });
    expect(r.pages).toHaveLength(1);
    expect(r.truncated).toBe(true);
    expect(r.meta.pageCount).toBe(f.pages);
  });

  it('refuses paths that leave the root and unsupported types', async () => {
    const ex = createTextExtractor();
    await expect(ex.extract(lib.root, '../outside.pdf')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_ROOT' });
    await expect(ex.extract(lib.root, 'x.exe')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

describe('malformed and limited input', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await tempDir('rl-extract-');
  });
  afterAll(async () => removeDir(dir));
  afterEach(async () => {
    for (const n of await readdir(dir)) await removeDir(path.join(dir, n));
  });

  it('a malformed PDF throws a typed error instead of crashing', async () => {
    await writeFile(path.join(dir, 'broken.pdf'), Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ngarbage garbage'));
    await writeFile(path.join(dir, 'empty.pdf'), Buffer.alloc(0));
    await writeFile(path.join(dir, 'random.pdf'), Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 131 + 7) % 256)));
    const ex = createTextExtractor();
    for (const n of ['broken.pdf', 'empty.pdf', 'random.pdf']) {
      const err = await ex.extract(dir, n).catch((e: unknown) => e);
      expect(err, n).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('IO_ERROR');
      expect((err as AppError).details?.['reason']).toBe('malformed');
    }
  });

  it('rejects files over the size limit', async () => {
    await writeFile(path.join(dir, 'big.txt'), 'x'.repeat(5000));
    const err = await createTextExtractor({ maxTextBytes: 1000 }).extract(dir, 'big.txt').catch((e: unknown) => e);
    expect((err as AppError).details?.['reason']).toBe('too-large');
  });

  it('stops a PDF that takes too long', async () => {
    const lib = await createFixtureLibrary('papers', { parent: dir });
    const f = lib.manifest.files.find((x) => x.format === 'pdf') as NonNullable<ReturnType<typeof lib.manifest.get>>;
    const err = await createTextExtractor({ timeoutMs: 1 }).extract(lib.root, f.relPath).catch((e: unknown) => e);
    // 1 ms is not enough to start: either the time limit or (on a very fast machine) a result; never a hang.
    if (err instanceof AppError) expect(err.details?.['reason']).toBe('timeout');
    await lib.cleanup();
  });

  it('honours an aborted signal', async () => {
    await writeFile(path.join(dir, 'a.txt'), 'hello');
    const ac = new AbortController();
    ac.abort();
    await expect(createTextExtractor().extract(dir, 'a.txt', { signal: ac.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('reads text formats: markdown, tex, rst, py, csv, notebook', async () => {
    await writeFile(path.join(dir, 'a.md'), '---\ntitle: "Front matter title"\nauthors: [Ada Lovelace, Alan Turing]\ndate: 2021-05-01\n---\n# Heading\nSee arXiv:2105.12345v2 and doi:10.1234/abc.def.\n');
    await writeFile(path.join(dir, 'b.md'), '# Only heading\n\ntext');
    await writeFile(
      path.join(dir, 'c.tex'),
      '\\documentclass{article}\n\\title{On \\textbf{Bold} Things\\thanks{Funded.}}\n\\author{Ada Lovelace \\and Alan Turing}\n\\date{March 2020}\n\\begin{document}\n\\begin{abstract}\nThis is a rather long abstract about bold things and how they behave.\n\\end{abstract}\n\\end{document}\n',
    );
    await writeFile(path.join(dir, 'd.rst'), 'My Title\n========\n\nbody\n');
    await writeFile(path.join(dir, 'e.py'), '"""Doc"""\nprint(1)\n');
    await writeFile(path.join(dir, 'f.csv'), 'a,b\n1,2\n');
    await writeFile(path.join(dir, 'g.tsv'), 'a\tb\n1\t2\n');
    await writeFile(
      path.join(dir, 'h.ipynb'),
      JSON.stringify({ cells: [{ cell_type: 'markdown', source: ['# Notebook title\n', 'intro'] }, { cell_type: 'code', source: 'x = 1', outputs: [{ text: 'SECRET-OUTPUT' }] }] }),
    );
    await writeFile(path.join(dir, 'i.txt'), Buffer.from([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00])); // UTF-16LE "hi"
    await writeFile(path.join(dir, 'j.txt'), Buffer.from('caf\xe9', 'latin1'));
    const ex = createTextExtractor();
    const md = await ex.extract(dir, 'a.md');
    expect(md.meta).toMatchObject({ title: 'Front matter title', authors: ['Ada Lovelace', 'Alan Turing'], year: 2021, doi: '10.1234/abc.def', arxivId: '2105.12345', arxivVersion: 2 });
    expect((await ex.extract(dir, 'b.md')).meta.title).toBe('Only heading');
    const tex = await ex.extract(dir, 'c.tex');
    expect(tex.format).toBe('latex');
    expect(tex.meta).toMatchObject({ title: 'On Bold Things', authors: ['Ada Lovelace', 'Alan Turing'], year: 2020 });
    expect(tex.meta.abstract).toMatch(/^This is a rather long abstract/);
    expect((await ex.extract(dir, 'd.rst')).meta.title).toBe('My Title');
    expect((await ex.extract(dir, 'e.py')).pages[0]?.text).toContain('print(1)');
    expect((await ex.extract(dir, 'f.csv')).pages[0]?.text).toContain('1,2');
    expect((await ex.extract(dir, 'g.tsv')).format).toBe('csv');
    const nb = await ex.extract(dir, 'h.ipynb');
    expect(nb.meta.title).toBe('Notebook title');
    expect(nb.pages[0]?.text).toContain('x = 1');
    expect(nb.pages[0]?.text).not.toContain('SECRET-OUTPUT');
    expect((await ex.extract(dir, 'i.txt')).pages[0]?.text).toBe('hi');
    expect((await ex.extract(dir, 'j.txt')).pages[0]?.text).toBe('café');
    await writeFile(path.join(dir, 'bad.ipynb'), '{nope');
    await expect(ex.extract(dir, 'bad.ipynb')).rejects.toMatchObject({ code: 'IO_ERROR' });
  });

  it('reads docx and pptx from their zip, and refuses broken or oversized archives', async () => {
    const docx = zipSync({
      'word/document.xml': strToU8(
        '<w:document><w:body><w:p><w:r><w:t>Hello &amp; welcome</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve"> world</w:t></w:r></w:p><w:p><w:pPr/><w:r><w:t>Second paragraph, doi:10.7777/docx.1.</w:t></w:r></w:p></w:body></w:document>',
      ),
      'docProps/core.xml': strToU8('<cp:coreProperties><dc:title>Word title</dc:title><dc:creator>Ada Lovelace; Alan Turing</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">2019-03-04T10:00:00Z</dcterms:created></cp:coreProperties>'),
    });
    await writeFile(path.join(dir, 'a.docx'), docx);
    const pptx = zipSync({
      'ppt/slides/slide2.xml': strToU8('<p:sld><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:sld>'),
      'ppt/slides/slide1.xml': strToU8('<p:sld><a:p><a:r><a:t>Deck title</a:t></a:r></a:p><a:p><a:r><a:t>bullet</a:t></a:r></a:p></p:sld>'),
      'ppt/slides/slide10.xml': strToU8('<p:sld><a:p><a:r><a:t>Tenth</a:t></a:r></a:p></p:sld>'),
    });
    await writeFile(path.join(dir, 'a.pptx'), pptx);
    const ex = createTextExtractor();
    const d = await ex.extract(dir, 'a.docx');
    expect(d.pages[0]?.text).toBe('Hello & welcome\t world\nSecond paragraph, doi:10.7777/docx.1.');
    expect(d.meta).toMatchObject({ title: 'Word title', authors: ['Ada Lovelace', 'Alan Turing'], year: 2019, doi: '10.7777/docx.1' });
    const p = await ex.extract(dir, 'a.pptx');
    expect(p.pages.map((x) => x.text)).toEqual(['Deck title\nbullet', 'Second slide', 'Tenth']);
    expect(p.meta.title).toBe('Deck title');
    await writeFile(path.join(dir, 'bad.docx'), 'not a zip');
    await expect(ex.extract(dir, 'bad.docx')).rejects.toMatchObject({ code: 'IO_ERROR' });
    await mkdir(path.join(dir, 'sub'));
    await writeFile(path.join(dir, 'sub', 'empty.docx'), zipSync({ 'other.xml': strToU8('x') }));
    await expect(ex.extract(dir, 'sub/empty.docx')).rejects.toMatchObject({ code: 'IO_ERROR' });
  });
});

