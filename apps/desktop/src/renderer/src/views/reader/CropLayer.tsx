import { createPortal } from 'react-dom';
import type { Rect } from './geometry';

/** The crop rectangle being dragged on one page, drawn dashed in the accent colour (§17.4.8: "trascinamento"). */
export interface CropDrag {
  page: number;
  rect: Rect;
}

const pct = (n: number) => `${Math.round(Math.min(1, Math.max(0, n)) * 10000) / 100}%`;

/** Draws the drag into the overlay element the viewer made for its page (like the annotations, so it follows the zoom). */
export function CropLayer({ drag, layers }: { drag: CropDrag | null; layers: ReadonlyMap<number, HTMLElement> }) {
  const el = drag ? layers.get(drag.page) : undefined;
  if (!drag || !el?.isConnected) return null;
  const r = drag.rect;
  return createPortal(<div className="crop-rect" style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }} data-testid="crop-rect" />, el, `crop-${drag.page}`);
}
