/**
 * Blocks of the Map (D-498, section 19.2.2): one block per value of the chosen family, each paper in a grid cell, the blocks packed on shelves.
 * Pure and deterministic (ties by id); the blocks never overlap by construction. The renderer only draws and animates.
 */
export const CELL_W = 150;
export const CELL_H = 54;
export const BLOCK_GAP = 60;
export const BLOCK_HEAD = 34;
export const SUB_HEAD = 20;
export const MAX_VALUES = 12;
export const OTHER_BLOCK = '__other';
export const NO_VALUE_BLOCK = '__none';
const SUB_MIN_DOCS = 8;

export interface BlockDoc {
  id: string;
  /** Level 1 value (null: no value). */
  value: string | null;
  /** Level 2 value inside the block. */
  sub?: string | null | undefined;
  /** Position on the map of today, to keep similar papers close. */
  x?: number | undefined;
  y?: number | undefined;
  /** Other values of the paper (satellite dots). */
  others?: readonly string[] | undefined;
}
export interface BlockInput {
  docs: readonly BlockDoc[];
  /** Labels of the values and of the sub-areas. */
  labels: ReadonlyMap<string, string>;
  /** Width over height of the canvas. */
  aspect: number;
  otherLabel?: string | undefined;
  noneLabel?: string | undefined;
}
export interface Block {
  id: string;
  label: string;
  count: number;
  x: number;
  y: number;
  w: number;
  h: number;
  sub: Array<{ id: string; label: string; y: number }>;
}
export interface BlockLayout {
  blocks: Block[];
  /** Top-left corner of the cell of each paper, in world units. */
  cells: Map<string, [number, number]>;
  /** The block of each paper and its satellites (at most 2, ids of other blocks). */
  blockOf: Map<string, { block: string; others: string[] }>;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Papers ordered along the main axis of their positions (2D PCA, the sign fixed so that the axis points right, or up when vertical). */
function alongAxis(docs: readonly BlockDoc[]): BlockDoc[] {
  const n = docs.length;
  if (n < 2) return [...docs];
  let mx = 0;
  let my = 0;
  for (const d of docs) {
    mx += d.x ?? 0;
    my += d.y ?? 0;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const d of docs) {
    const dx = (d.x ?? 0) - mx;
    const dy = (d.y ?? 0) - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let ux = Math.cos(theta);
  let uy = Math.sin(theta);
  if (ux < -1e-9 || (Math.abs(ux) <= 1e-9 && uy < 0)) {
    ux = -ux;
    uy = -uy;
  }
  const proj = new Map(docs.map((d) => [d.id, ((d.x ?? 0) - mx) * ux + ((d.y ?? 0) - my) * uy]));
  return [...docs].sort((a, b) => proj.get(a.id)! - proj.get(b.id)! || cmp(a.id, b.id));
}

interface Group {
  id: string | null;
  docs: BlockDoc[];
}

/** Blocks, cells and the block of each paper. The values beyond the 12th biggest go to "Other"; papers with no value to the last block. */
const COLUMN_FACTORS = [1, 1.5, 2, 3] as const;

export function layoutBlocks(input: BlockInput): BlockLayout {
  const count = new Map<string, number>();
  for (const d of input.docs) if (d.value !== null) count.set(d.value, (count.get(d.value) ?? 0) + 1);
  const ranked = [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)! || cmp(a, b));
  const keep = new Set(ranked.slice(0, MAX_VALUES));
  const members = new Map<string, BlockDoc[]>();
  const blockOf = new Map<string, { block: string; others: string[] }>();
  for (const d of input.docs) {
    const id = d.value === null ? NO_VALUE_BLOCK : keep.has(d.value) ? d.value : OTHER_BLOCK;
    (members.get(id) ?? members.set(id, []).get(id)!).push(d);
    const others = [...new Set((d.others ?? []).map((o) => (keep.has(o) ? o : OTHER_BLOCK)).filter((o) => o !== id))].sort(cmp).slice(0, 2);
    blockOf.set(d.id, { block: id, others });
  }
  const order = [...ranked.slice(0, MAX_VALUES), OTHER_BLOCK, NO_VALUE_BLOCK].filter((id) => members.has(id));

  const aspect = input.aspect > 0 && Number.isFinite(input.aspect) ? input.aspect : 1.6;
  // The blocks are near-square; on a wide canvas they may take more columns (factor 1, 1.5, 2, 3) when the whole layout then fills
  // the canvas better: with 25 papers in 3 blocks at 1280 x 800 the square blocks used a third of the width and the cells fell under
  // the width where every title is drawn (D-509). The smallest factor wins a tie, so the layout stays deterministic.
  let best: { fit: number; out: BlockLayout } | null = null;
  for (const factor of COLUMN_FACTORS) {
    const out = pack(factor);
    let w = 0;
    let h = 0;
    for (const b of out.blocks) {
      w = Math.max(w, b.x + b.w);
      h = Math.max(h, b.y + b.h);
    }
    const fit = Math.min(aspect / Math.max(1, w), 1 / Math.max(1, h));
    if (!best || fit > best.fit * 1.0001) best = { fit, out };
  }
  return best!.out;

  function pack(factor: number): BlockLayout {
  // Size of each block (cells in rows; sub-area headers when there are enough papers and sub-areas).
  const shapes = order.map((id) => {
    const docs = members.get(id)!;
    const n = docs.length;
    const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt(0.36 * n * factor))));
    const subCount = new Map<string, number>();
    for (const d of docs) if (d.sub) subCount.set(d.sub, (subCount.get(d.sub) ?? 0) + 1);
    const subs = [...subCount].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).map(([s]) => s);
    const useSub = n >= SUB_MIN_DOCS && subs.length >= 2;
    const groups: Group[] = [];
    if (useSub) {
      const bySub = new Map<string, BlockDoc[]>(subs.map((s) => [s, []]));
      const rest: BlockDoc[] = [];
      for (const d of docs) (d.sub && bySub.has(d.sub) ? bySub.get(d.sub)! : rest).push(d);
      for (const s of subs) groups.push({ id: s, docs: alongAxis(bySub.get(s)!) });
      if (rest.length > 0) groups.push({ id: null, docs: alongAxis(rest) });
    } else groups.push({ id: null, docs: alongAxis(docs) });
    let rows = 0;
    let headers = 0;
    for (const g of groups) {
      rows += Math.ceil(g.docs.length / cols);
      if (useSub && g.id !== null) headers++;
    }
    return { id, cols, groups, w: cols * CELL_W, h: BLOCK_HEAD + headers * SUB_HEAD + rows * CELL_H, n };
  });

  // Shelf packing in order, the width aimed at sqrt(total area x aspect of the canvas).
  const area = shapes.reduce((s, b) => s + (b.w + BLOCK_GAP) * (b.h + BLOCK_GAP), 0);
  const target = Math.max(Math.sqrt(area * aspect), ...shapes.map((b) => b.w));
  const blocks: Block[] = [];
  const cells = new Map<string, [number, number]>();
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const b of shapes) {
    if (x > 0 && x + b.w > target) {
      x = 0;
      y += shelf + BLOCK_GAP;
      shelf = 0;
    }
    const sub: Block['sub'] = [];
    let cy = y + BLOCK_HEAD;
    for (const g of b.groups) {
      if (g.id !== null) {
        sub.push({ id: g.id, label: input.labels.get(g.id) ?? g.id, y: cy });
        cy += SUB_HEAD;
      }
      g.docs.forEach((d, i) => {
        const r = Math.floor(i / b.cols);
        const c0 = i % b.cols;
        const c = r % 2 === 1 ? b.cols - 1 - c0 : c0;
        cells.set(d.id, [x + c * CELL_W, cy + r * CELL_H]);
      });
      cy += Math.ceil(g.docs.length / b.cols) * CELL_H;
    }
    const label = b.id === OTHER_BLOCK ? (input.otherLabel ?? 'Other') : b.id === NO_VALUE_BLOCK ? (input.noneLabel ?? 'No value') : (input.labels.get(b.id) ?? b.id);
    blocks.push({ id: b.id, label, count: b.n, x, y, w: b.w, h: b.h, sub });
    x += b.w + BLOCK_GAP;
    shelf = Math.max(shelf, b.h);
  }
  return { blocks, cells, blockOf };
  }
}
