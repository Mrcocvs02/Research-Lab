import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { Annotation, AnnotationInput } from '@rl/core';
import { colorOf, type Rect } from './geometry';
import type { Located, Viewer } from './engine';
import { pieceFrom } from './selection';

/**
 * Repair of annotations saved while the page was stretched (D-347). Their rectangles were measured against a box that was
 * too narrow, and the width of the window at that time is unknown, so no factor can undo it: the rectangles are measured
 * again from the quoted text on the (now correct) text layer. The vertical axis was never distorted, so when the text
 * occurs more than once the occurrence closest to the saved vertical position wins.
 */

/** The text as it is compared: no spaces, no hyphens (a hyphen at the end of a line comes and goes with the layout), lower case. `map[i]` is the offset in `raw` of compact character i. */
export function compactOf(raw: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (/[\s\-­‐-―]/.test(ch)) continue;
    for (const c of ch.toLowerCase()) {
      text += c;
      map.push(i);
    }
  }
  return { text, map };
}

/** Where the quote occurs in a page text: `[start, end)` offsets in `raw`. At most `max` occurrences. */
export function findQuote(raw: string, quote: string, max = 40): Array<{ start: number; end: number }> {
  const q = compactOf(quote).text;
  if (q === '') return [];
  const page = compactOf(raw);
  const out: Array<{ start: number; end: number }> = [];
  for (let at = page.text.indexOf(q); at !== -1 && out.length < max; at = page.text.indexOf(q, at + 1)) {
    out.push({ start: page.map[at]!, end: page.map[at + q.length - 1]! + 1 });
  }
  return out;
}

export type Pick = { kind: 'found'; index: number } | { kind: 'ambiguous' } | { kind: 'none' };

/**
 * Chooses among occurrences by the vertical centre (fractions of the page height). Two occurrences closer to each other
 * than one line cannot be told apart by position: that is ambiguous and goes to the user.
 */
export function pickNearest(centers: readonly number[], saved: number, line: number): Pick {
  if (centers.length === 0) return { kind: 'none' };
  const order = centers.map((c, index) => ({ index, d: Math.abs(c - saved), c })).sort((a, b) => a.d - b.d);
  const [best, second] = order;
  if (second && Math.abs(second.c - best!.c) < line) return { kind: 'ambiguous' };
  return { kind: 'found', index: best!.index };
}

const area = (r: Rect) => r.w * r.h;
const inter = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Intersection over union of two sets of rectangles (each set is made of lines that do not overlap each other). */
export function overlapRatio(a: readonly Rect[], b: readonly Rect[]): number {
  const i = a.reduce((n, ra) => n + b.reduce((m, rb) => m + inter(ra, rb), 0), 0);
  const u = a.reduce((n, r) => n + area(r), 0) + b.reduce((n, r) => n + area(r), 0) - i;
  return u <= 0 ? 0 : i / u;
}

/** The vertical centre of a set of rectangles. */
export const centerY = (rects: readonly Rect[]): number => {
  const top = Math.min(...rects.map((r) => r.y));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return (top + bottom) / 2;
};

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Measures the quote on the text layer of one page, like a selection of that text would be measured when an annotation is
 * created (`pieceFrom`). `rectsOf` is the DOM measurement (replaced in tests, where there is no layout).
 */
export function locateInTextLayer(
  textLayer: Element,
  page: number,
  frame: Box,
  quote: string,
  savedCenter: number,
  line: number,
  rectsOf: (range: Range) => Iterable<Box> = (r) => r.getClientRects(),
): Located {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let raw = '';
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
    starts.push(raw.length);
    raw += (n as Text).data;
  }
  const at = (offset: number, end: boolean): [Text, number] | null => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const lo = starts[i]!;
      if (offset > lo || (offset === lo && !end) || (offset === lo && end && i === 0)) return [nodes[i]!, offset - lo];
    }
    return null;
  };
  const measured: Array<{ rects: Rect[]; text: string }> = [];
  for (const occ of findQuote(raw, quote)) {
    const a = at(occ.start, false);
    const b = at(occ.end, true);
    if (!a || !b) continue;
    const range = document.createRange();
    range.setStart(a[0], a[1]);
    range.setEnd(b[0], b[1]);
    const piece = pieceFrom(page, rectsOf(range), frame, range.toString());
    if (piece) measured.push({ rects: piece.rects, text: piece.text });
  }
  const pick = pickNearest(measured.map((m) => centerY(m.rects)), savedCenter, line);
  if (pick.kind !== 'found') return { status: pick.kind };
  const chosen = measured[pick.index]!;
  return { status: 'found', rects: chosen.rects, text: chosen.text };
}

/** The bits of the reader the repair needs. */
interface RepairArgs {
  ready: boolean;
  loaded: boolean;
  annotations: readonly Annotation[];
  layers: ReadonlyMap<number, HTMLElement>;
  viewerRef: RefObject<Viewer | null>;
  save(input: AnnotationInput): Promise<Annotation | null>;
  info(text: string, action?: { label: string; run(): void }): void;
  docId: string;
}

const inputOf = (a: Annotation, over: Partial<AnnotationInput> = {}): AnnotationInput => ({
  id: a.id,
  kind: a.kind,
  page: a.page,
  rects: a.rects,
  text: a.text,
  color: colorOf(a.color),
  ...(a.comment !== undefined ? { comment: a.comment } : {}),
  geom: 2,
  ...over,
});

/**
 * Runs the repair for every annotation without `geom` on the pages that are drawn, one at a time. Annotations that cannot
 * be placed (no text, text not found, ambiguous) are returned in `review`; `accept` and `reposition` settle them.
 */
export function useRepair({ ready, loaded, annotations, layers, viewerRef, save, info, docId }: RepairArgs) {
  const { t } = useTranslation();
  const [flagged, setFlagged] = useState<ReadonlySet<string>>(new Set());
  const [tick, setTick] = useState(0);
  const tried = useRef(new Set<string>());
  const running = useRef(false);
  const toasted = useRef(false);
  const undo = useRef<Annotation[]>([]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const latest = useRef({ annotations, save, info, t });
  latest.current = { annotations, save, info, t };

  useEffect(() => {
    tried.current = new Set();
    toasted.current = false;
    undo.current = [];
    setFlagged(new Set());
  }, [docId]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !loaded || !viewer || running.current) return;
    const todo = annotations.filter((a) => a.geom !== 2 && !tried.current.has(a.id) && (a.text.trim() === '' || layers.get(a.page)?.isConnected));
    if (todo.length === 0) return;
    running.current = true;
    void (async () => {
      let repaired = 0;
      const flag: string[] = [];
      for (const a of todo) {
        if (!alive.current) break;
        tried.current.add(a.id);
        if (a.text.trim() === '') {
          flag.push(a.id);
          continue;
        }
        const found = await viewer.locateText(a.page, a.text, centerY(a.rects), Math.max(a.rects[0]?.h ?? 0, 0.01));
        if (found.status !== 'found') {
          flag.push(a.id);
          continue;
        }
        const same = overlapRatio(a.rects, found.rects) >= 0.9;
        const saved = await latest.current.save(inputOf(a, same ? {} : { rects: found.rects }));
        if (saved && !same) {
          undo.current.push(a);
          repaired++;
        }
      }
      running.current = false;
      if (!alive.current) return;
      if (flag.length > 0) setFlagged((cur) => new Set([...cur, ...flag]));
      if (repaired > 0 && !toasted.current) {
        toasted.current = true;
        const { info: show, t: tr } = latest.current;
        show(tr('reader.repair.done', { count: repaired }), {
          label: tr('reader.repair.undo'),
          run: () => {
            for (const old of undo.current.splice(0)) void latest.current.save(inputOf(old));
          },
        });
      }
      setTick((n) => n + 1);
    })();
  }, [ready, loaded, annotations, layers, viewerRef, tick]);

  const review = annotations.filter((a) => flagged.has(a.id) && a.geom !== 2).map((a) => a.id);

  /** "Va bene così": the rectangles are kept and the annotation counts as checked. */
  const accept = useCallback((a: Annotation) => save(inputOf(a)), [save]);
  /** "Riposiziona": the text selected again replaces the rectangles (and the quote) of the annotation. */
  const reposition = useCallback((a: Annotation, rects: Rect[], text: string) => save(inputOf(a, { rects, text })), [save]);

  return { review: new Set(review), accept, reposition };
}
