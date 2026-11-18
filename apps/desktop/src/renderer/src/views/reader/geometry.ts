import { ANNOTATION_COLORS, STUDY_LIMITS, type Annotation } from '@rl/core';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * A client rectangle as a fraction (0..1) of the page box; `null` when it is empty, outside the page or too tall to be a
 * line of text (the text layer holds one element that spans the whole page).
 */
export function normaliseRect(r: Box, frame: Box): Rect | null {
  if (frame.width <= 0 || frame.height <= 0) return null;
  const x = clamp01((r.left - frame.left) / frame.width);
  const y = clamp01((r.top - frame.top) / frame.height);
  const right = clamp01((r.left + r.width - frame.left) / frame.width);
  const bottom = clamp01((r.top + r.height - frame.top) / frame.height);
  const w = right - x;
  const h = bottom - y;
  if (w < 0.002 || h < 0.002 || h > 0.25) return null;
  return { x, y, w, h };
}

/** Joins the pieces of one line (same height band, touching) so a selection stays within `STUDY_LIMITS.rectsPerAnnotation`. */
export function mergeRects(rects: Rect[], max: number = STUDY_LIMITS.rectsPerAnnotation): Rect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Rect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last) {
      const overlap = Math.min(last.y + last.h, r.y + r.h) - Math.max(last.y, r.y);
      const sameLine = overlap > 0.6 * Math.min(last.h, r.h);
      const touching = r.x <= last.x + last.w + 0.01 && r.x + r.w >= last.x - 0.01;
      if (sameLine && touching) {
        const x = Math.min(last.x, r.x);
        const y = Math.min(last.y, r.y);
        last.w = Math.max(last.x + last.w, r.x + r.w) - x;
        last.h = Math.max(last.y + last.h, r.y + r.h) - y;
        last.x = x;
        last.y = y;
        continue;
      }
    }
    out.push({ ...r });
  }
  return out.slice(0, max);
}

/** The annotation under a point of a page (fractions), the smallest one when several overlap. */
export function annotationAt(annotations: readonly Annotation[], page: number, x: number, y: number): Annotation | undefined {
  let best: Annotation | undefined;
  let bestArea = Infinity;
  for (const a of annotations) {
    if (a.page !== page) continue;
    for (const r of a.rects) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        const area = r.w * r.h;
        if (area < bestArea) {
          best = a;
          bestArea = area;
        }
      }
    }
  }
  return best;
}

export type AnnotationColor = (typeof ANNOTATION_COLORS)[number];

/** The colour name the data holds, or yellow when it is not one of ours: the data never decides a style. */
export const colorOf = (name: string): AnnotationColor => (ANNOTATION_COLORS as readonly string[]).includes(name) ? (name as AnnotationColor) : 'yellow';

/** A short plain-text excerpt for lists. */
export const excerpt = (text: string, max = 120): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * The page with the most visible area (N17): pdf.js reports the first page that shows at all, so the field would still say
 * page 3 while page 4 fills the window. `pages` are `[number, top, bottom]` in the same coordinates as `viewport`.
 */
export function dominantPage(pages: ReadonlyArray<readonly [number, number, number]>, viewport: { top: number; bottom: number }): number | null {
  let best: number | null = null;
  let most = 0;
  for (const [n, top, bottom] of pages) {
    const seen = Math.min(bottom, viewport.bottom) - Math.max(top, viewport.top);
    if (seen > most) {
      most = seen;
      best = n;
    }
  }
  return best;
}

/** Every annotation under a point of a page (fractions): what an eraser stroke touches. */
export function annotationsAt(annotations: readonly Annotation[], page: number, x: number, y: number): string[] {
  return annotations.filter((a) => a.page === page && a.rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)).map((a) => a.id);
}
