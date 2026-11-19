import { describe, expect, it, vi } from 'vitest';
import { layoutBlocks } from '../../../../../../../packages/graph/src/blocks';
import type { MapTheme } from './colors';
import { fitView } from './geometry';
import { buildBlockView, drawBlocks, hitBlocks, peekMeta, CELL_H, CELL_W, HEAD, type BlocksFrame, type FamilyResponse } from './blocksDraw';

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
const theme: MapTheme = { dark: false, text: '#000', muted: '#555', accent: '#06c', bg: '#fff', surface: '#fff', border: '#ccc', tints: [], areas: Array.from({ length: 9 }, () => '#888') };

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
