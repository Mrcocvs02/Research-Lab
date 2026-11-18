import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { removeDir, tempDir } from '../test-utils.js';
import { COLORS, cutContents, readAnnot, revOf, semOf } from './annot.js';
import { bufSyncSource, getPage, loadDoc, resolve, resolveObj, type Doc } from './doc.js';
import { FOREIGN, PAGE_WITH_ANNOTS, docPdf, type DocSpec } from './gen.js';
import { fromPdfRects, pageGeometry, toPdfRects } from './geometry.js';
import { Ref, asDict, asNum } from './objects.js';
import { planSync, type PlanAnnot, type SyncRequest, type SyncResult } from './plan.js';
import { HIGHLIGHT, appendRevision } from './test-pdfs.js';
import { verifyFile } from './verify.js';

type Plan = Extract<SyncResult, { ok: true }>;
const NOW = '2026-02-01T00:00:00.000Z';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const startxref = (b: Buffer): number => Number([...b.toString('latin1').matchAll(/startxref\s+(\d+)/g)].pop()![1]);

let dir: string;
let counter = 0;
beforeAll(async () => {
  dir = await tempDir('rl-annot-');
});
afterAll(() => removeDir(dir));

const annot = (id: string, over: Partial<PlanAnnot> = {}): PlanAnnot => ({ id, kind: 'highlight', page: 1, rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.05 }], color: 'yellow', createdAt: NOW, ...over });
/** The annotation as the app stores it after a write: with the mark of the object. */
const marked = (a: PlanAnnot, res: Plan): PlanAnnot => {
  const m = res.marks.find((x) => x.id === a.id);
  return m ? { ...a, pdf: { objNum: m.objNum, gen: m.gen, rev: m.rev } } : a;
};

async function file(buf: Buffer): Promise<string> {
  const p = path.join(dir, `f${++counter}.pdf`);
  await writeFile(p, buf);
  return p;
}

/** Runs the plan on `buf`; returns the result and the file after the update (the original bytes are checked to be its exact prefix). */
async function sync(buf: Buffer, annotations: PlanAnnot[], over: Partial<SyncRequest> = {}): Promise<{ res: Plan; out: Buffer }> {
  const req: SyncRequest = { path: await file(buf), mode: 'sync', annotations, otherIds: [], known: {}, now: NOW, ...over };
  const res = planSync(req);
  if (!res.ok) throw new Error(`refused: ${res.reason} ${res.detail}`);
  if (!res.update) return { res, out: buf };
  expect(res.update.oldSize).toBe(buf.length);
  const out = Buffer.concat([buf, res.update.bytes]);
  expect(out.length).toBe(res.update.newSize);
  expect(out.subarray(0, buf.length).equals(buf)).toBe(true); // the original is an exact prefix
  return { res, out };
}

const load = (b: Buffer): Doc => loadDoc(bufSyncSource(b));
/** The references of a page's /Annots in order, with the `/NM` ours carry. */
function annotsOf(out: Buffer, page = 0): Array<{ ref: Ref; nm: string | undefined }> {
  const doc = load(out);
  const arr = resolve(doc, getPage(doc, page)!.dict.get('Annots'));
  return Array.isArray(arr) ? arr.map((el) => ({ ref: el as Ref, nm: readAnnot(doc, el as Ref)?.nm })) : [];
}
const ours = (out: Buffer, page = 0) => annotsOf(out, page).filter((a) => a.nm?.startsWith('rl-'));
const othersOf = (out: Buffer, page = 0) => annotsOf(out, page).filter((a) => !a.nm?.startsWith('rl-'));

const withForeign = (n: number, over: DocSpec = {}): Buffer => {
  // a classic file whose page 1 already lists `n` annotations of "another program" (an incremental revision, inline /Annots)
  const base = docPdf({ pages: 1, ...over });
  return appendRevision(base, [[3, PAGE_WITH_ANNOTS(`[${Array.from({ length: n }, (_, i) => `${10 + i} 0 R`).join(' ')}]`)], ...Array.from({ length: n }, (_, i): [number, string] => [10 + i, FOREIGN(i)])]);
};

describe('writing: the original is always an exact prefix (§8.3.3, §8.3.13)', () => {
  const cases: Array<[string, () => Buffer]> = [
    ['classic table', () => docPdf()],
    ['xref stream with object streams', () => docPdf({ kind: 'stream' })],
    ['xref stream with the PNG predictor', () => docPdf({ kind: 'stream', predictor: true })],
    ['hybrid /XRefStm', () => docPdf({ kind: 'hybrid' })],
    ['rotated 90', () => docPdf({ pages: [{ rotate: 90 }] })],
    ['rotated 270, CropBox shifted', () => docPdf({ pages: [{ mediaBox: '[0 0 612 792]', cropBox: '[50 60 350 460]', rotate: 270 }] })],
    ['UserUnit 2', () => docPdf({ pages: [{ userUnit: 2 }] })],
    ['nested page tree with inherited attributes', () => docPdf({ tree: 'nested', pages: 3 })],
    ['data after %%EOF', () => docPdf({ junk: 'trailing bytes\n' })],
    ['foreign annotations already on the page', () => withForeign(2)],
  ];

  it.each(cases)('%s: one annotation is added, the structure keeps its kind, /Prev, /Size and /Root', async (_name, make) => {
    const buf = make();
    const before = load(buf);
    const { res, out } = await sync(buf, [annot('a1', { comment: 'note' })]);
    expect(res.update).not.toBeNull();
    const after = load(out);
    expect(after.lastKind).toBe(before.lastKind); // the update has the same kind as the last section (a hybrid ends in a table)
    expect(after.sections).toBe(before.sections + 1);
    expect(asNum(after.trailer.get('Prev'))).toBe(startxref(buf));
    expect(after.trailer.get('Root')).toEqual(before.trailer.get('Root'));
    expect(after.size).toBeGreaterThan(before.size);
    expect(asNum(after.trailer.get('Size'))).toBeGreaterThanOrEqual(after.size);
    const [mine] = ours(out);
    expect(mine?.nm).toBe('rl-a1');
    const f = readAnnot(after, mine!.ref)!;
    expect(f.subtype).toBe('Highlight');
    expect(revOf(f.sem)).toBe(res.marks.find((m) => m.id === 'a1')!.rev);
    expect(f.sem.t).toBe('note');
  });

  it.each(cases)('%s: the written file passes the verification, with pdf.js too', async (_name, make) => {
    const buf = make();
    const { res, out } = await sync(buf, [annot('a1')]);
    const p = await file(out);
    const m = res.marks[0]!;
    const v = await verifyFile({ path: p, oldSize: buf.length, oldHash: sha(buf), expect: res.expect, pages: res.pages, deep: [{ page: 0, objNum: m.objNum, gen: m.gen, subtype: 'Highlight' }] });
    expect(v).toEqual({ ok: true, size: out.length, sha256: sha(out) });
  });
});

describe('writing: /Annots, order and other programs\' annotations', () => {
  it('an inline /Annots becomes indirect at the first write and the page is never rewritten again', async () => {
    const buf = withForeign(1);
    expect(asDict(getPage(load(buf), 0)!.dict)!.get('Annots')).toBeInstanceOf(Array);
    const first = await sync(buf, [annot('a1')]);
    const page1 = getPage(load(first.out), 0)!.dict.get('Annots');
    expect(page1).toBeInstanceOf(Ref);
    expect(first.res.update!.bytes.toString('latin1')).toMatch(/(^|\n)3 0 obj\n/);
    const second = await sync(first.out, [marked(annot('a1', { color: 'green' }), first.res)]);
    expect(second.res.update).not.toBeNull();
    expect(second.res.update!.bytes.toString('latin1')).not.toMatch(/(^|\n)3 0 obj\n/); // only the array and the annotation
    expect(getPage(load(second.out), 0)!.dict.get('Annots')).toEqual(page1);
  });

  it('the annotations of other programs keep their order and presence; ours go to the end', async () => {
    const buf = withForeign(3);
    const { out } = await sync(buf, [annot('a1'), annot('a2')]);
    const all = annotsOf(out);
    expect(all.map((a) => a.ref.n)).toEqual([10, 11, 12, ...all.slice(3).map((a) => a.ref.n)]);
    expect(all.slice(0, 3).map((a) => a.nm)).toEqual(['other-0', 'other-1', 'other-2']);
    expect(all.slice(3).map((a) => a.nm)).toEqual(['rl-a1', 'rl-a2']);
  });

  it('add, modify and remove in successive updates', async () => {
    const a1 = annot('a1'), a2 = annot('a2', { page: 1, rects: [{ x: 0.2, y: 0.5, w: 0.3, h: 0.05 }] });
    const w1 = await sync(withForeign(1), [a1, a2]);
    const doc1 = load(w1.out);
    const ref1 = ours(w1.out).find((a) => a.nm === 'rl-a1')!.ref;

    // modify: colour and comment; the object keeps its number, the array is rewritten, other annotations untouched
    const mod = marked({ ...a1, color: 'blue', comment: 'later' }, w1.res);
    const w2 = await sync(w1.out, [mod, marked(a2, w1.res)], { known: { a1: 1, a2: 1 } });
    const ref1b = ours(w2.out).find((a) => a.nm === 'rl-a1')!.ref;
    expect(ref1b).toEqual(ref1);
    expect(readAnnot(load(w2.out), ref1b)!.sem.t).toBe('later');
    expect(readAnnot(load(w2.out), ref1b)!.sem.c).toEqual(COLORS['blue']!.map((n) => Number(n.toFixed(2))));
    expect(othersOf(w2.out)).toHaveLength(1);
    expect(doc1.size).toBeLessThanOrEqual(load(w2.out).size);

    // remove a1 (deleted in the app): its reference leaves /Annots, a2 and the foreign annotation stay
    const w3 = await sync(w2.out, [marked(a2, w1.res)], { known: { a1: 1, a2: 1 } });
    expect(w3.res.cleared).toEqual(['a1']);
    expect(ours(w3.out).map((a) => a.nm)).toEqual(['rl-a2']);
    expect(othersOf(w3.out).map((a) => a.nm)).toEqual(['other-0']);
  });

  it('modifying an object that lives in an object stream writes it back as a normal object', async () => {
    const base = docPdf({ kind: 'stream' });
    const w1 = await sync(base, [annot('a1')]);
    const w2 = await sync(w1.out, [marked(annot('a1', { comment: 'edit' }), w1.res)]);
    expect(readAnnot(load(w2.out), ours(w2.out)[0]!.ref)!.sem.t).toBe('edit');
    expect(load(w2.out).lastKind).toBe('stream');
  });

  it('the new /ID second string changes and the first stays when the trailer has one', async () => {
    const buf = docPdf({ trailer: '/ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]' });
    const { out } = await sync(buf, [annot('a1')]);
    const id = resolve(load(out), load(out).trailer.get('ID')) as Array<{ b: Buffer }>;
    expect(id[0]!.b.toString('hex')).toBe('00112233445566778899aabbccddeeff');
    expect(id[1]!.b.toString('hex')).not.toBe('00112233445566778899aabbccddeeff');
  });

  it('the appearance stream is a form XObject with the BBox of the annotation, and /AP points at it', async () => {
    const { out } = await sync(docPdf(), [annot('a1')]);
    const doc = load(out);
    const d = asDict(resolve(doc, ours(out)[0]!.ref))!;
    const ap = asDict(d.get('AP'))!.get('N') as Ref;
    const ind = resolveObj(doc, ap.n)!;
    expect(ind.dataStart).toBeGreaterThan(0);
    const dict = asDict(ind.val)!;
    expect((dict.get('Subtype') as { v: string }).v).toBe('Form');
    expect(Array.isArray(dict.get('BBox'))).toBe(true);
    expect(d.get('Rect')).toEqual(dict.get('BBox'));
  });
});

describe('writing: idempotence and two computers (§8.3.7)', () => {
  it('the same state twice is one update only', async () => {
    const a = annot('a1');
    const w1 = await sync(docPdf(), [a]);
    const w2 = await sync(w1.out, [marked(a, w1.res)]);
    expect(w2.res.update).toBeNull();
    expect(w2.out.equals(w1.out)).toBe(true);
    // even when the app lost its marks (another computer, restored data): the object is found by /NM and adopted, nothing is added
    const w3 = await sync(w1.out, [a]);
    expect(w3.res.update).toBeNull();
    expect(w3.res.marks).toHaveLength(1);
    expect(ours(w1.out)).toHaveLength(1);
  });

  it('two computers: each writes its annotations, nothing is lost or doubled', async () => {
    const a1 = annot('a1'), a2 = annot('a2', { rects: [{ x: 0.3, y: 0.6, w: 0.2, h: 0.05 }] });
    const onA = await sync(docPdf(), [a1]);
    // computer B has not synced a1 yet: it writes a2 and leaves the unknown object of ours alone
    const onB = await sync(onA.out, [a2], { known: {}, otherIds: [] });
    expect(onB.res.foreign).toBe(1);
    expect(ours(onB.out).map((x) => x.nm).sort()).toEqual(['rl-a1', 'rl-a2']);
    // B then receives a1 from the synced data: it is found, not added again
    const onB2 = await sync(onB.out, [a1, marked(a2, onB.res)], { known: { a2: 1 } });
    expect(onB2.res.update).toBeNull();
    expect(ours(onB2.out)).toHaveLength(2);
  });

  it('an annotation that has a mark but is gone from the PDF is reported as missing, never rewritten by itself', async () => {
    const a = annot('a1');
    const w1 = await sync(docPdf(), [a]);
    const cleaned = docPdf(); // another program saved a clean file
    const r = await sync(cleaned, [marked(a, w1.res)]);
    expect(r.res.missing).toEqual(['a1']);
    expect(r.res.update).toBeNull();
    const again = await sync(cleaned, [{ ...marked(a, w1.res), pdf: { ...marked(a, w1.res).pdf!, missing: true } }]);
    expect(again.res.update).toBeNull();
    expect(again.res.missing).toEqual([]);
  });

  it('a change made in another program (colour, comment) is adopted by the app and nothing is written', async () => {
    const a = annot('a1');
    const w1 = await sync(docPdf(), [a]);
    const ref = ours(w1.out)[0]!.ref;
    // another program rewrites the object (same /NM) with another colour and comment
    const edited = appendRevision(w1.out, [[ref.n, HIGHLIGHT('rl-a1').replace('[1 1 0]', '[0.55 0.75 1]')]]);
    const r = await sync(edited, [marked(a, w1.res)]);
    expect(r.res.adopt).toHaveLength(1);
    expect(r.res.adopt[0]!.color).toBe('blue');
    expect(r.res.adopt[0]!.comment).toBe('note (1)');
    expect(r.res.update).toBeNull();
  });
});

describe('writing: geometry, text and colour end to end', () => {
  it('the written QuadPoints are the rectangle as displayed, on a rotated and shifted page', async () => {
    const buf = docPdf({ pages: [{ mediaBox: '[0 0 612 792]', cropBox: '[50 60 350 460]', rotate: 90 }] });
    const rect = { x: 0.1, y: 0.2, w: 0.5, h: 0.05 };
    const { out } = await sync(buf, [annot('a1', { rects: [rect] })]);
    const doc = load(out);
    const g = pageGeometry(getPage(doc, 0)!);
    const f = readAnnot(doc, ours(out)[0]!.ref)!;
    const want = toPdfRects([[rect.x, rect.y, rect.x + rect.w, rect.y + rect.h]], g)[0]!;
    f.rects[0]!.forEach((v, i) => expect(Math.abs(v - want[i]!)).toBeLessThan(0.01));
    // and back: the app gets the rectangle it wrote
    const [back] = fromPdfRects(f.rects, g);
    expect(Math.abs(back![0] - rect.x)).toBeLessThan(0.001);
    expect(Math.abs(back![3] - (rect.y + rect.h))).toBeLessThan(0.001);
  });

  it('several rectangles make several quads, and an underline is an /Underline', async () => {
    const { out } = await sync(docPdf(), [annot('u1', { kind: 'underline', rects: [{ x: 0.1, y: 0.1, w: 0.4, h: 0.04 }, { x: 0.1, y: 0.15, w: 0.2, h: 0.04 }] })]);
    const f = readAnnot(load(out), ours(out)[0]!.ref)!;
    expect(f.subtype).toBe('Underline');
    expect(f.rects).toHaveLength(2);
  });

  it.each([
    ['parentheses and backslash', 'a (b) c \\ d'],
    ['new lines', 'one\ntwo\r\nthree'],
    ['non-Latin text', 'Привет мир — 你好 — مرحبا'],
    ['emoji', 'idea 💡 ok 🙂'],
    ['accents', 'perché à è ì ò ù'],
  ])('/Contents survives: %s', async (_n, text) => {
    const { out } = await sync(docPdf(), [annot('a1', { comment: text })]);
    expect(readAnnot(load(out), ours(out)[0]!.ref)!.sem.t).toBe(text);
  });

  it('a comment over 8000 characters is cut with an ellipsis', async () => {
    const long = 'x'.repeat(9000);
    const { out } = await sync(docPdf(), [annot('a1', { comment: long })]);
    const t = readAnnot(load(out), ours(out)[0]!.ref)!.sem.t;
    expect(t).toHaveLength(8000);
    expect(t.endsWith('…')).toBe(true);
    expect(t).toBe(cutContents(long));
  });

  it('no author name unless the library asks for it (D-448); with it, /T is written', async () => {
    const none = await sync(docPdf(), [annot('a1')]);
    const text = none.res.update!.bytes.toString('latin1');
    expect(text).not.toMatch(/\/T[ (<]/);
    expect(text).not.toMatch(/\/Creator|\/Author/);
    const named = await sync(docPdf(), [annot('a1')], { author: 'Ada Lovelace' });
    expect(readAnnot(load(named.out), ours(named.out)[0]!.ref)!.sem.a).toBe('Ada Lovelace');
  });

  it('the semantic content is what the three-way comparison hashes: it moves with colour, comment and rectangles, not with the id', () => {
    const base = { subtype: 'Highlight' as const, rects: [[1, 2, 3, 4]] as Array<[number, number, number, number]>, color: [1, 0.92, 0.23] as [number, number, number] };
    const h = revOf(semOf(base));
    expect(revOf(semOf({ ...base, contents: 'x' }))).not.toBe(h);
    expect(revOf(semOf({ ...base, color: [0.55, 0.9, 0.45] }))).not.toBe(h);
    expect(revOf(semOf({ ...base, rects: [[1, 2, 3, 5]] }))).not.toBe(h);
    expect(revOf(semOf({ ...base, rects: [[1.001, 2, 3, 4]] }))).toBe(h); // rounded to 0.01
  });
});

describe('writing: take them out (D-352) and verification', () => {
  it('removes only the /NM (rl-…) references; the others and the prefix stay', async () => {
    const buf = withForeign(2);
    const w1 = await sync(buf, [annot('a1'), annot('a2', { rects: [{ x: 0.3, y: 0.5, w: 0.2, h: 0.05 }] })]);
    const r = await sync(w1.out, [], { mode: 'remove-all', known: { a1: 1, a2: 1 } });
    expect(r.res.cleared.sort()).toEqual(['a1', 'a2']);
    expect(ours(r.out)).toHaveLength(0);
    expect(othersOf(r.out).map((a) => a.nm)).toEqual(['other-0', 'other-1']);
    expect(r.out.subarray(0, w1.out.length).equals(w1.out)).toBe(true);
  });

  it('remove-all with nothing of ours writes nothing', async () => {
    const r = await sync(withForeign(1), [], { mode: 'remove-all' });
    expect(r.res.update).toBeNull();
  });

  it('the verification refuses a result that cannot be read back exactly', async () => {
    const buf = docPdf();
    const w = await sync(buf, [annot('a1')]);
    const req = { oldSize: buf.length, oldHash: sha(buf), expect: w.res.expect, pages: w.res.pages };
    // the prefix changed
    const bad = Buffer.from(w.out);
    bad[20] = bad[20]! ^ 0xff;
    expect((await verifyFile({ ...req, path: await file(bad) }))).toEqual({ ok: false, detail: 'prefix-changed' });
    // not grown
    expect((await verifyFile({ ...req, path: await file(buf) }))).toEqual({ ok: false, detail: 'not-grown' });
    // another content than the one expected
    const wrong = w.res.expect.map((e) => ({ ...e, ours: e.ours.map((o) => ({ ...o, rev: 'f'.repeat(64) })) }));
    expect((await verifyFile({ ...req, expect: wrong, path: await file(w.out) }))).toEqual({ ok: false, detail: 'ours-mismatch' });
    // a page lost
    expect((await verifyFile({ ...req, pages: 2, path: await file(w.out), deep: [{ page: 0, objNum: w.res.marks[0]!.objNum, gen: 0, subtype: 'Highlight' }] }))).toEqual({ ok: false, detail: 'pages-changed' });
    // pdf.js does not find a subtype
    expect((await verifyFile({ ...req, path: await file(w.out), deep: [{ page: 0, objNum: w.res.marks[0]!.objNum, gen: 0, subtype: 'Underline' }] }))).toEqual({ ok: false, detail: 'pdfjs-missing' });
  });
});
