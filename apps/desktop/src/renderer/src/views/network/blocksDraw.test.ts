import { describe, expect, it, vi } from 'vitest';
import { layoutBlocks } from '../../../../../../../packages/graph/src/blocks';
import type { MapTheme } from './colors';
import { fitView } from './geometry';
import { buildBlockView, drawBlocks, hitBlocks, peekMeta, tickBox, CELL_H, CELL_W, HEAD, type BlocksExtras, type BlocksFrame, type FamilyResponse } from './blocksDraw';

vi.mock('../../lib/rl', () => ({
  rl: {
    invoke: async (_channel: string, p: { docId: string }) => {
      const n = Number(p.docId.slice(1));
      return { title: `A fairly long title of paper number ${n} about something quite specific and technical`, authors: [`Surname${n}, Given`], year: 2000 + (n % 25), path: `p${n}.pdf` };
    },
  },
}));

const ids = Array.from({ length: 25 }, (_, i) => `d${i}`);
/** 25 papers in the groups of the plan: 10, 8, 4 and 3 papers. */
function layout(aspect: number) {
  const sizes = [10, 8, 4, 3];
  const docs = ids.map((id, i) => {
    const g = sizes.findIndex((_, s) => i < sizes.slice(0, s + 1).reduce((a, b) => a + b, 0));
    return { id, value: `v${g}`, x: i % 5, y: Math.floor(i / 5) };
  });
  return layoutBlocks({ docs, labels: new Map(sizes.map((_, g) => [`v${g}`, `Value number ${g}`])), aspect });
}
const view = (aspect: number) => {
  const l = layout(aspect);
  const items: FamilyResponse['items'] = ids.map((id) => ({ id, cell: l.cells.get(id)!, block: l.blockOf.get(id)!.block, others: l.blockOf.get(id)!.others }));
  return buildBlockView(items, l.blocks);
};

/** A context that measures text at 6.5 px per character and ignores every drawing call. */
const fakeCtx = (): CanvasRenderingContext2D => {
  const target: Record<string, unknown> = { measureText: (s: string) => ({ width: s.length * 6.5 }) };
  return new Proxy(target, { get: (t, k: string) => (k in t ? t[k] : () => undefined), set: (t, k: string, v) => ((t[k] = v), true) }) as unknown as CanvasRenderingContext2D;
};
const theme: MapTheme = { dark: false, text: '#000', muted: '#555', accent: '#06c', warning: '#a60', bg: '#fff', surface: '#fff', border: '#ccc', tints: [], areas: Array.from({ length: 9 }, () => '#888') };

describe('blocks of the Map', () => {
  it('places every paper in a cell of its block, and finds it by a point', () => {
    const bv = view(1.6);
    expect(bv.ids).toHaveLength(25);
    expect(bv.blocks.map((b) => b.count)).toEqual([10, 8, 4, 3]);
    for (let i = 0; i < bv.ids.length; i++) {
      const b = bv.blocks[bv.block[i]!]!;
      expect(bv.x[i]!).toBeGreaterThanOrEqual(b.x);
      expect(bv.x[i]! + CELL_W).toBeLessThanOrEqual(b.x + b.w + 1e-6);
      expect(bv.y[i]!).toBeGreaterThanOrEqual(b.y + HEAD);
      expect(hitBlocks(bv, bv.x[i]! + 5, bv.y[i]! + CELL_H / 2)).toBe(i);
    }
    const b0 = bv.blocks[0]!;
    expect(hitBlocks(bv, b0.x + 10, b0.y + 5)).toBe(-2);
    expect(hitBlocks(bv, -1000, -1000)).toBe(-1);
  });

  it('keeps the blocks apart', () => {
    const { blocks } = view(1.6);
    for (const a of blocks) for (const b of blocks) if (a !== b) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
  });

  it('leaves out papers whose block is unknown', () => {
    const l = layout(1.6);
    const bv = buildBlockView([{ id: 'x', cell: [0, 0], block: 'nope' }, { id: 'y' }, { id: 'd0', cell: l.cells.get('d0')!, block: l.blockOf.get('d0')!.block }], l.blocks);
    expect(bv.ids).toEqual(['d0']);
  });
});

describe('labels of the Map', () => {
  for (const [name, width, height] of [['1280', 1280 - 48, 700], ['1920', 1920 - 248 - 64, 820]] as const) {
    it(`draws all 25 titles with no overlap at ${name}`, async () => {
      const bv = view(width / height);
      const v = fitView(bv.bounds, width, height);
      v.k = Math.min(v.k, 2.2);
      const frame = (): ReturnType<typeof drawBlocks> => {
        const f: BlocksFrame = { ctx: fakeCtx(), w: width, h: height, v, bv, th: theme, hover: -1, sel: -1, cursor: -1, lit: -1, edges: [], bundles: [], forced: new Set(), central: new Set(), allow: null, fly: null, redraw: () => undefined };
        return drawBlocks(f);
      };
      frame();
      await vi.waitFor(() => expect(peekMeta('d24')).not.toBeNull());
      const out = frame();
      expect(out.labels).toHaveLength(25);
      expect(out.names).toHaveLength(4);
      const boxes = [...out.labels, ...out.names];
      const apart = (a: (typeof boxes)[number], b: (typeof boxes)[number]) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(apart(boxes[i]!, boxes[j]!), `${i} and ${j}`).toBe(true);
      for (const b of out.labels) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(width);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.y + b.h).toBeLessThanOrEqual(height);
      }
    });
  }
});

describe('every title from a cell of 90 px (D-505)', () => {
  it('a row of a cell 90 px wide still holds the two lines of a label (30 px)', async () => {
    const { ALL_LABELS_CELL_PX } = await import('./labelsLod');
    expect(ALL_LABELS_CELL_PX).toBeLessThanOrEqual(90);
    expect((CELL_H * ALL_LABELS_CELL_PX) / CELL_W).toBeGreaterThanOrEqual(30);
  });
});

interface Arc {
  x: number;
  y: number;
  r: number;
  a0: number;
  a1: number;
  stroke: unknown;
  width: unknown;
  dash: unknown;
}
/** A context that measures text and records the arcs with the stroke, width and dashes in force when they were made. */
function recCtx(): { ctx: CanvasRenderingContext2D; arcs: Arc[] } {
  const arcs: Arc[] = [];
  const state: Record<string, unknown> = { strokeStyle: '', lineWidth: 1, dash: [] };
  const target: Record<string, unknown> = {
    measureText: (s: string) => ({ width: s.length * 6.5 }),
    setLineDash: (d: number[]) => (state.dash = d),
    arc: (x: number, y: number, r: number, a0: number, a1: number) => arcs.push({ x, y, r, a0, a1, stroke: state.strokeStyle, width: state.lineWidth, dash: state.dash }),
  };
  const ctx = new Proxy(target, { get: (t, k: string) => (k in t ? t[k] : k in state ? state[k] : () => undefined), set: (_t, k: string, v) => ((state[k] = v), true) }) as unknown as CanvasRenderingContext2D;
  return { ctx, arcs };
}

describe('reading marks, rings of the selection and isolated papers (D-525, D-526, D-532)', () => {
  const width = 1920 - 248 - 64;
  const height = 820;
  const bv = view(width / height);
  // d3 and d7 in studio, d4 and d12 read.
  bv.st[3] = 1;
  bv.st[7] = 1;
  bv.st[4] = 2;
  bv.st[12] = 2;
  const v = fitView(bv.bounds, width, height);
  v.k = Math.min(v.k, 2.2);
  const run = (extras?: BlocksExtras, plain = false) => {
    const rec = recCtx();
    const f: BlocksFrame = { ctx: plain ? fakeCtx() : rec.ctx, w: width, h: height, v, bv, th: theme, hover: -1, sel: -1, cursor: -1, lit: -1, edges: [], bundles: [], forced: new Set(), central: new Set(), allow: null, fly: null, redraw: () => undefined };
    return { out: drawBlocks(f, extras), arcs: rec.arcs };
  };
  const apart = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;

  it('draws the reading marks with zero collisions against the labels and the names, and leaves the labels where they were', async () => {
    run();
    await vi.waitFor(() => expect(peekMeta('d24')).not.toBeNull());
    const withMarks = run();
    const stripped = bv.st.slice();
    bv.st.fill(0);
    const without = run();
    bv.st.set(stripped);
    expect(withMarks.out.marks).toHaveLength(2);
    expect(withMarks.out.labels).toEqual(without.out.labels);
    expect(withMarks.out.labels).toHaveLength(25);
    for (const m of withMarks.out.marks) for (const b of [...withMarks.out.labels, ...withMarks.out.names]) expect(apart(m, b), `${m.x},${m.y} over ${b.x},${b.y}`).toBe(true);
    // The tick is inside the cell of its paper.
    const box = tickBox(100, 100);
    expect(box.x + box.w).toBeLessThanOrEqual(100 + 7);
  });

  it('draws "in studio" as a half dot and "read" as a tick, never as a ring', () => {
    const { arcs, out } = run();
    const half = arcs.filter((a) => Math.abs(a.a0 - Math.PI / 2) < 1e-9 && Math.abs(a.a1 - (Math.PI * 3) / 2) < 1e-9);
    expect(half).toHaveLength(2);
    expect(half.every((a) => a.r === 4.5)).toBe(true);
    expect(out.marks).toHaveLength(2);
    // No accent ring (r + 3.5) and no dotted ring (r + 6) exists without a selection, a cursor or isolated papers.
    expect(arcs.some((a) => a.r === 8 || a.r === 10.5)).toBe(false);
  });

  it('rings the papers of a multiple selection like the selected one, and the isolated ones at r + 6 with dots in the warning colour', () => {
    const { arcs } = run({ multi: new Set([0, 1, 2]), isolated: new Set([5, 6]) });
    const rings = arcs.filter((a) => a.r === 8);
    expect(rings).toHaveLength(3);
    expect(rings.every((a) => a.stroke === theme.accent && a.width === 2)).toBe(true);
    const iso = arcs.filter((a) => a.r === 10.5);
    expect(iso).toHaveLength(2);
    expect(iso.every((a) => a.stroke === theme.warning && JSON.stringify(a.dash) === '[2,3]' && a.width === 1.5)).toBe(true);
  });

  it('takes the extras as the second argument or in the frame, and the view\'s own reading state when `st` is absent', () => {
    const a = run({ isolated: new Set([5]) });
    const rec = recCtx();
    drawBlocks({ ctx: rec.ctx, w: width, h: height, v, bv, th: theme, hover: -1, sel: -1, cursor: -1, lit: -1, edges: [], bundles: [], forced: new Set(), central: new Set(), allow: null, fly: null, redraw: () => undefined, extras: { isolated: new Set([5]) } });
    expect(rec.arcs.filter((x) => x.r === 10.5)).toHaveLength(1);
    expect(a.arcs.filter((x) => x.r === 10.5)).toHaveLength(1);
    const own = new Uint8Array(bv.ids.length);
    own[0] = 1;
    expect(run({ st: own }).arcs.filter((x) => Math.abs(x.a0 - Math.PI / 2) < 1e-9)).toHaveLength(1);
  });

  it('forces the labels of a multiple selection up to 60 on the screen, and keeps the rings above that', async () => {
    run({ multi: new Set([0, 1]) });
    await vi.waitFor(() => expect(peekMeta('d24')).not.toBeNull());
    const small = run({ multi: new Set([0, 1]) });
    expect(small.out.labels.some((l) => l.id === bv.ids[0])).toBe(true);
    const all = new Set(bv.ids.map((_, i) => i));
    expect(run({ multi: all }).arcs.filter((a) => a.r === 8)).toHaveLength(25);
  });

  it('draws the destination of a drag, the lit pair of blocks and the ghost without throwing', () => {
    expect(() => run({ drop: { block: 1, valid: true }, pairLit: [0, 2], ghost: { sx: 50, sy: 60, idx: 3, count: 4 } })).not.toThrow();
    expect(() => run({ drop: { block: 1, valid: false }, ghost: { sx: 50, sy: 60, idx: 3, count: 1 } })).not.toThrow();
  });
});
