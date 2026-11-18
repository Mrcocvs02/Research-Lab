// Page geometry and the transform between the rectangles of the app and the PDF user space (ARCHITETTURA-UI §8.3.2).
// The app keeps rectangles normalised 0..1 from the top-left of the page AS PDF.JS SHOWS IT (after /Rotate, on the CropBox).
import { asNum } from './objects.js';
import type { Page } from './doc.js';

export type Rect = [number, number, number, number];
export interface Geom { box: Rect; rotate: 0 | 90 | 180 | 270; userUnit: number }

const rectOf = (v: unknown): Rect | undefined => {
  if (!Array.isArray(v) || v.length !== 4 || v.some((x) => typeof x !== 'number' || !Number.isFinite(x))) return undefined;
  const [a, b, c, d] = v as number[];
  return [Math.min(a!, c!), Math.min(b!, d!), Math.max(a!, c!), Math.max(b!, d!)];
};

export function pageGeometry(p: Page): Geom {
  const media = rectOf(p.inh.MediaBox) ?? [0, 0, 612, 792];
  const crop = rectOf(p.inh.CropBox);
  const box: Rect = crop ? [Math.max(crop[0], media[0]), Math.max(crop[1], media[1]), Math.min(crop[2], media[2]), Math.min(crop[3], media[3])] : media;
  const r = (((asNum(p.inh.Rotate) ?? 0) % 360) + 360) % 360;
  return { box, rotate: (r % 90 === 0 ? r : 0) as Geom['rotate'], userUnit: asNum(p.dict.get('UserUnit')) ?? 1 };
}

const sizeOf = (g: Geom): [number, number, number, number, number, number] => [g.box[0], g.box[1], g.box[2], g.box[3], g.box[2] - g.box[0], g.box[3] - g.box[1]];

/** Normalised rectangles (0..1, top-left, as displayed) to default user space; each result is [x0 y0 x1 y1] with x0 <= x1. */
export function toPdfRects(rects: Rect[], g: Geom): Rect[] {
  const [x0, y0, x1, y1, w, h] = sizeOf(g);
  const pt = (u: number, v: number): [number, number] =>
    g.rotate === 0 ? [x0 + u * w, y1 - v * h] : g.rotate === 90 ? [x0 + v * w, y0 + u * h] : g.rotate === 180 ? [x1 - u * w, y0 + v * h] : [x1 - v * w, y1 - u * h];
  return rects.map(([u0, v0, u1, v1]) => {
    const a = pt(u0, v0), b = pt(u1, v1);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  });
}

/** The inverse of `toPdfRects`: user-space rectangles back to normalised [u0 v0 u1 v1]. */
export function fromPdfRects(rects: Rect[], g: Geom): Rect[] {
  const [x0, y0, x1, y1, w, h] = sizeOf(g);
  const uv = (x: number, y: number): [number, number] =>
    g.rotate === 0 ? [(x - x0) / w, (y1 - y) / h] : g.rotate === 90 ? [(y - y0) / h, (x - x0) / w] : g.rotate === 180 ? [(x1 - x) / w, (y - y0) / h] : [(y1 - y) / h, (x1 - x) / w];
  return rects.map(([ax, ay, bx, by]) => {
    const a = uv(ax, ay), b = uv(bx, by);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  });
}
