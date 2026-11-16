import { THUMB_LIMITS } from '@rl/core';
import { loadPdfjs, pdfDocumentParams, type PdfjsLib } from './pdfjs';

/**
 * Draws the first page of a PDF as a small WebP image (D-195). This module is a lazy chunk of its own: it is fetched,
 * together with pdf.js, only when a thumbnail must be drawn. One pdf.js worker is shared by the documents of a run and
 * released by `releaseDrawer` (the queue calls it after a while without work).
 */

/** Width of a thumbnail in CSS pixels; the bitmap is this times the pixel ratio, capped by `THUMB_LIMITS.maxSide`. */
export const THUMB_CSS_WIDTH = 240;
const QUALITIES = [0.75, 0.6, 0.45, 0.3] as const;

export type DrawFailure = 'encrypted' | 'invalid' | 'failed';
export class DrawError extends Error {
  readonly kind: DrawFailure;
  constructor(kind: DrawFailure) {
    super(kind);
    this.name = 'DrawError';
    this.kind = kind;
  }
}

/** Bitmap size for a page: `THUMB_CSS_WIDTH` wide at the device pixel ratio, neither side above `maxSide`. */
export function thumbSize(pageWidth: number, pageHeight: number, pixelRatio: number): { width: number; height: number; scale: number } {
  const ratio = Math.min(Math.max(pixelRatio || 1, 1), 3);
  let scale = (THUMB_CSS_WIDTH * ratio) / pageWidth;
  scale = Math.min(scale, THUMB_LIMITS.maxSide / pageWidth, THUMB_LIMITS.maxSide / pageHeight);
  return { width: Math.max(1, Math.round(pageWidth * scale)), height: Math.max(1, Math.round(pageHeight * scale)), scale };
}

let pdfjs: PdfjsLib | null = null;
let worker: InstanceType<PdfjsLib['PDFWorker']> | null = null;

const toBytes = async (canvas: HTMLCanvasElement): Promise<Uint8Array> => {
  for (const quality of QUALITIES) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob || blob.type !== 'image/webp') throw new DrawError('failed');
    if (blob.size <= THUMB_LIMITS.maxBytes) return new Uint8Array(await blob.arrayBuffer());
  }
  throw new DrawError('failed');
};

/** Draws page 1 of the PDF at `url` (an `rl-doc://` URL). Rejects with a `DrawError`; always frees what it opened. */
export async function drawFirstPage(url: string): Promise<Uint8Array> {
  pdfjs ??= await loadPdfjs();
  worker ??= new pdfjs.PDFWorker({ verbosity: 0 });
  const task = pdfjs.getDocument({ ...pdfDocumentParams(url), worker });
  try {
    const doc = await new Promise<Awaited<typeof task.promise>>((resolve, reject) => {
      task.onPassword = () => reject(new DrawError('encrypted'));
      task.promise.then(resolve, reject);
    });
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const size = thumbSize(base.width, base.height, window.devicePixelRatio);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new DrawError('failed');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size.width, size.height);
    try {
      await page.render({ canvasContext: ctx, canvas, viewport: page.getViewport({ scale: size.scale }) }).promise;
      return await toBytes(canvas);
    } finally {
      page.cleanup();
      canvas.width = canvas.height = 0; // gives the bitmap back at once
    }
  } catch (e) {
    if (e instanceof DrawError) throw e;
    const name = (e as { name?: string } | null)?.name;
    throw new DrawError(name === 'InvalidPDFException' || name === 'FormatError' ? 'invalid' : 'failed');
  } finally {
    void task.destroy().catch(() => {});
  }
}

/** Stops the shared pdf.js worker (its memory and thread) until the next drawing. */
export function releaseDrawer(): void {
  const w = worker;
  worker = null;
  w?.destroy();
}
