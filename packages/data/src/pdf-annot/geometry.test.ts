import { describe, expect, it } from 'vitest';
import { loadPdfjs } from '../extract/pdf.js';
import { bufSyncSource, getPage, loadDoc } from './doc.js';
import { docPdf, type PageSpec } from './gen.js';
import { fromPdfRects, pageGeometry, toPdfRects, type Geom, type Rect } from './geometry.js';

const geomOf = (spec: PageSpec): Geom => pageGeometry(getPage(loadDoc(bufSyncSource(docPdf({ pages: [spec] }))), 0)!);
const near = (a: number[], b: number[], eps = 1e-6) => {
  expect(a).toHaveLength(b.length);
  a.forEach((v, i) => expect(Math.abs(v - b[i]!)).toBeLessThan(eps));
};

describe('geometry: normalised rectangles <-> PDF user space (§8.3.2)', () => {
  const box: Rect = [10, 20, 210, 320]; // 200 x 300
  const r: Rect = [0.1, 0.2, 0.5, 0.3];

  it('the four rotations', () => {
    near(toPdfRects([r], { box, rotate: 0, userUnit: 1 })[0]!, [30, 230, 110, 260]);
    near(toPdfRects([r], { box, rotate: 90, userUnit: 1 })[0]!, [50, 50, 70, 170]);
    near(toPdfRects([r], { box, rotate: 180, userUnit: 1 })[0]!, [110, 80, 190, 110]);
    near(toPdfRects([r], { box, rotate: 270, userUnit: 1 })[0]!, [150, 170, 170, 290]);
  });

  it('the inverse gives the rectangle back, for every rotation and a shifted box', () => {
    for (const rotate of [0, 90, 180, 270] as const) {
      const g: Geom = { box, rotate, userUnit: 1 };
      near(fromPdfRects(toPdfRects([r], g), g)[0]!, r);
    }
  });

  it('every result has x0 <= x1 and y0 <= y1', () => {
    for (const rotate of [0, 90, 180, 270] as const) {
      const [a] = toPdfRects([[0.9, 0.9, 0.1, 0.1]], { box, rotate, userUnit: 1 });
      expect(a![0]).toBeLessThanOrEqual(a![2]);
      expect(a![1]).toBeLessThanOrEqual(a![3]);
    }
  });

  it('the page box: MediaBox, CropBox inside it, /Rotate and /UserUnit', () => {
    expect(geomOf({}).box).toEqual([0, 0, 200, 200]);
    expect(geomOf({ mediaBox: '[0 0 612 792]', cropBox: '[50 60 350 460]' }).box).toEqual([50, 60, 350, 460]);
    // a CropBox that sticks out of the MediaBox is cut to it
    expect(geomOf({ mediaBox: '[0 0 100 100]', cropBox: '[-10 -10 50 500]' }).box).toEqual([0, 0, 50, 100]);
    // reversed corners are put in order
    expect(geomOf({ mediaBox: '[200 200 0 0]' }).box).toEqual([0, 0, 200, 200]);
    expect(geomOf({ rotate: 270 }).rotate).toBe(270);
    expect(geomOf({ rotate: -90 }).rotate).toBe(270);
    expect(geomOf({ rotate: 450 }).rotate).toBe(90);
    expect(geomOf({ rotate: 45 }).rotate).toBe(0);
    expect(geomOf({ userUnit: 2 }).userUnit).toBe(2);
  });

  it('agrees with convertToPdfPoint of pdf.js on rotated, shifted and UserUnit pages', async () => {
    interface Viewport { width: number; height: number; convertToPdfPoint(x: number, y: number): [number, number] }
    interface Page { getViewport(o: { scale: number }): Viewport }
    const pdfjs = (await loadPdfjs()) as unknown as { getDocument(o: Record<string, unknown>): { promise: Promise<{ getPage(n: number): Promise<Page> }>; destroy(): Promise<void> } };
    const specs: PageSpec[] = [{}, { rotate: 90 }, { rotate: 180 }, { rotate: 270 }, { mediaBox: '[0 0 612 792]', cropBox: '[50 60 350 460]', rotate: 90 }, { userUnit: 2, rotate: 270 }];
    for (const spec of specs) {
      const bytes = docPdf({ pages: [spec] });
      const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useWorkerFetch: false, verbosity: 0 });
      try {
        const vp = (await (await task.promise).getPage(1)).getViewport({ scale: 1 });
        const g = pageGeometry(getPage(loadDoc(bufSyncSource(bytes)), 0)!);
        // two opposite corners of a normalised rectangle, as displayed
        const [u0, v0, u1, v1] = [0.1, 0.2, 0.5, 0.3];
        const a = vp.convertToPdfPoint(u0 * vp.width, v0 * vp.height);
        const b = vp.convertToPdfPoint(u1 * vp.width, v1 * vp.height);
        const mine = toPdfRects([[u0, v0, u1, v1]], g)[0]!;
        near(mine, [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], 0.01);
      } finally {
        await task.destroy();
      }
    }
  });
});
