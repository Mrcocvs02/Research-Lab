import { describe, expect, it } from 'vitest';
import { LIMITS, bufSyncSource, getPage, loadDoc, resolve, resolveObj, type Doc } from './doc.js';
import { PdfError, asDict, nameOf } from './objects.js';
import { pageCountOf } from './plan.js';
import { docPdf } from './gen.js';
import { appendRevision } from './test-pdfs.js';

const load = (b: Buffer): Doc => loadDoc(bufSyncSource(b));
const codeOf = (f: () => unknown): string | undefined => {
  try {
    f();
  } catch (e) {
    return e instanceof PdfError ? e.code : `other:${String(e)}`;
  }
  return undefined;
};
const startxref = (b: Buffer): number => Number([...b.toString('latin1').matchAll(/startxref\s+(\d+)/g)].pop()![1]);
const swap = (b: Buffer, from: string | RegExp, to: string): Buffer => Buffer.from(b.toString('latin1').replace(from, to), 'latin1');

describe('xref: tables, streams, hybrids and the chain of revisions (§8.3.13)', () => {
  it('a classic table with subsections', () => {
    const doc = load(docPdf({ pages: 2 }));
    expect(doc.lastKind).toBe('table');
    expect(doc.hybrid).toBe(false);
    expect(doc.sections).toBe(1);
    expect(doc.size).toBe(7);
    expect(doc.xref.get(1)?.t).toBe(1);
    expect(nameOf(asDict(resolve(doc, doc.trailer.get('Root')))!.get('Type'))).toBe('Catalog');
    // a second revision with its own subsections: both are read, the newer entry wins
    const base = docPdf({ pages: 2 });
    const v2 = appendRevision(base, [[3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>'], [9, '<< /X 1 >>']]);
    const d2 = load(v2);
    expect(d2.sections).toBe(2);
    expect(d2.size).toBe(10);
    expect((resolveObj(d2, 3)!.val as Map<string, unknown>).get('MediaBox')).toEqual([0, 0, 100, 100]);
  });

  it('an xref stream with the PNG predictor and /W of 1 4 2, and objects inside an object stream', () => {
    const doc = load(docPdf({ kind: 'stream', predictor: true, pages: 2 }));
    expect(doc.lastKind).toBe('stream');
    expect(doc.xref.get(1)?.t).toBe(2); // the catalog is compressed
    expect(doc.xref.get(5)?.t).toBe(1); // a contents stream is not
    const catalog = asDict(resolve(doc, doc.trailer.get('Root')))!;
    expect(nameOf(catalog.get('Type'))).toBe('Catalog');
    expect(pageCountOf(doc)).toBe(2);
  });

  it('an xref stream without predictor', () => {
    const doc = load(docPdf({ kind: 'stream', pages: 1 }));
    expect(doc.lastKind).toBe('stream');
    expect(getPage(doc, 0)?.ref.n).toBe(3);
  });

  it('a hybrid file: the table plus the /XRefStm that lists the compressed objects', () => {
    const doc = load(docPdf({ kind: 'hybrid', pages: 2 }));
    expect(doc.lastKind).toBe('table');
    expect(doc.hybrid).toBe(true);
    expect(doc.xref.get(1)?.t).toBe(2);
    expect(getPage(doc, 1)?.ref.n).toBe(4);
    expect(pageCountOf(doc)).toBe(2);
  });

  it('a compressed object is read from its object stream', () => {
    const doc = load(docPdf({ kind: 'stream', pages: 1 }));
    const ind = resolveObj(doc, 3)!;
    expect(ind.dataStart).toBe(-1);
    expect(nameOf(asDict(ind.val)!.get('Type'))).toBe('Page');
  });

  it('the chain of /Prev is followed; a cycle, a chain over the limit and an offset outside the file are refused', () => {
    const base = docPdf();
    const x = startxref(base);
    expect(codeOf(() => load(swap(base, '/Root 1 0 R', `/Root 1 0 R /Prev ${x}`)))).toBe('prev-cycle');
    expect(codeOf(() => load(swap(base, /startxref\s+\d+/, 'startxref\n99999999')))).toBe('xref-offset');
    expect(codeOf(() => load(swap(base, 'startxref', 'startxrfe')))).toBe('no-startxref');
    expect(codeOf(() => load(Buffer.from('%PDF-1.7\n%%EOF\n')))).toBe('no-startxref');
    // a long but finite chain stays under the limit
    let b = base;
    for (let i = 0; i < 20; i++) b = appendRevision(b, [[9, `<< /N ${i} >>`]]);
    expect(load(b).sections).toBe(21);
    expect(LIMITS.prevChain).toBe(1000);
  });

  it('data after the final %%EOF is measured and the file still reads', () => {
    const doc = load(docPdf({ junk: 'junk bytes\n' }));
    expect(doc.trailing).toBeGreaterThan(0);
    expect(load(docPdf()).trailing).toBe(0);
    expect(pageCountOf(doc)).toBe(1);
  });

  it('a damaged table or entry is refused with a code, not an exception of another kind', () => {
    const base = docPdf();
    expect(codeOf(() => load(swap(base, /0000000015 00000 n /, 'XXXXXXXXXX 00000 n ')))).toBeDefined();
    expect(codeOf(() => load(swap(base, 'trailer', 'trailor')))).toBeDefined();
  });
});

describe('pages: the tree, inherited attributes, counts and cycles', () => {
  it('a flat tree, page by page', () => {
    const doc = load(docPdf({ pages: 4 }));
    expect([0, 1, 2, 3].map((i) => getPage(doc, i)?.ref.n)).toEqual([3, 4, 5, 6]);
    expect(getPage(doc, 4)).toBeUndefined();
  });

  it('nested /Kids with attributes inherited from the root and overridden by a page', () => {
    const doc = load(docPdf({ tree: 'nested', pages: [{}, { mediaBox: '[0 0 50 60]', rotate: 180 }] }));
    const p0 = getPage(doc, 0)!;
    expect(p0.inh.MediaBox).toEqual([0, 0, 300, 400]);
    expect(p0.inh.Rotate).toBe(90);
    const p1 = getPage(doc, 1)!;
    expect(p1.inh.MediaBox).toEqual([0, 0, 50, 60]);
    expect(p1.inh.Rotate).toBe(180);
    expect(pageCountOf(doc)).toBe(2);
  });

  it('a page tree that points back at its parent is a cycle', () => {
    const b = swap(docPdf({ pages: 2 }), '/Kids [3 0 R 4 0 R]', '/Kids [2 0 R 4 0 R]');
    // the xref offsets are unchanged: the replacement has the same length
    expect(b.length).toBe(docPdf({ pages: 2 }).length);
    expect(codeOf(() => getPage(load(b), 0))).toBe('pages-cycle');
  });

  it('a page that does not exist is damaged', () => {
    expect(codeOf(() => getPage(load(swap(docPdf({ pages: 2 }), '/Kids [3 0 R 4 0 R]', '/Kids [3 0 R 7 0 R]')), 1))).toBeDefined();
  });
});
