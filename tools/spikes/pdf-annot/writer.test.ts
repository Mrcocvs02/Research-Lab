import { describe, expect, it } from 'vitest';
import { classify } from './classify';
import { bufSource, getPage } from './doc';
import { pageGeometry, toPdfRects } from './geom';
import { handClassic, handHybrid, handLinearized, libPdf } from './pdfs';
import { annotsOf, withPdfjs } from './pdfjs';
import { buildUpdate, listOurs, type AnnotSpec, type Rect } from './writer';

const HL = (nm = 'rl-hl1', page = 0): AnnotSpec => ({ nm, subtype: 'Highlight', page, rects: [[40, 300, 200, 320], [40, 280, 120, 298]], color: [1, 0.9, 0], contents: 'Comment (with) \\ parens' });
const UL = (nm = 'rl-ul1', page = 0): AnnotSpec => ({ nm, subtype: 'Underline', page, rects: [[40, 200, 180, 214]], color: [0.2, 0.4, 1], contents: 'Commento con àccènti — ✓' });
const FIXED = new Date('2026-01-02T03:04:05Z');

function open(bytes: Buffer) {
  const c = classify(bufSource(bytes));
  if (!c.ok) throw new Error(`refused: ${c.reason}/${c.detail}`);
  return c;
}
function write(bytes: Buffer, ops: Parameters<typeof buildUpdate>[1]) {
  const c = open(bytes);
  const u = buildUpdate(c.doc, ops, FIXED);
  const out = Buffer.concat([bytes, u.bytes]);
  expect(out.subarray(0, bytes.length).equals(bytes)).toBe(true); // exact prefix
  return { out, u, c };
}

describe.each([
  ['classic table', () => libPdf({ pages: 2 }), 'table'],
  ['xref stream + object streams', () => libPdf({ pages: 2, objectStreams: true }), 'stream'],
  ['hand hybrid /XRefStm (page in an object stream)', async () => handHybrid(), 'table'],
  ['hand linearized', async () => handLinearized(), 'table'],
  ['hand classic, no final newline', async () => handClassic().subarray(0, -1), 'table'],
  ['hand classic, data after %%EOF', async () => Buffer.concat([handClassic(), Buffer.from('\n%junk\nTRAILING-GARBAGE-1234567890')]), 'table'],
] as const)('%s', (_n, make, kind) => {
  it('classifies, appends Highlight + Underline, pdf.js reads them back, removal and a second revision work', async () => {
    const bytes = await make();
    const multi = bytes.toString('latin1').includes('/Count 2') || kind === 'stream' || _n === 'classic table';
    const c0 = open(bytes);
    expect(c0.kind).toBe(kind);

    const r1 = write(bytes, { add: [HL(), UL()] });
    let annots = await annotsOf(r1.out);
    expect(annots.map((a) => a.subtype).sort()).toEqual(['Highlight', 'Underline']);
    const hl = annots.find((a) => a.subtype === 'Highlight');
    expect([...hl.color]).toEqual([255, 230, 0]);
    expect(hl.rect.map((n: number) => Math.round(n))).toEqual([40, 280, 200, 320]);
    expect(hl.contentsObj.str).toBe('Comment (with) \\ parens');
    expect(annots.find((a) => a.subtype === 'Underline').contentsObj.str).toBe('Commento con àccènti — ✓');
    expect(annots.every((a) => a.hasAppearance)).toBe(true);
    expect(r1.u.objects).toBe(6); // 2 appearances, 2 annotations, /Annots array, rewritten page

    const c1 = open(r1.out);
    expect(c1.kind).toBe(kind);
    expect(c1.revisions).toBe(c0.revisions + 1);
    expect(listOurs(c1.doc, 0).map((x) => x.nm).sort()).toEqual(['rl-hl1', 'rl-ul1']);

    const r2 = write(r1.out, { remove: [{ page: 0, nm: 'rl-hl1' }] });
    expect(r2.u.objects).toBe(1); // only the /Annots array is rewritten from the second write on
    annots = await annotsOf(r2.out);
    expect(annots.map((a) => a.subtype)).toEqual(['Underline']);

    if (!multi) return;
    const r3 = write(r2.out, { add: [HL('rl-hl2', 1)] });
    expect((await annotsOf(r3.out, 2)).map((a) => a.subtype)).toEqual(['Highlight']);
    expect((await annotsOf(r3.out, 1)).map((a) => a.subtype)).toEqual(['Underline']);
    const r4 = write(r3.out, { add: [{ ...HL('rl-hl2', 1), color: [0, 1, 0], contents: 'changed', ref: listOurs(open(r3.out).doc, 1)[0]!.ref }] });
    const a4 = await annotsOf(r4.out, 2);
    expect(a4).toHaveLength(1);
    expect([...a4[0].color]).toEqual([0, 255, 0]);
    expect(a4[0].contentsObj.str).toBe('changed');
  });
});

describe('foreign annotations are kept untouched', () => {
  it('keeps a pre-existing inline /Annots entry and its order; only rl- names are removed', async () => {
    const bytes = handClassic({ pageExtra: '/Annots [ << /Type /Annot /Subtype /Text /Rect [10 10 30 30] /Contents (foreign) /NM (other-1) >> ]' });
    const r = write(bytes, { add: [HL()] });
    const a = await annotsOf(r.out);
    expect(a.map((x) => x.subtype)).toEqual(['Text', 'Highlight']);
    expect(a[0].contentsObj.str).toBe('foreign');
    const r2 = write(r.out, { remove: [{ page: 0, nm: 'rl-hl1' }, { page: 0, nm: 'other-1' }] });
    expect((await annotsOf(r2.out)).map((x) => x.subtype)).toEqual(['Text']);
  });
});

describe('page geometry', () => {
  const norm: Rect = [0.1, 0.2, 0.55, 0.26];
  const cases: [string, Parameters<typeof libPdf>[0]][] = [
    ['rotate 0', {}], ['rotate 90', { rotate: 90 }], ['rotate 180', { rotate: 180 }], ['rotate 270', { rotate: 270 }],
    ['shifted CropBox', { crop: [50, 80, 130, 140] }], ['shifted CropBox + rotate 90', { crop: [50, 80, 130, 140], rotate: 90 }],
    ['UserUnit 2', { userUnit: 2 }], ['UserUnit 2 + rotate 270', { userUnit: 2, rotate: 270 }],
  ];
  it.each(cases)('%s: written rectangle matches pdf.js convertToPdfPoint', async (_n, o) => {
    const bytes = await libPdf({ ...o, objectStreams: true });
    const c = open(bytes);
    const g = pageGeometry(getPage(c.doc, 0)!);
    const rects = toPdfRects([norm], g);
    const { out } = write(bytes, { add: [{ nm: 'rl-g', subtype: 'Highlight', page: 0, rects, color: [1, 1, 0] }] });
    const [a] = await annotsOf(out);
    const expected = await withPdfjs(out, async (doc) => {
      const vp = (await doc.getPage(1)).getViewport({ scale: 1 });
      const p0 = vp.convertToPdfPoint(norm[0] * vp.width, norm[1] * vp.height), p1 = vp.convertToPdfPoint(norm[2] * vp.width, norm[3] * vp.height);
      return [Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1])];
    });
    a.rect.forEach((v: number, i: number) => expect(v).toBeCloseTo(expected[i]!, 1));
  });
});
