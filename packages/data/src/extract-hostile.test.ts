/**
 * Hostile inputs for the text extractor (D-060). Every case is generated at run time in a temp folder and has an
 * explicit time budget (and, for archives and PDFs, a memory budget): a regression of any of the old quadratic
 * regexes or of the zip limits fails here in seconds instead of hanging a scan.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateRawSync, deflateSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError, type RelativePath } from '@rl/core';
import {
  PERMANENT_EXTRACT_REASONS,
  TRANSIENT_EXTRACT_REASONS,
  classifyExtractError,
  cleanDoi,
  createTextExtractor,
  extractErrorReason,
  findArxivIds,
  findDois,
} from './index.js';
import { validCacheEntry } from './extract/text-extractor.js';
import { removeDir, tempDir } from './test-utils.js';

const MiB = 1024 * 1024;

async function timed<T>(fn: () => Promise<T> | T): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - t0 };
}

async function failure(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error('expected the extraction to fail');
}

/** Growth of the resident set while `fn` runs, in MiB (a floor of a GC'd baseline is good enough for 100+ MiB budgets). */
async function rssGrowthMiB<T>(fn: () => Promise<T>): Promise<{ value: T | undefined; error: unknown; growth: number }> {
  globalThis.gc?.();
  const before = process.memoryUsage().rss;
  let peak = before;
  const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 20);
  let value: T | undefined;
  let error: unknown;
  try {
    value = await fn();
  } catch (e) {
    error = e;
  } finally {
    clearInterval(timer);
  }
  peak = Math.max(peak, process.memoryUsage().rss);
  return { value, error, growth: (peak - before) / MiB };
}

/** A zip whose entries are deflated once and shared: hostile archives of GiBs cost a few KiB of test memory. */
function rawZip(entries: Array<{ name: string; deflated: Uint8Array; size: number }>): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = strToU8(e.name);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 8, true); // deflate
    lv.setUint32(18, e.deflated.length, true);
    lv.setUint32(22, e.size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, e.deflated.length, true);
    cv.setUint32(24, e.size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    parts.push(local, e.deflated);
    central.push(cen);
    offset += local.length + e.deflated.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, eocd];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of all) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/** Minimal one-page text PDF (plus optional raw objects) built by hand. */
function buildPdf(objs: string[]): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  const offs: number[] = [];
  let pos = parts[0]!.length;
  objs.forEach((o, i) => {
    offs.push(pos);
    const b = Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1');
    parts.push(b);
    pos += b.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  parts.push(Buffer.from(`${xref}trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${pos}\n%%EOF\n`));
  return Buffer.concat(parts);
}

const stream = (dict: string, body: string) => `<<${dict}/Length ${body.length}>>\nstream\n${body}\nendstream`;
const FONT = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>';
const goodPdf = () =>
  buildPdf([
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    stream('', 'BT /F1 12 Tf 72 700 Td (Hello hostile world) Tj ET'),
    FONT,
  ]);

describe('hostile input: regexes stay linear', () => {
  it('findDois on a DOI followed by 200,000 closing parentheses (was 30 s)', async () => {
    const text = `see 10.1234/x${')'.repeat(200_000)} end`;
    const { value, ms } = await timed(() => findDois(text));
    expect(ms).toBeLessThan(1000);
    expect(value.length).toBeLessThanOrEqual(1); // too long to be a DOI, or cleaned to one
  });

  it('cleanDoi on a million brackets and punctuation runs', async () => {
    for (const filler of [')', ']', '}', '>', '.', ',', ').', '(', '().)']) {
      const { ms } = await timed(() => cleanDoi(`10.1234/x${filler.repeat(1_000_000 / filler.length)}`));
      expect(ms, filler).toBeLessThan(1000);
    }
    expect(cleanDoi('10.1000/abc(1)')).toBe('10.1000/abc(1)');
    expect(cleanDoi('10.1000/abc)).')).toBe('10.1000/abc');
    expect(cleanDoi('10.1000/a[b](c')).toBe('10.1000/a[b](c');
  });

  it('findDois and findArxivIds on adversarial runs', async () => {
    const cases = [
      '10.1234/'.repeat(100_000),
      `10.1234/${'a'.repeat(1_000_000)}`,
      `10.1234/${'('.repeat(500_000)}`,
      'doi:'.repeat(200_000),
      `arxiv${' '.repeat(500_000)}`,
      `arXiv:${'a-'.repeat(200_000)}`,
      'arxiv:a'.repeat(100_000),
      `arXiv:${'a'.repeat(1_000_000)}`,
      `arXiv:2401.${'1'.repeat(1_000_000)}`,
    ];
    for (const text of cases) {
      const { ms } = await timed(() => [findDois(text), findArxivIds(text)]);
      expect(ms, text.slice(0, 20)).toBeLessThan(1000);
    }
  });

  it('keeps finding ordinary identifiers', () => {
    expect(findDois('doi:10.1234/abc.def).').map((d) => d.doi)).toEqual(['10.1234/abc.def']);
    expect(findArxivIds('arXiv:hep-th/9901001v2')).toEqual([{ id: 'hep-th/9901001', version: 2 }]);
  });
});

describe('hostile input: documents', () => {
  let dir: string;
  const ex = createTextExtractor();
  const put = async (name: string, data: Uint8Array | string): Promise<RelativePath> => {
    await writeFile(path.join(dir, name), data);
    return name as RelativePath;
  };
  beforeAll(async () => {
    dir = await tempDir('rl-hostile-');
  });
  afterAll(async () => {
    await removeDir(dir);
  });

  it('docx with 300,000 unclosed <w:p > tags (2.7 KB zipped, was 75 s)', async () => {
    const rel = await put('redos.docx', zipSync({ 'word/document.xml': [strToU8('<w:p >'.repeat(300_000)), { level: 9 }] }));
    const { value, ms } = await timed(() => ex.extract(dir, rel));
    expect(ms).toBeLessThan(1000);
    expect(value.format).toBe('docx');
  });

  it('docx with unclosed <w:t> runs, in every shape (was > 2 min)', async () => {
    const shapes = ['<w:p><w:t>'.repeat(200_000), '<w:p ><w:t>'.repeat(200_000) + '</w:p>', '<w:t>'.repeat(300_000), `<w:p><w:t>${'x'.repeat(2_000_000)}`, '<w:p <w:t '.repeat(300_000), '<'.repeat(1_000_000)];
    for (const [i, xml] of shapes.entries()) {
      const rel = await put(`redos-t${i}.docx`, zipSync({ 'word/document.xml': [strToU8(xml), { level: 9 }] }));
      const { ms } = await timed(() => ex.extract(dir, rel));
      expect(ms, `shape ${i}`).toBeLessThan(1500);
    }
  });

  it('core.xml with unclosed tags and a huge title (docx and pptx)', async () => {
    const core = ['<dc:title>'.repeat(90_000), '<dc:creator >'.repeat(40_000) + '<dcterms:created>'.repeat(30_000), `<dc:title>${'a'.repeat(900_000)}`];
    for (const [i, xml] of core.entries()) {
      const docx = await put(`core${i}.docx`, zipSync({ 'word/document.xml': strToU8('<w:p><w:t>hello</w:t></w:p>'), 'docProps/core.xml': strToU8(xml) }));
      const pptx = await put(`core${i}.pptx`, zipSync({ 'ppt/slides/slide1.xml': strToU8('<a:p><a:t>hello</a:t></a:p>'), 'docProps/core.xml': strToU8(xml) }));
      for (const rel of [docx, pptx]) {
        const { value, ms } = await timed(() => ex.extract(dir, rel));
        expect(ms, `${rel}`).toBeLessThan(1000);
        expect(value.pages.map((p) => p.text).join('')).toContain('hello');
      }
    }
  });

  it('still reads a normal docx and pptx', async () => {
    const docx = await put('ok.docx', zipSync({ 'word/document.xml': strToU8('<w:document><w:body><w:p><w:r><w:t>Alpha</w:t></w:r><w:r><w:tab/><w:t>beta &amp; gamma</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:body></w:document>'), 'docProps/core.xml': strToU8('<cp:coreProperties><dc:title>A Title</dc:title><dc:creator>Ann Lee; Bo Kim</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">2021-03-04T00:00:00Z</dcterms:created></cp:coreProperties>') }));
    const r = await ex.extract(dir, docx);
    expect(r.pages[0]!.text).toBe('Alpha\tbeta & gamma\nSecond');
    expect(r.meta).toMatchObject({ title: 'A Title', authors: ['Ann Lee', 'Bo Kim'], year: 2021 });
    const pptx = await put('ok.pptx', zipSync({ 'ppt/slides/slide2.xml': strToU8('<p:sld><a:p><a:r><a:t>Two</a:t></a:r></a:p></p:sld>'), 'ppt/slides/slide10.xml': strToU8('<a:p><a:r><a:t>Ten</a:t></a:r></a:p>'), 'ppt/slides/slide1.xml': strToU8('<a:p><a:r><a:t>One</a:t></a:r></a:p><a:p><a:r><a:t>line</a:t></a:r></a:p>') }));
    const p = await ex.extract(dir, pptx);
    expect(p.pages.map((x) => x.text)).toEqual(['One\nline', 'Two', 'Ten']);
    expect(p.meta.title).toBe('One');
  });

  it('LaTeX, Markdown and reST with pathological runs', async () => {
    const cases: Record<string, string> = {
      'a.tex': `\\title[${'['.repeat(1_000_000)}`,
      'b.tex': '\\title[\n'.repeat(200_000),
      'c.tex': `\\title${' '.repeat(2_000_000)}`,
      'd.tex': '\\begin{abstract}'.repeat(200_000),
      'e.tex': `\\author{${'\\thanks['.repeat(100_000)}}`,
      'f.tex': `\\title{${'\\textbf['.repeat(100_000)}}`,
      'a.md': `# x${' '.repeat(2_000_000)}y`,
      'b.md': `---\ntitle${' '.repeat(1_000_000)}\n`,
      'c.md': `${'a\n'.repeat(100_000)}${'='.repeat(1_000_000)}x`,
      'd.md': '---\n' + 'title\n'.repeat(100_000),
      'a.rst': `${'x'.repeat(100)}\n${'='.repeat(1_000_000)}x`,
      'b.rst': 'x\n====\n'.repeat(1) + '\n'.repeat(1_000_000),
      'x.txt': `Abstract${' '.repeat(500_000)}`,
      'y.txt': '\n \n'.repeat(300_000),
    };
    for (const [name, text] of Object.entries(cases)) {
      const rel = await put(name, text);
      const { ms } = await timed(() => ex.extract(dir, rel));
      expect(ms, name).toBeLessThan(2000);
    }
  });

  it('still reads LaTeX and Markdown metadata', async () => {
    const tex = await put('ok.tex', '\\title{On \\emph{Things}}\\author{Ann Lee \\and Bo Kim}\\date{2020}\n\\begin{abstract}This paper studies things of a certain kind at some length.\\end{abstract}');
    const r = await ex.extract(dir, tex);
    expect(r.meta).toMatchObject({ title: 'On Things', authors: ['Ann Lee', 'Bo Kim'], year: 2020 });
    expect(r.meta.abstract).toContain('studies things');
    const md = await put('ok.md', '---\ntitle: "Front"\nauthors: [A B, C D]\ndate: 2019-01-01\n---\n# Body\n');
    expect((await ex.extract(dir, md)).meta).toMatchObject({ title: 'Front', authors: ['A B', 'C D'], year: 2019 });
    const md2 = await put('ok2.md', 'intro\n\n#   Heading Two  ##\ntext');
    expect((await ex.extract(dir, md2)).meta.title).toBe('Heading Two');
  });
});

describe('hostile input: zip bombs', () => {
  let dir: string;
  const ex = createTextExtractor();
  let blob64: { deflated: Uint8Array; size: number };
  let blob8: { deflated: Uint8Array; size: number };
  beforeAll(async () => {
    dir = await tempDir('rl-zip-');
    blob64 = { deflated: deflateRawSync(Buffer.alloc(64 * MiB, 32), { level: 9 }), size: 64 * MiB };
    blob8 = { deflated: deflateRawSync(Buffer.alloc(8 * MiB, 32), { level: 9 }), size: 8 * MiB };
  });
  afterAll(async () => {
    await removeDir(dir);
  });

  async function expectTooLarge(name: string, zip: Uint8Array, budgetMs: number, budgetMiB: number): Promise<void> {
    await writeFile(path.join(dir, name), zip);
    const r = await rssGrowthMiB(() => timed(() => ex.extract(dir, name as RelativePath)));
    expect(r.error, name).toBeInstanceOf(AppError);
    expect((r.error as AppError).details?.['reason']).toBe('too-large');
    expect(r.growth, `${name} rss growth`).toBeLessThan(budgetMiB);
    // the time of the rejection itself, not of generating the archive
    const { ms } = await timed(() => failure(ex.extract(dir, name as RelativePath)));
    expect(ms, name).toBeLessThan(budgetMs);
  }

  it('pptx of 24 slides of 64 MiB each (1.8 GB of RSS before)', async () => {
    const entries = Array.from({ length: 24 }, (_, i) => ({ name: `ppt/slides/slide${i + 1}.xml`, ...blob64 }));
    await expectTooLarge('bomb.pptx', rawZip(entries), 1000, 150);
  });

  it('pptx whose slides are each under the per-entry cap but together over the archive cap', async () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({ name: `ppt/slides/slide${i + 1}.xml`, ...blob8 })); // 160 MiB > 128 MiB
    await expectTooLarge('sum.pptx', rawZip(entries), 1000, 150);
  });

  it('docx with a 64 MiB document.xml, and with a lie about the size', async () => {
    await expectTooLarge('big.docx', rawZip([{ name: 'word/document.xml', ...blob64 }]), 1000, 150);
    // Declares 1000 bytes, inflates to 64 MiB: must not be trusted to be small. Any clean failure or a bounded result is fine.
    const lie = rawZip([{ name: 'word/document.xml', deflated: blob64.deflated, size: 1000 }]);
    await writeFile(path.join(dir, 'lie.docx'), lie);
    const r = await rssGrowthMiB(() => ex.extract(dir, 'lie.docx' as RelativePath));
    if (r.error) expect(r.error).toBeInstanceOf(AppError);
    expect(r.growth).toBeLessThan(250);
  });

  it('docx with more than 2000 entries', async () => {
    const files: Record<string, Uint8Array> = { 'word/document.xml': strToU8('<w:p><w:t>x</w:t></w:p>') };
    for (let i = 0; i < 2500; i++) files[`word/media/img${i}.png`] = strToU8('x');
    await expectTooLarge('many.docx', zipSync(files), 1000, 100);
  });

  it('unwanted entries are never inflated, however big they claim to be', async () => {
    const entries = [
      { name: 'word/media/huge.bin', ...blob64 },
      { name: 'word/document.xml', deflated: deflateRawSync(strToU8('<w:p><w:t>fine</w:t></w:p>')), size: 25 },
    ];
    await writeFile(path.join(dir, 'skip.docx'), rawZip(entries));
    const r = await rssGrowthMiB(() => ex.extract(dir, 'skip.docx' as RelativePath));
    expect(r.error).toBeUndefined();
    expect(r.growth).toBeLessThan(100);
    expect(r.value?.pages[0]?.text).toBe('fine');
  });

  it('truncated and garbage archives fail as malformed', async () => {
    await writeFile(path.join(dir, 'junk.docx'), Buffer.from('not a zip at all'));
    const e = await failure(ex.extract(dir, 'junk.docx' as RelativePath));
    expect(extractErrorReason(e)).toBe('malformed');
  });
});

describe('hostile input: PDF', () => {
  let dir: string;
  const ex = createTextExtractor();
  beforeAll(async () => {
    dir = await tempDir('rl-pdf-');
  });
  afterAll(async () => {
    await removeDir(dir);
  });

  it('reads a normal PDF and reports progress per page', async () => {
    await writeFile(path.join(dir, 'ok.pdf'), goodPdf());
    const seen: Array<[number, number]> = [];
    const r = await ex.extract(dir, 'ok.pdf' as RelativePath, { onPage: (p, t) => void seen.push([p, t]) });
    expect(r.pages[0]!.text).toContain('Hello hostile world');
    expect(seen).toEqual([
      [0, 1],
      [1, 1],
    ]);
    // a throwing callback never breaks the extraction
    const again = await ex.extract(dir, 'ok.pdf' as RelativePath, {
      onPage: () => {
        throw new Error('boom');
      },
    });
    expect(again.pages).toHaveLength(1);
  });

  it('page tree with /Count 2,000,000,000', async () => {
    await writeFile(path.join(dir, 'count.pdf'), buildPdf(['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 2000000000>>', '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>']));
    const r = await rssGrowthMiB(() => timed(() => ex.extract(dir, 'count.pdf' as RelativePath)));
    if (r.error) expect(classifyExtractError(r.error)).toBe('permanent');
    else {
      expect(r.value!.ms).toBeLessThan(3000);
      expect(r.value!.value.pages.length).toBeLessThanOrEqual(400);
    }
    expect(r.growth).toBeLessThan(300);
  });

  it('cyclic page tree', async () => {
    await writeFile(path.join(dir, 'cycle.pdf'), buildPdf(['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[2 0 R 3 0 R]/Count 5>>', '<</Type/Pages/Parent 2 0 R/Kids[2 0 R]/Count 1>>']));
    const r = await rssGrowthMiB(() => timed(() => ex.extract(dir, 'cycle.pdf' as RelativePath)));
    if (r.error) expect(classifyExtractError(r.error)).toBe('permanent');
    else expect(r.value!.ms).toBeLessThan(3000);
    expect(r.growth).toBeLessThan(300);
  });

  it('caps the characters kept, per page and per file, while collecting', async () => {
    const text = 'word '.repeat(2000);
    const content = `BT /F1 12 Tf 14 TL 72 700 Td ${Array.from({ length: 50 }, () => `(${text}) Tj T*`).join(' ')} ET`;
    const pdf = buildPdf([
      '<</Type/Catalog/Pages 2 0 R>>',
      '<</Type/Pages/Kids[3 0 R 3 0 R 3 0 R]/Count 3>>',
      '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
      stream('', content),
      FONT,
    ]);
    await writeFile(path.join(dir, 'chars.pdf'), pdf);
    const small = createTextExtractor({ maxCharsPerPage: 5000, maxCharsPerFile: 8000 });
    const { value, ms } = await timed(() => small.extract(dir, 'chars.pdf' as RelativePath));
    expect(ms).toBeLessThan(3000);
    expect(value.pages.every((p) => p.text.length <= 5000)).toBe(true);
    expect(value.pages.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(8000);
    expect(value.truncated).toBe(true);
  });

  it('a content stream that inflates to 256 MiB stays within time and memory', async () => {
    const bomb = deflateSync(Buffer.alloc(256 * MiB, 32), { level: 9 });
    const body = bomb.toString('latin1');
    const pdf = buildPdf([
      '<</Type/Catalog/Pages 2 0 R>>',
      '<</Type/Pages/Kids[3 0 R]/Count 1>>',
      '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
      `<</Filter/FlateDecode/Length ${bomb.length}>>\nstream\n${body}\nendstream`,
      FONT,
    ]);
    await writeFile(path.join(dir, 'bomb.pdf'), pdf);
    const fast = createTextExtractor({ timeoutMs: 20_000 });
    const r = await rssGrowthMiB(() => timed(() => fast.extract(dir, 'bomb.pdf' as RelativePath)));
    if (r.error) expect(classifyExtractError(r.error)).not.toBe('transient');
    else expect(r.value!.ms).toBeLessThan(20_000);
    expect(r.growth).toBeLessThan(1200);
  }, 60_000);

  it('does not load a native canvas for a document: pages needing one still yield text', async () => {
    const withImage = buildPdf([
      '<</Type/Catalog/Pages 2 0 R>>',
      '<</Type/Pages/Kids[3 0 R]/Count 1>>',
      '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>/XObject<</Im 6 0 R>>>>>>',
      stream('', 'q 100 0 0 100 0 0 cm /Im Do Q BT /F1 12 Tf 72 700 Td (After the image) Tj ET'),
      FONT,
      `<</Type/XObject/Subtype/Image/Width 2/Height 2/ColorSpace/DeviceGray/BitsPerComponent 8/Length 4>>\nstream\nabcd\nendstream`,
    ]);
    await writeFile(path.join(dir, 'img.pdf'), withImage);
    const r = await ex.extract(dir, 'img.pdf' as RelativePath);
    expect(r.pages[0]!.text).toContain('After the image');
  });
});

describe('hostile input: notebooks', () => {
  let dir: string;
  const ex = createTextExtractor();
  const put = async (name: string, data: string | Uint8Array): Promise<RelativePath> => {
    await writeFile(path.join(dir, name), data);
    return name as RelativePath;
  };
  beforeAll(async () => {
    dir = await tempDir('rl-nb-');
  });
  afterAll(async () => {
    await removeDir(dir);
  });

  it('deeply nested JSON (arrays and objects) is rejected as malformed, fast', async () => {
    const shapes = ['['.repeat(2_000_000) + ']'.repeat(2_000_000), '{"a":'.repeat(500_000) + '1' + '}'.repeat(500_000), `{"cells":[${'['.repeat(1_000_000)}`];
    for (const [i, s] of shapes.entries()) {
      const rel = await put(`nest${i}.ipynb`, s);
      const { value: err, ms } = await timed(() => failure(ex.extract(dir, rel)));
      expect(extractErrorReason(err), `shape ${i}`).toBe('malformed');
      expect(ms, `shape ${i}`).toBeLessThan(1000);
    }
  });

  it('null, scalars, arrays and objects without cells are malformed, not TypeErrors', async () => {
    for (const [i, s] of ['null', '1', '"x"', '[]', '{}', '{"cells":null}', '{"cells":{}}', '', '{"cells":[}'].entries()) {
      const rel = await put(`shape${i}.ipynb`, s);
      const err = await failure(ex.extract(dir, rel));
      expect(extractErrorReason(err), s).toBe('malformed');
    }
  });

  it('oversized notebooks are too-large', async () => {
    const rel = await put('huge.ipynb', `{"cells":[],"pad":"${'x'.repeat(9 * MiB)}"}`);
    const err = await failure(ex.extract(dir, rel));
    expect(extractErrorReason(err)).toBe('too-large');
  });

  it('odd cells are skipped, good cells are read', async () => {
    const nb = { cells: [null, 1, 'x', [], {}, { cell_type: 'markdown', source: 5 }, { cell_type: 'markdown', source: ['# Title\n', 7, 'more'] }, { cell_type: 'code', source: 'print(1)' }, { cell_type: 'weird', source: 'no' }] };
    const r = await ex.extract(dir, await put('odd.ipynb', JSON.stringify(nb)));
    expect(r.meta.title).toBe('Title');
    expect(r.pages[0]!.text).toBe('# Title\nmore\n\nprint(1)');
  });
});

describe('extraction cache', () => {
  let dir: string;
  let cache: string;
  beforeAll(async () => {
    dir = await tempDir('rl-cache-src-');
    cache = await tempDir('rl-cache-');
  });
  afterAll(async () => {
    await removeDir(dir);
    await removeDir(cache);
  });

  const good = { v: 1, maxPages: 400, result: { pages: [{ page: 1, text: 'hi' }], meta: { pageCount: 1 }, noTextLayer: false, hasText: true, needsOcr: false, format: 'text', truncated: false } };

  it('validates entries: wrong shapes and oversized text are rejected', () => {
    const v = (e: unknown) => validCacheEntry(e, 400, 100, 1000);
    expect(v(good)).toBeDefined();
    const bad: unknown[] = [
      null,
      [],
      { ...good, v: 2 },
      { ...good, maxPages: 3 },
      { ...good, result: null },
      { ...good, result: { ...good.result, pages: 'x' } },
      { ...good, result: { ...good.result, pages: [{ page: 1.5, text: 'x' }] } },
      { ...good, result: { ...good.result, pages: [{ page: 1, text: 5 }] } },
      { ...good, result: { ...good.result, pages: [{ page: 1, text: 'x'.repeat(101) }] } },
      { ...good, result: { ...good.result, pages: Array.from({ length: 11 }, (_, i) => ({ page: i + 1, text: 'x'.repeat(100) })) } },
      { ...good, result: { ...good.result, meta: { pageCount: -1 } } },
      { ...good, result: { ...good.result, meta: { pageCount: 1, title: 5 } } },
      { ...good, result: { ...good.result, meta: { pageCount: 1, authors: [1] } } },
      { ...good, result: { ...good.result, hasText: 'yes' } },
      { ...good, result: { ...good.result, format: 'exe' } },
    ];
    for (const [i, b] of bad.entries()) expect(v(b), `case ${i}`).toBeUndefined();
  });

  it('ignores and regenerates an invalid cache file', async () => {
    await writeFile(path.join(dir, 'a.txt'), 'some plain text of the document');
    const ex = createTextExtractor({ cacheDir: cache });
    const first = await ex.extract(dir, 'a.txt' as RelativePath);
    expect(first.fromCache).toBeUndefined();
    const file = path.join(cache, `${first.hash}.json`);
    expect((await ex.extract(dir, 'a.txt' as RelativePath)).fromCache).toBe(true);
    for (const junk of ['{"v":1,"maxPages":400,"result":{"pages":[{"page":"x"}]}}', 'null', '[1,2]', '{"v":1', '\u0000\u0000']) {
      await writeFile(file, junk);
      const r = await ex.extract(dir, 'a.txt' as RelativePath, { hash: first.hash as string });
      expect(r.fromCache, junk).toBeUndefined();
      expect(r.pages[0]!.text).toBe('some plain text of the document');
      expect(JSON.parse(await readFile(file, 'utf8')).result.pages[0].text).toBe('some plain text of the document');
    }
  });

  it('a stale caller hash never labels newer content: the result carries the hash of what was read', async () => {
    await mkdir(path.join(dir, 'sub'), { recursive: true });
    await writeFile(path.join(dir, 'sub', 'b.txt'), 'version one');
    const ex = createTextExtractor({ cacheDir: cache });
    const v1 = await ex.extract(dir, 'sub/b.txt' as RelativePath);
    await writeFile(path.join(dir, 'sub', 'b.txt'), 'version two, different bytes');
    const stale = await ex.extract(dir, 'sub/b.txt' as RelativePath, { hash: 'f'.repeat(64) });
    expect(stale.pages[0]!.text).toBe('version two, different bytes');
    expect(stale.hash).not.toBe(v1.hash);
    expect(stale.hash).not.toBe('f'.repeat(64));
    expect(stale.hashMismatch).toBe(true);
    // nothing was cached under the stale hash, and the content is cached under its own
    await expect(readFile(path.join(cache, `${'f'.repeat(64)}.json`))).rejects.toThrow();
    const stored = JSON.parse(await readFile(path.join(cache, `${stale.hash}.json`), 'utf8'));
    expect(stored.result.pages[0].text).toBe('version two, different bytes');
    // a matching hash is not flagged
    const ok = await ex.extract(dir, 'sub/b.txt' as RelativePath, { hash: stale.hash as string });
    expect(ok.hashMismatch).toBeUndefined();
  });
});

describe('failure classification', () => {
  it('lists permanent and transient reasons without overlap and classifies errors', () => {
    expect(PERMANENT_EXTRACT_REASONS).toEqual(['malformed', 'encrypted', 'too-large', 'unsupported-format', 'timeout']);
    expect(TRANSIENT_EXTRACT_REASONS).toEqual(['busy', 'not-found', 'io']);
    for (const r of PERMANENT_EXTRACT_REASONS) expect(classifyExtractError(new AppError('IO_ERROR', 'x', { reason: r }))).toBe('permanent');
    for (const r of TRANSIENT_EXTRACT_REASONS) expect(classifyExtractError(new AppError('IO_ERROR', 'x', { reason: r }))).toBe('transient');
    expect(classifyExtractError(new AppError('CANCELLED', 'x'))).toBe('cancelled');
    expect(classifyExtractError(new Error('who knows'))).toBe('transient');
  });

  it('real failures carry a classified reason', async () => {
    const dir = await tempDir('rl-class-');
    try {
      const ex = createTextExtractor();
      await writeFile(path.join(dir, 'bad.pdf'), 'not a pdf');
      await writeFile(path.join(dir, 'x.xyz'), 'x');
      const malformed = await failure(ex.extract(dir, 'bad.pdf' as RelativePath));
      expect(classifyExtractError(malformed)).toBe('permanent');
      const missing = await failure(ex.extract(dir, 'gone.pdf' as RelativePath));
      expect(extractErrorReason(missing)).toBe('not-found');
      expect(classifyExtractError(missing)).toBe('transient');
      const unsupported = await failure(ex.extract(dir, 'x.xyz' as RelativePath));
      expect(classifyExtractError(unsupported)).toBe('permanent');
      const small = createTextExtractor({ maxBytes: 10 });
      await writeFile(path.join(dir, 'big.pdf'), goodPdf());
      expect(extractErrorReason(await failure(small.extract(dir, 'big.pdf' as RelativePath)))).toBe('too-large');
    } finally {
      await removeDir(dir);
    }
  });
});
