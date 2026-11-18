import { describe, expect, it } from 'vitest';
import type { Sem } from './annot.js';
import { Ref } from './objects.js';
import { reconcile, type AppItem, type PdfItem } from './reconcile.js';

const sem: Sem = { s: 'Highlight', q: [], c: [], t: '', a: '' };
const app = (id: string, rev: string, pdf?: AppItem['pdf']): AppItem => ({ id, page: 1, sem, rev, ...(pdf ? { pdf } : {}) });
const inPdf = (id: string, rev: string, n = 10): PdfItem => ({ id, page: 1, ref: new Ref(n, 0), sem, rev });
const written = (rev: string, objNum = 10, extra: { missing?: true } = {}): AppItem['pdf'] => ({ objNum, gen: 0, rev, ...extra });
const none = new Set<string>();
const empty = { add: [], modify: [], remove: [], adopt: [], missing: [], relink: [], conflicts: 0, foreign: 0 };

describe('the three-way comparison of §8.3.7 (the app, the PDF, and `rev`: what was written last)', () => {
  it('app equal, PDF equal: nothing', () => {
    expect(reconcile([app('a', 'R1', written('R1'))], [inPdf('a', 'R1')], new Set(['a']), none)).toEqual(empty);
  });

  it('app changed, PDF equal: write the new version', () => {
    const v = reconcile([app('a', 'R2', written('R1'))], [inPdf('a', 'R1')], new Set(['a']), none);
    expect(v.modify).toHaveLength(1);
    expect(v.modify[0]!.ref).toEqual(new Ref(10, 0));
    expect(v.conflicts).toBe(0);
  });

  it('app equal, PDF changed (another program): adopt it, and remember the new content', () => {
    const v = reconcile([app('a', 'R1', written('R1'))], [inPdf('a', 'R3')], new Set(['a']), none);
    expect(v.adopt.map((p) => p.id)).toEqual(['a']);
    expect(v.relink).toEqual([{ id: 'a', ref: new Ref(10, 0), rev: 'R3' }]);
    expect(v.modify).toEqual([]);
  });

  it('app equal, gone from the PDF: never adopted as a deletion, it is "to check"', () => {
    const v = reconcile([app('a', 'R1', written('R1'))], [], new Set(['a']), none);
    expect(v.missing).toEqual(['a']);
    expect(v.remove).toEqual([]);
    expect(v.add).toEqual([]);
  });

  it('app changed, gone from the PDF: also "to check", never written by itself', () => {
    const v = reconcile([app('a', 'R2', written('R1'))], [], new Set(['a']), none);
    expect(v).toEqual({ ...empty, missing: ['a'] });
  });

  it('already flagged as missing and still gone: not reported again', () => {
    expect(reconcile([app('a', 'R1', written('R1', 10, { missing: true }))], [], new Set(['a']), none)).toEqual(empty);
  });

  it('flagged as missing and back in the PDF (restored elsewhere): linked again', () => {
    const v = reconcile([app('a', 'R1', written('R1', 10, { missing: true }))], [inPdf('a', 'R1')], new Set(['a']), none);
    expect(v.relink).toHaveLength(1);
    expect(v.missing).toEqual([]);
  });

  it('both changed: the app wins and the conflict is counted', () => {
    const v = reconcile([app('a', 'R2', written('R1'))], [inPdf('a', 'R3')], new Set(['a']), none);
    expect(v.conflicts).toBe(1);
    expect(v.modify).toHaveLength(1);
    expect(v.adopt).toEqual([]);
  });

  it('both changed to the same content: no conflict, the mark is updated', () => {
    const v = reconcile([app('a', 'R2', written('R1'))], [inPdf('a', 'R2')], new Set(['a']), none);
    expect(v.conflicts).toBe(0);
    expect(v.modify).toEqual([]);
    expect(v.relink).toHaveLength(1);
  });

  it('deleted in the app and present in the PDF: the reference is taken out (only when this computer wrote it)', () => {
    expect(reconcile([], [inPdf('a', 'R1')], none, new Set(['a'])).remove.map((p) => p.id)).toEqual(['a']);
    // not known here: another computer's object, left alone (its sync may not have arrived)
    const v = reconcile([], [inPdf('a', 'R1')], none, none);
    expect(v.remove).toEqual([]);
    expect(v.foreign).toBe(1);
  });

  it('an annotation the app keeps but may not write now (no geom: 2) is not an orphan', () => {
    expect(reconcile([], [inPdf('a', 'R1')], new Set(['a']), new Set(['a']))).toEqual(empty);
  });

  it('present in the app without a mark and absent from the PDF: add', () => {
    expect(reconcile([app('a', 'R1')], [], new Set(['a']), none).add.map((a) => a.id)).toEqual(['a']);
  });

  it('present without a mark and found by /NM: same content links, other content is written over', () => {
    expect(reconcile([app('a', 'R1')], [inPdf('a', 'R1')], new Set(['a']), none).relink).toHaveLength(1);
    const v = reconcile([app('a', 'R1')], [inPdf('a', 'R9')], new Set(['a']), none);
    expect(v.modify).toHaveLength(1);
    expect(v.relink).toEqual([]);
  });

  it('a full save by another program renumbered the object: the mark follows it', () => {
    const v = reconcile([app('a', 'R1', written('R1', 10))], [inPdf('a', 'R1', 44)], new Set(['a']), none);
    expect(v.relink).toEqual([{ id: 'a', ref: new Ref(44, 0), rev: 'R1' }]);
    expect(v.add).toEqual([]);
  });

  it('is idempotent: applying the same state a second time asks for nothing', () => {
    const apps = [app('a', 'R1', written('R1')), app('b', 'R2', written('R2', 11))];
    const pdfs = [inPdf('a', 'R1'), inPdf('b', 'R2', 11)];
    const ids = new Set(['a', 'b']);
    expect(reconcile(apps, pdfs, ids, ids)).toEqual(empty);
    expect(reconcile(apps, pdfs, ids, ids)).toEqual(reconcile(apps, pdfs, ids, ids));
  });
});
