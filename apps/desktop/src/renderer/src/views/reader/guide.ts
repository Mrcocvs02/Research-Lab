import type { GuidePassage } from '@rl/core';
import type { Rect } from './geometry';

/** Where a passage is on its page (fractions): the rectangles of its sentence, or a short span at the top for a passage with no quote. */
export interface Placed {
  passage: GuidePassage;
  rects: Rect[];
}

/** The vertical extent of a passage as a margin bar: from its first line to its last, never shorter than a line. */
export function barSpan(rects: readonly Rect[]): { top: number; height: number } {
  const top = Math.min(...rects.map((r) => r.y));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { top: Math.max(0, top), height: Math.max(0.012, bottom - top) };
}

/** A passage read from the literature note has no sentence to find: a short bar at the top of its page. */
export const noteRects = (): Rect[] => [{ x: 0.1, y: 0.05, w: 0.8, h: 0.04 }];

const keptKey = (docId: string) => `rl.guideKept.${docId}`;

/** The passages the user kept (they became highlights and leave the guide). Read only while the guide is on. */
export function loadKept(docId: string): ReadonlySet<string> {
  try {
    const v = JSON.parse(window.localStorage.getItem(keptKey(docId)) ?? '[]') as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 64) : []);
  } catch {
    return new Set();
  }
}

export function saveKept(docId: string, kept: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(keptKey(docId), JSON.stringify([...kept].slice(0, 64)));
  } catch {
    // no storage: kept for this session only
  }
}

/** Marks, at most this many per paper and this share of a page, as the experiment's thresholds say. */
export const GUIDE_MAX_MARKS = 12;
