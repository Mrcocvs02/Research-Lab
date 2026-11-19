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

/** A box on the screen: top-left corner and size. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface PaperLabel extends Box {
  /** Index in the caller's list. */
  id: number;
  /** Hovered, selected, neighbour of the selection, end of a path: placed first. */
  forced?: boolean;
  /** Priority among the others: the bigger, the earlier (centrality). */
  rank: number;
}

/** Width of a paper's cell on the screen from which every paper is labelled (D-498); below it only the forced and the central ones. 90, not 110:
 * a row is then still 32 px for a 30 px label, and at 1280 x 800 a 25-paper library showed 5-6 titles of 25 (D-505). */
export const ALL_LABELS_CELL_PX = 90;
/** Labels of the free layout ("Nessuno") in view at once. */
export const FREE_LABEL_CAP = 40;

const apart = (a: Box, b: Box): boolean => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;

/**
 * Titles of the papers (section 19.2.4): forced ones first, then by rank; a label is placed only when it overlaps no label already
 * placed and none of the `fixed` boxes (the names of the blocks, which are placed before everything). Labels off the view are dropped.
 * Never two boxes overlap. Returns the ids placed.
 */
export function planPaperLabels(cands: readonly PaperLabel[], fixed: readonly Box[], width: number, height: number, max = Infinity): number[] {
  const placed: Box[] = [...fixed];
  const out: number[] = [];
  const order = cands.filter((c) => c.x + c.w >= 0 && c.x <= width && c.y + c.h >= 0 && c.y <= height).sort((a, b) => (b.forced ? 1 : 0) - (a.forced ? 1 : 0) || b.rank - a.rank || a.id - b.id);
  for (const c of order) {
    if (out.length >= max) break;
    if (!placed.every((p) => apart(p, c))) continue;
    placed.push(c);
    out.push(c.id);
  }
  return out;
}

/** The title cut at a word to `max` characters, with an ellipsis (a word longer than the room is cut). */
export function cutTitle(title: string, max: number): string {
  const s = title.replace(/\s+/g, ' ').trim();
  const room = Math.max(4, max);
  if (s.length <= room) return s;
  const head = s.slice(0, room - 1);
  const at = head.lastIndexOf(' ');
  return `${(at >= room * 0.5 ? head.slice(0, at) : head).replace(/[\s,;:.\-–]+$/, '')}…`;
}

/** "Surname year" of the second line of a label (the surname of the first author; either part may be missing). */
export function byline(authors: readonly string[], year: number | null): string {
  const first = (authors[0] ?? '').trim();
  const surname = first.includes(',') ? first.split(',')[0]!.trim() : (first.split(/\s+/).pop() ?? '');
  return [surname, year ?? ''].filter((p) => p !== '').join(' ');
}

/** The central papers: the top 10 % by evidence degree (at least one per block, only with some evidence), as indices into `degree`. */
export function centralPapers(degree: ArrayLike<number>, blockOf: ArrayLike<number>): Set<number> {
  const n = degree.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => degree[b]! - degree[a]! || a - b);
  const out = new Set<number>(order.slice(0, Math.max(1, Math.ceil(n * 0.1))).filter((i) => degree[i]! > 0));
  const seen = new Set<number>([...out].map((i) => blockOf[i]!));
  for (const i of order) {
    if (!seen.has(blockOf[i]!)) {
      seen.add(blockOf[i]!);
      out.add(i);
    }
  }
  return out;
}
