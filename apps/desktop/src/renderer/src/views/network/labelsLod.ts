/** Level of detail of the labels (§4.20): at low zoom only the topics; zooming in, the labels of the biggest nodes that do not overlap. */
export interface LabelCandidate {
  /** Index in the caller's list. */
  id: number;
  /** Screen position of the label's anchor (centre of its text) and width of the text. */
  x: number;
  y: number;
  w: number;
  /** Priority: the bigger, the earlier (node size). */
  size: number;
  /** Always shown (hovered, selected). */
  forced?: boolean;
}

export const CELL_W = 120;
export const CELL_H = 20;
export const MAX_LABEL_CHARS = 32;

/** The label text cut to 32 characters. */
export const shortLabel = (s: string): string => (s.length > MAX_LABEL_CHARS ? `${s.slice(0, MAX_LABEL_CHARS - 1)}…` : s);

/**
 * Chooses the labels to draw: forced ones first, then by decreasing size; a label is dropped when a cell of the 120x20 collision
 * grid it covers is already taken. Labels off the viewport are dropped (except forced ones). Returns the ids.
 */
export function pickLabels(cands: readonly LabelCandidate[], width: number, height: number, max = 400): number[] {
  const order = cands.filter((c) => c.forced || (c.x + c.w / 2 >= 0 && c.x - c.w / 2 <= width && c.y >= -CELL_H && c.y <= height + CELL_H)).sort((a, b) => (b.forced ? 1 : 0) - (a.forced ? 1 : 0) || b.size - a.size || a.id - b.id);
  const taken = new Set<number>();
  const out: number[] = [];
  for (const c of order) {
    const cx0 = Math.floor((c.x - c.w / 2) / CELL_W);
    const cx1 = Math.floor((c.x + c.w / 2) / CELL_W);
    const cy = Math.floor((c.y - CELL_H / 2) / CELL_H);
    const cy1 = Math.floor((c.y + CELL_H / 2 - 0.01) / CELL_H);
    let free = true;
    for (let gx = cx0; gx <= cx1 && free; gx++) for (let gy = cy; gy <= cy1; gy++) if (taken.has(gx * 65536 + gy)) free = false;
    if (!free && !c.forced) continue;
    for (let gx = cx0; gx <= cx1; gx++) for (let gy = cy; gy <= cy1; gy++) taken.add(gx * 65536 + gy);
    out.push(c.id);
    if (out.length >= max) break;
  }
  return out;
}

/** True when two label boxes (centre, width, fixed height) overlap: used by the tests. */
export const overlaps = (a: LabelCandidate, b: LabelCandidate): boolean => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < CELL_H;

export interface TopicLabelItem {
  id: number;
  /** Screen box of the core of the topic. */
  box: { x0: number; y0: number; x1: number; y1: number };
  /** Width of the text. */
  w: number;
  /** The bigger a topic, the earlier it is placed (and the later it is hidden). */
  size: number;
}

export const TOPIC_LABEL_H = 18;

/**
 * Labels of the topics (§4.22): each one is tried above the core, then below, on the right, on the left; the first place that
 * touches no label already placed (and stays in the view) wins. A topic with no free place is not labelled until the next zoom.
 * The biggest topics are placed first, so the smallest is the one hidden. Returns the centre of every label placed, by id.
 */
export function placeTopicLabels(items: readonly TopicLabelItem[], width: number, height: number): Map<number, { x: number; y: number }> {
  const placed: Array<{ x: number; y: number; w: number }> = [];
  const out = new Map<number, { x: number; y: number }>();
  const hit = (x: number, y: number, w: number) => placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 && Math.abs(p.y - y) < TOPIC_LABEL_H);
  const inside = (x: number, y: number, w: number) => x - w / 2 >= 0 && x + w / 2 <= width && y - TOPIC_LABEL_H / 2 >= 0 && y + TOPIC_LABEL_H / 2 <= height;
  for (const it of [...items].sort((a, b) => b.size - a.size || a.id - b.id)) {
    const b = it.box;
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    if (b.x1 < 0 || b.x0 > width || b.y1 < 0 || b.y0 > height) continue;
    const tries: Array<[number, number]> = [
      [cx, b.y0 - TOPIC_LABEL_H / 2 - 4],
      [cx, b.y1 + TOPIC_LABEL_H / 2 + 4],
      [b.x1 + it.w / 2 + 6, cy],
      [b.x0 - it.w / 2 - 6, cy],
    ];
    const spot = tries.find(([x, y]) => inside(x, y, it.w) && !hit(x, y, it.w));
    if (!spot) continue;
    placed.push({ x: spot[0], y: spot[1], w: it.w });
    out.set(it.id, { x: spot[0], y: spot[1] });
  }
  return out;
}
