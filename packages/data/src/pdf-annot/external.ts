// The highlights and underlines that OTHER programs wrote into a PDF (ARCHITETTURA-UI §8.3.14, J5): read only, in the worker. Our own
// objects (`/NM (rl-…)`) are skipped. The result holds what the user needs to choose and what the import creates: the page, the
// rectangles normalised as the app keeps them, the colour (an app colour when one is close) and the comment. Nothing here writes.
import { Ref } from './objects.js';
import { getPage, resolve, tick, type Doc } from './doc.js';
import { colorName, readAnnot } from './annot.js';
import { pageGeometry } from './geometry.js';
import { appRects, pageCountOf } from './plan.js';

export interface ExternalItem {
  /** `<page>:<object>.<generation>`: names the annotation again at import time (the file is read again then). */
  key: string;
  kind: 'highlight' | 'underline';
  /** 1-based. */
  page: number;
  rects: Array<{ x: number; y: number; w: number; h: number }>;
  color?: string;
  comment?: string;
  author?: string;
}

const MAX_ITEMS = 500;

export function listExternal(doc: Doc): { items: ExternalItem[]; truncated: boolean } {
  const items: ExternalItem[] = [];
  const pages = Math.min(pageCountOf(doc), 5000);
  for (let i = 0; i < pages; i++) {
    tick();
    const page = getPage(doc, i);
    const arr = page ? resolve(doc, page.dict.get('Annots')) : undefined;
    if (!page || !Array.isArray(arr)) continue;
    const g = pageGeometry(page);
    if (!(g.box[2] - g.box[0] > 0 && g.box[3] - g.box[1] > 0)) continue;
    for (const el of arr) {
      if (!(el instanceof Ref)) continue;
      const f = readAnnot(doc, el);
      if (!f || f.nm?.startsWith('rl-') || (f.subtype !== 'Highlight' && f.subtype !== 'Underline') || f.rects.length === 0) continue;
      if (items.length >= MAX_ITEMS) return { items, truncated: true };
      const rects = appRects(f.rects.slice(0, 200), g);
      if (rects.length === 0) continue;
      const color = colorName(f.sem.c);
      items.push({ key: `${i + 1}:${el.n}.${el.g}`, kind: f.subtype === 'Underline' ? 'underline' : 'highlight', page: i + 1, rects, ...(color ? { color } : {}), ...(f.sem.t ? { comment: f.sem.t } : {}), ...(f.sem.a ? { author: f.sem.a } : {}) });
    }
  }
  return { items, truncated: false };
}
