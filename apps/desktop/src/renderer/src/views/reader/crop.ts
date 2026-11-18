import type { Rect } from './geometry';

/**
 * Crop (feature 27, §17.4.8): the pure parts of cutting a figure, table or equation out of a page. The rectangle comes from a
 * drag on one page (fractions of the page, like every annotation); the image is cut from the canvas pdf.js already drew.
 */

/** A rectangle smaller than this (in screen pixels, either side) is ignored: it was a click, not a crop. */
export const CROP_MIN_PX = 24;
/** The image stored for a crop is at most this many bytes (the main process refuses more). */
export const CROP_MAX_BYTES = 300 * 1024;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** The rectangle between two points of a page (fractions); the corners can come in any order and are kept inside the page. */
export function dragRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  const x0 = clamp01(Math.min(a.x, b.x));
  const y0 = clamp01(Math.min(a.y, b.y));
  const x1 = clamp01(Math.max(a.x, b.x));
  const y1 = clamp01(Math.max(a.y, b.y));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Too small to be a crop: under 24 px on a side at the size the page has now on screen. */
export function cropTooSmall(rect: Rect, frame: { width: number; height: number }): boolean {
  return rect.w * frame.width < CROP_MIN_PX || rect.h * frame.height < CROP_MIN_PX;
}

export interface CropImage {
  /** WebP, base64. */
  base64: string;
  width: number;
  height: number;
}

const toBlob = (c: HTMLCanvasElement, quality: number) => new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/webp', quality));

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Cuts `rect` out of the canvas of a page as a WebP of at most `CROP_MAX_BYTES`: the quality goes down first, then the size
 * (three quarters each time). `null` when the browser cannot encode WebP or nothing fits.
 */
export async function cutCanvas(canvas: HTMLCanvasElement, rect: Rect): Promise<CropImage | null> {
  const sx = Math.round(rect.x * canvas.width);
  const sy = Math.round(rect.y * canvas.height);
  const sw = Math.max(1, Math.min(canvas.width - sx, Math.round(rect.w * canvas.width)));
  const sh = Math.max(1, Math.min(canvas.height - sy, Math.round(rect.h * canvas.height)));
  let scale = 1;
  for (let attempt = 0; attempt < 6; attempt++) {
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(sw * scale));
    out.height = Math.max(1, Math.round(sh * scale));
    out.getContext('2d')?.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
    for (const q of [0.85, 0.7, 0.55]) {
      const blob = await toBlob(out, q);
      if (!blob) return null;
      if (blob.size <= CROP_MAX_BYTES) return { base64: await toBase64(blob), width: out.width, height: out.height };
    }
    scale *= 0.75;
  }
  return null;
}

/** One piece of text of the text layer with its centre, as fractions of the page. */
export interface TextItem {
  text: string;
  cx: number;
  cy: number;
}

/**
 * The text of a crop: `inside` is what lies in the rectangle, `around` what lies in it and in the band of `grow` (a fraction of
 * the page height) above and below. Items come in reading order (the order of the text layer).
 */
export function pickText(items: readonly TextItem[], rect: Rect, grow = 0.1): { inside: string; around: string } {
  const within = (i: TextItem, g: number) => i.cx >= rect.x - 0.02 && i.cx <= rect.x + rect.w + 0.02 && i.cy >= rect.y - g && i.cy <= rect.y + rect.h + g;
  const join = (xs: TextItem[]) => xs.map((i) => i.text.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
  return { inside: join(items.filter((i) => within(i, 0))), around: join(items.filter((i) => i.cx >= 0 && within({ ...i, cx: Math.min(Math.max(i.cx, rect.x), rect.x + rect.w) }, grow))) };
}

const squash = (t: string) => t.replace(/\s+/g, ' ').trim();

/**
 * The paragraph around a selection: the text of the page, `radius` characters before and after where the selection starts.
 * The selection is looked for by its first words (whitespace is not compared); when it is not found the start of the page text is used.
 */
export function contextAround(pageText: string, selection: string, radius = 1800): string {
  const page = squash(pageText);
  const sel = squash(selection);
  if (page === '') return '';
  const head = sel.slice(0, 40);
  const at = head === '' ? -1 : page.indexOf(head);
  const start = at < 0 ? 0 : Math.max(0, at - radius);
  const end = at < 0 ? radius * 2 : Math.min(page.length, at + sel.length + radius);
  return page.slice(start, end);
}

/** Puts a crop on the clipboard as an image (PNG: the clipboard does not take WebP). */
export async function copyCropImage(base64: string): Promise<void> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('The image could not be copied');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
