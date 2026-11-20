import type { Channels, ResponseOf } from '@rl/core';
import { rl } from '../../lib/rl';
import { bundleWidth, controlPoint, edgeAlpha, type Bundle, type EvEdge } from './edges';
import { boundsOf, toScreenX, toScreenY, type Bounds, type View } from './geometry';
import type { MapTheme } from './colors';
import { ALL_LABELS_CELL_PX, byline, cutTitle, planPaperLabels, type Box, type PaperLabel } from './labelsLod';

/** Drawing of the blocks of the Map (D-498, section 19.2.2 and 19.2.4): pure geometry plus one function that paints a frame. */
export type FamilyResponse = ResponseOf<Channels, 'graph:family'>;
export type BlockSpec = NonNullable<FamilyResponse['blocks']>[number];

export const NONE_BLOCK = '__none';
export const OTHER_BLOCK = '__other';
/** World size of a cell and of the band with the name of a block (the same as `packages/graph/src/blocks.ts`). */
export const CELL_W = 150;
export const CELL_H = 54;
export const HEAD = 34;
/** Where the dot of a paper sits in its cell (world units from the top-left corner). */
export const DOT_X = 10;
export const DOT_Y = 13;
const DOT_R = 4.5;
const TEXT_X = 9;

export interface BlockBox extends BlockSpec {
  none: boolean;
  other: boolean;
  /** Index of the tint (`--area-1..7`), 7 for other values, 8 for no value. */
  tint: number;
}
export interface BlockView {
  ids: string[];
  index: Map<string, number>;
  /** Top-left corner of the cell of each paper. */
  x: Float64Array;
  y: Float64Array;
  /** Block of each paper and its satellites (other blocks, at most 2). */
  block: Int32Array;
  others: number[][];
  /** Reading state of each paper: 0 to read, 1 in studio, 2 read (D-525). */
  st: Uint8Array;
  blocks: BlockBox[];
  members: number[][];
  bounds: Bounds;
}

/** The papers and blocks the main process laid out; papers whose block is unknown are left out. */
export function buildBlockView(items: FamilyResponse['items'], specs: readonly BlockSpec[]): BlockView {
  const blocks: BlockBox[] = specs.map((b, i) => ({ ...b, none: b.id === NONE_BLOCK, other: b.id === OTHER_BLOCK, tint: b.id === NONE_BLOCK ? 8 : b.id === OTHER_BLOCK ? 7 : Math.min(i, 7) }));
  const at = new Map(blocks.map((b, i) => [b.id, i]));
  const placed = items.filter((it) => it.cell && it.block !== undefined && at.has(it.block));
  const n = placed.length;
  const ids = new Array<string>(n);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const block = new Int32Array(n);
  const others = new Array<number[]>(n);
  const st = new Uint8Array(n);
  const index = new Map<string, number>();
  const members: number[][] = blocks.map(() => []);
  placed.forEach((it, i) => {
    ids[i] = it.id;
    x[i] = it.cell![0]!;
    y[i] = it.cell![1]!;
    block[i] = at.get(it.block!)!;
    st[i] = it.st ?? 0;
    others[i] = (it.others ?? []).map((o) => at.get(o) ?? -1).filter((o) => o >= 0);
    index.set(it.id, i);
    members[block[i]!]!.push(i);
  });
  const xs = blocks.flatMap((b) => [b.x, b.x + b.w]);
  const ys = blocks.flatMap((b) => [b.y, b.y + b.h]);
  return { ids, index, x, y, block, others, st, blocks, members, bounds: boundsOf(xs, ys, xs.length) };
}

/** World position of the dot of a paper. */
export const dotX = (bv: BlockView, i: number): number => bv.x[i]! + DOT_X;
export const dotY = (bv: BlockView, i: number): number => bv.y[i]! + DOT_Y;

/** What is at a world point: a paper (its cell), the name of a block (`-2 - block`), or nothing (-1). */
export function hitBlocks(bv: BlockView, wx: number, wy: number): number {
  for (let b = 0; b < bv.blocks.length; b++) {
    const k = bv.blocks[b]!;
    if (wx < k.x || wx > k.x + k.w || wy < k.y || wy > k.y + k.h) continue;
    if (wy < k.y + HEAD) return -2 - b;
    for (const i of bv.members[b]!) if (wx >= bv.x[i]! && wx < bv.x[i]! + CELL_W && wy >= bv.y[i]! && wy < bv.y[i]! + CELL_H) return i;
    return -1;
  }
  return -1;
}

/** Zoom and centre that show a block with a margin. */
export function blockView(b: BlockBox, w: number, h: number, margin = 48): View {
  return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, k: Math.max(0.05, Math.min((w - 2 * margin) / b.w, (h - 2 * margin) / b.h, 4)) };
}

// ---- Titles and bylines of the papers, fetched a few at a time and kept for the session (never an id) ----
export interface PaperMeta {
  title: string;
  line2: string;
}
const metas = new Map<string, PaperMeta | null>();
const pending = new Set<string>();
export const peekMeta = (id: string): PaperMeta | null => metas.get(id) ?? null;
export function wantMeta(ids: readonly string[], done: () => void): void {
  for (const id of ids.filter((i) => !metas.has(i) && !pending.has(i)).slice(0, 60)) {
    pending.add(id);
    rl.invoke('documents:get', { docId: id })
      .then(
        (d) => metas.set(id, { title: d.title && d.title.trim() !== '' ? d.title : (d.path?.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? id.slice(0, 8)), line2: byline(d.authors, d.year) }),
        () => metas.set(id, null),
      )
      .finally(() => {
        pending.delete(id);
        done();
      });
  }
}

/** Fetches the titles of `ids` (at most `cap`) and resolves when they are in, so a picture made right after has its labels (the export). */
export async function loadMetas(ids: readonly string[], cap = 600): Promise<void> {
  const want = ids.slice(0, cap);
  for (let round = 0; round < Math.ceil(cap / 60) + 1; round++) {
    const missing = want.filter((id) => !metas.has(id));
    if (missing.length === 0) return;
    const batch = missing.filter((id) => !pending.has(id)).length;
    if (batch === 0) {
      await new Promise((r) => setTimeout(r, 20));
      continue;
    }
    await new Promise<void>((resolve) => {
      let left = Math.min(60, batch);
      wantMeta(missing, () => {
        if (--left <= 0) resolve();
      });
    });
  }
}

// ---- One frame ----
/**
 * What T3 and T4 add to a frame (section 20.10): reading marks, the papers of a multiple selection, isolated papers, the pair of blocks lit by
 * the side column, and the destination and ghost of a drag. Indices are those of the `BlockView`.
 */
export interface BlocksExtras {
  /** 0 to read, 1 in studio (a half dot), 2 read (a tick); the view's own `st` when absent. */
  st?: Uint8Array;
  multi?: ReadonlySet<number>;
  isolated?: ReadonlySet<number>;
  pairLit?: readonly [number, number] | null;
  drop?: { block: number; valid: boolean } | null;
  ghost?: { sx: number; sy: number; idx: number; count: number } | null;
}
/** Forced labels of a multiple selection above this many on the screen are left out; the rings stay. */
export const MULTI_LABELS_MAX = 60;

export interface BlocksFrame {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  v: View;
  bv: BlockView;
  th: MapTheme;
  hover: number;
  sel: number;
  cursor: number;
  /** Block lit by the pointer or the legend (the other papers go to 35 %), or -1. */
  lit: number;
  /** Edges to draw (already chosen) and the bundles between blocks. */
  edges: readonly EvEdge[];
  bundles: readonly Bundle[];
  /** Papers whose label is always placed (neighbours of the selection) and the central ones (labelled when the cells are small). */
  forced: ReadonlySet<number>;
  central: ReadonlySet<number>;
  /** Papers that pass the filters (null: all). */
  allow: ReadonlySet<string> | null;
  /** The papers on their way from the old layout: positions of the previous one by id and the progress 0..1. */
  fly: { from: ReadonlyMap<string, readonly [number, number]>; t: number } | null;
  redraw(): void;
  extras?: BlocksExtras | undefined;
}
export interface BlocksOut {
  /** Boxes of the labels of the papers and of the names of the blocks, in screen pixels. */
  labels: Array<Box & { id: string }>;
  names: Box[];
  /** Boxes of the ticks of the papers read (screen pixels): they sit left of the labels, never over them. */
  marks: Box[];
}

const tintOf = (th: MapTheme, tint: number): string => th.areas[tint] ?? th.muted;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The point where the segment from the centre of `b` towards (tx, ty) leaves the rectangle (screen pixels). */
function leave(b: Box, tx: number, ty: number): [number, number] {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  const s = Math.min(dx === 0 ? Infinity : b.w / 2 / Math.abs(dx), dy === 0 ? Infinity : b.h / 2 / Math.abs(dy), 1);
  return [cx + dx * s, cy + dy * s];
}

/** Position of a paper's dot on the screen (during a flight: between the old cell and the new). */
export function screenDot(f: Pick<BlocksFrame, 'bv' | 'v' | 'w' | 'h' | 'fly'>, i: number): [number, number] {
  let x = dotX(f.bv, i);
  let y = dotY(f.bv, i);
  const o = f.fly?.from.get(f.bv.ids[i]!);
  if (o && f.fly) {
    const e = f.fly.t * f.fly.t * (3 - 2 * f.fly.t);
    x = o[0] + DOT_X + (x - o[0] - DOT_X) * e;
    y = o[1] + DOT_Y + (y - o[1] - DOT_Y) * e;
  }
  return [toScreenX(f.v, x, f.w), toScreenY(f.v, y, f.h)];
}

/** The tick of a paper that is read: two segments above the dot, left of the label (which starts 7 px right of the dot). */
export function tickPoints(dx: number, dy: number): [number, number, number, number, number, number] {
  return [dx - 0.5, dy - 8.2, dx + 1.7, dy - 6, dx + 5.5, dy - 10.8];
}
/** Box of a tick with its line width. */
export const tickBox = (dx: number, dy: number): Box => ({ x: dx - 1.25, y: dy - 11.55, w: 7.5, h: 6.3 });

/** Paints the blocks, the edges, the papers and their labels; returns the boxes of the labels and of the names (what the tests check). */
export function drawBlocks(f: BlocksFrame, extrasArg?: BlocksExtras): BlocksOut {
  const { ctx, w, h, v, bv, th } = f;
  const ex = extrasArg ?? f.extras;
  const st = ex?.st ?? bv.st;
  const multi = ex?.multi && ex.multi.size > 0 ? ex.multi : null;
  const iso = ex?.isolated && ex.isolated.size > 0 ? ex.isolated : null;
  const pair = ex?.pairLit ?? null;
  const k = v.k;
  const out: BlocksOut = { labels: [], names: [], marks: [] };
  const dim = (b: number): boolean => f.lit >= 0 && f.lit !== b;
  const cellPx = CELL_W * k;
  const glow = new Set<number>();
  const focus = f.hover >= 0 ? f.hover : f.sel;
  if (focus >= 0) for (const o of bv.others[focus]!) glow.add(o);
  const sx = (x: number) => toScreenX(v, x, w);
  const sy = (y: number) => toScreenY(v, y, h);

  // Blocks: the frame, the name in the band above the papers (or above the block when the band is too thin), the names of the sub-areas.
  ctx.textBaseline = 'middle';
  const nameFs = clamp(12 * k, 12, 20);
  const inBand = HEAD * k >= nameFs + 8;
  bv.blocks.forEach((b, bi) => {
    const x0 = sx(b.x);
    const y0 = sy(b.y);
    const bw = b.w * k;
    const bh = b.h * k;
    if (x0 > w || y0 > h || x0 + bw < 0 || y0 + bh < 0) return;
    ctx.globalAlpha = dim(bi) ? 0.5 : 1;
    const lit = glow.has(bi) || f.lit === bi || (pair !== null && (pair[0] === bi || pair[1] === bi));
    const target = ex?.drop && ex.drop.block === bi ? ex.drop : null;
    ctx.lineWidth = target?.valid ? 2.5 : lit ? 2 : 1;
    ctx.strokeStyle = target ? (target.valid ? th.accent : th.muted) : lit ? th.accent : th.border;
    ctx.setLineDash(target && !target.valid ? [4, 3] : b.none ? [5, 4] : []);
    ctx.beginPath();
    ctx.roundRect(x0, y0, bw, bh, 8);
    if (target?.valid) {
      ctx.fillStyle = th.accent;
      ctx.globalAlpha = 0.1;
      ctx.fill();
      ctx.globalAlpha = dim(bi) ? 0.5 : 1;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `600 ${nameFs}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    let text = `${b.label} (${b.count})`;
    const room = Math.max(bw - 14, 24);
    if (ctx.measureText(text).width > room) {
      while (text.length > 2 && ctx.measureText(`${text}…`).width > room) text = text.slice(0, -1);
      text = `${text.trimEnd()}…`;
    }
    const ty = inBand ? y0 + (HEAD * k) / 2 : y0 - nameFs / 2 - 3;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = th.text;
    ctx.fillText(text, x0 + 7, ty);
    out.names.push({ x: x0 + 7, y: ty - nameFs / 2 - 2, w: tw, h: nameFs + 4 });
    if (b.sub.length > 0 && 20 * k >= 14) {
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = th.muted;
      for (const s of b.sub) ctx.fillText(s.label.length > 40 ? `${s.label.slice(0, 39)}…` : s.label, x0 + 7, sy(s.y) + (20 * k) / 2, Math.max(bw - 14, 20));
    }
  });
  ctx.globalAlpha = 1;

  // Bundles between blocks, then the single edges.
  for (const bd of f.bundles) {
    const A = bv.blocks[bd.a]!;
    const B = bv.blocks[bd.b]!;
    const ra = { x: sx(A.x), y: sy(A.y), w: A.w * k, h: A.h * k };
    const rb = { x: sx(B.x), y: sy(B.y), w: B.w * k, h: B.h * k };
    const [ax, ay] = leave(ra, rb.x + rb.w / 2, rb.y + rb.h / 2);
    const [bx, by] = leave(rb, ra.x + ra.w / 2, ra.y + ra.h / 2);
    ctx.strokeStyle = th.muted;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = bundleWidth(bd.pairs.length);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
  ctx.globalAlpha = 1;
  if (pair) {
    // The two blocks the side column points at: a dashed arc between their borders (never drawn at rest).
    const A = bv.blocks[pair[0]];
    const B = bv.blocks[pair[1]];
    if (A && B) {
      const ra = { x: sx(A.x), y: sy(A.y), w: A.w * k, h: A.h * k };
      const rb = { x: sx(B.x), y: sy(B.y), w: B.w * k, h: B.h * k };
      const [ax, ay] = leave(ra, rb.x + rb.w / 2, rb.y + rb.h / 2);
      const [bx, by] = leave(rb, ra.x + ra.w / 2, ra.y + ra.h / 2);
      const c = controlPoint(ax, ay, bx, by, 0.12);
      ctx.strokeStyle = th.accent;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(c.x, c.y, bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  for (const e of f.edges) {
    const a = bv.index.get(e.a);
    const b = bv.index.get(e.b);
    if (a === undefined || b === undefined) continue;
    const [ax, ay] = screenDot(f, a);
    const [bx, by] = screenDot(f, b);
    const c = controlPoint(ax, ay, bx, by, 0.12);
    const explicit = e.kinds.includes('cites') || e.kinds.includes('linked');
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(c.x, c.y, bx, by);
    if (e.kinds.includes('linked')) {
      ctx.strokeStyle = th.accent;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([]);
    } else if (e.kinds.includes('cites')) {
      ctx.strokeStyle = th.text;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = th.muted;
      ctx.globalAlpha = edgeAlpha(e.w ?? e.e, th.dark);
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (explicit) {
      // A small head at the second end: the direction of a citation is not kept, so it only marks the end of the link.
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(bx, by, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // Papers: a dot of the tint of the block, satellites for the other values, rings for the selected and the cursor.
  const selSet = new Set<number>(f.sel >= 0 ? [f.sel, ...f.forced] : []);
  // With isolated papers shown, the others go to 35 % (D-526).
  const faded = (i: number): boolean => (f.allow !== null && !f.allow.has(bv.ids[i]!)) || (f.sel >= 0 && !selSet.has(i)) || dim(bv.block[i]!) || (iso !== null && !iso.has(i));
  const visible: number[] = [];
  const dots: number[] = [];
  for (let i = 0; i < bv.ids.length; i++) {
    const [dx, dy] = screenDot(f, i);
    if (dx < -60 || dy < -30 || dx > w + 400 || dy > h + 40) continue;
    visible.push(i);
    dots.push(dx, dy);
  }
  visible.forEach((i, j) => {
    const dx = dots[j * 2]!;
    const dy = dots[j * 2 + 1]!;
    const b = bv.blocks[bv.block[i]!]!;
    const off = f.allow !== null && !f.allow.has(bv.ids[i]!);
    ctx.globalAlpha = off ? 0.1 : faded(i) ? 0.35 : 1;
    const tint = b.none ? (th.areas[8] ?? th.muted) : tintOf(th, b.tint);
    const reading = st[i] ?? 0;
    ctx.fillStyle = reading === 1 ? th.bg : b.none ? th.bg : tint;
    ctx.strokeStyle = reading === 1 ? tint : b.none ? tint : th.bg;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(dx, dy, DOT_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (reading === 1) {
      // In studio: the left half in the tint of the block, the right half the background (a shape, not only a colour).
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.arc(dx, dy, DOT_R, Math.PI / 2, (Math.PI * 3) / 2);
      ctx.closePath();
      ctx.fill();
    } else if (reading === 2) {
      // Read: a small tick above the dot, clear of the label that starts to its right.
      const [x0, y0, x1, y1, x2, y2] = tickPoints(dx, dy);
      ctx.strokeStyle = th.muted;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      out.marks.push(tickBox(dx, dy));
    }
    bv.others[i]!.forEach((o, s) => {
      ctx.fillStyle = tintOf(th, bv.blocks[o]!.tint);
      ctx.beginPath();
      ctx.arc(dx - 2 + s * 5, dy + 9, 2, 0, Math.PI * 2);
      ctx.fill();
    });
  });
  ctx.globalAlpha = 1;
  const ring = (i: number, width: number, dash: boolean) => {
    if (i < 0) return;
    const [rx, ry] = screenDot(f, i);
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = width;
    ctx.setLineDash(dash ? [3, 3] : []);
    ctx.beginPath();
    ctx.arc(rx, ry, DOT_R + 3.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  if (iso) {
    // Isolated papers: a dotted ring far from the dot, so it is not the ring of the selected nor the cursor (D-532).
    ctx.strokeStyle = th.warning;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 3]);
    visible.forEach((i, j) => {
      if (!iso.has(i)) return;
      const off = f.allow !== null && !f.allow.has(bv.ids[i]!);
      ctx.globalAlpha = off ? 0.1 : f.sel >= 0 && !selSet.has(i) ? 0.35 : 1;
      ctx.beginPath();
      ctx.arc(dots[j * 2]!, dots[j * 2 + 1]!, DOT_R + 6, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  let multiShown = 0;
  if (multi) {
    // The papers of a multiple selection wear the ring of the selected one, in one path.
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    visible.forEach((i, j) => {
      if (!multi.has(i)) return;
      multiShown++;
      const rx = dots[j * 2]!;
      const ry = dots[j * 2 + 1]!;
      ctx.moveTo(rx + DOT_R + 3.5, ry);
      ctx.arc(rx, ry, DOT_R + 3.5, 0, Math.PI * 2);
    });
    ctx.stroke();
  }
  ring(f.sel, 2, false);
  ring(f.cursor, 1.5, true);
  if (f.hover >= 0) {
    const [hx, hy] = screenDot(f, f.hover);
    ctx.fillStyle = th.text;
    ctx.beginPath();
    ctx.arc(hx, hy, DOT_R + 1, 0, Math.PI * 2);
    ctx.fill();
  }

  // Labels: all of them when the cell is wide enough, else the forced and the central ones; none while the papers are flying.
  if (!(f.fly && f.fly.t < 1)) {
    const wide = cellPx >= ALL_LABELS_CELL_PX;
    const items: LabelItem[] = [];
    visible.forEach((i, j) => {
      const forced = i === f.hover || i === f.sel || i === f.cursor || f.forced.has(i) || (multi !== null && multi.has(i) && multiShown <= MULTI_LABELS_MAX);
      if (wide || forced || f.central.has(i)) items.push({ id: bv.ids[i]!, x: dots[j * 2]!, y: dots[j * 2 + 1]!, forced, rank: f.central.has(i) ? 1 : 0, dimmed: faded(i) });
    });
    out.labels = paintLabels(ctx, items, out.names, w, h, Math.max(24, CELL_W * k - DOT_X * k - TEXT_X - 6), th, f.redraw);
  }
  if (ex?.ghost) paintGhost(f, ex.ghost);
  return out;
}

/** The dragged paper follows the pointer without delay (no easing, so reduced motion needs nothing special); a badge counts a group. */
function paintGhost({ ctx, bv, th }: Pick<BlocksFrame, 'ctx' | 'bv' | 'th'>, g: NonNullable<BlocksExtras['ghost']>): void {
  const b = bv.blocks[bv.block[g.idx] ?? 0];
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = b ? (b.none ? th.bg : tintOf(th, b.tint)) : th.muted;
  ctx.strokeStyle = th.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(g.sx, g.sy, DOT_R + 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (g.count > 1) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = th.accent;
    ctx.beginPath();
    ctx.arc(g.sx + 9, g.sy - 9, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = th.bg;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.min(g.count, 9999)), g.sx + 9, g.sy - 9);
    ctx.textAlign = 'left';
  }
  ctx.globalAlpha = 1;
}

export interface LabelItem {
  id: string;
  /** Screen position of the dot of the paper. */
  x: number;
  y: number;
  forced: boolean;
  rank: number;
  dimmed?: boolean;
}

/**
 * Two lines (title, "Surname year") to the right of each dot, in boxes that overlap neither each other nor `fixed` (the names of the blocks).
 * `room` is the width the text may take. Titles still being fetched are asked for and drawn once they arrive. Returns the boxes drawn.
 */
export function paintLabels(ctx: CanvasRenderingContext2D, items: readonly LabelItem[], fixed: readonly Box[], w: number, h: number, room: number, th: MapTheme, redraw: () => void, cap = Infinity): Array<Box & { id: string }> {
  wantMeta(items.map((it) => it.id), redraw);
  const chars = Math.max(6, Math.min(40, Math.floor(room / 6.5)));
  ctx.textBaseline = 'middle';
  ctx.font = '12.5px system-ui, sans-serif';
  const texts: Array<{ it: LabelItem; l1: string; l2: string }> = [];
  const cands: PaperLabel[] = [];
  for (const it of items) {
    const m = peekMeta(it.id);
    if (!m) continue;
    let l1 = cutTitle(m.title, chars);
    while (l1.length > 4 && ctx.measureText(l1).width > room) l1 = cutTitle(l1.replace(/…$/, ''), l1.length - 2);
    const l2 = m.line2.length > chars + 4 ? `${m.line2.slice(0, chars + 3)}…` : m.line2;
    const tw = Math.min(room, Math.max(ctx.measureText(l1).width, l2 ? ctx.measureText(l2).width : 0));
    texts.push({ it, l1, l2 });
    cands.push({ id: texts.length - 1, x: it.x + TEXT_X - 2, y: it.y - 9, w: tw + 4, h: l2 ? 30 : 17, forced: it.forced, rank: it.rank });
  }
  const out: Array<Box & { id: string }> = [];
  ctx.textAlign = 'left';
  for (const id of planPaperLabels(cands, fixed, w, h, cap)) {
    const c = cands[id]!;
    const t = texts[id]!;
    ctx.globalAlpha = t.it.dimmed && !c.forced ? 0.45 : 1;
    ctx.lineWidth = 3;
    ctx.strokeStyle = th.bg;
    ctx.font = '12.5px system-ui, sans-serif';
    ctx.strokeText(t.l1, c.x + 2, c.y + 9);
    ctx.fillStyle = th.text;
    ctx.fillText(t.l1, c.x + 2, c.y + 9);
    if (t.l2) {
      ctx.font = '12px system-ui, sans-serif';
      ctx.strokeText(t.l2, c.x + 2, c.y + 23);
      ctx.fillStyle = th.muted;
      ctx.fillText(t.l2, c.x + 2, c.y + 23);
    }
    out.push({ id: t.it.id, x: c.x, y: c.y, w: c.w, h: c.h });
  }
  ctx.globalAlpha = 1;
  return out;
}
