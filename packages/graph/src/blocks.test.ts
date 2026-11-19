import { describe, expect, it } from 'vitest';
import { CELL_H, CELL_W, NO_VALUE_BLOCK, OTHER_BLOCK, layoutBlocks, type BlockDoc } from './blocks.js';

const mk = (n: number, value: (i: number) => string | null, extra: (i: number) => Partial<BlockDoc> = () => ({})): BlockDoc[] =>
  Array.from({ length: n }, (_, i) => ({ id: `d${String(i).padStart(3, '0')}`, value: value(i), x: Math.sin(i) * 100, y: Math.cos(i * 3) * 100, ...extra(i) }));
const labels = (vals: string[]) => new Map(vals.map((v) => [v, v.toUpperCase()]));

type Rect = { x: number; y: number; w: number; h: number };
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('layoutBlocks', () => {
  it('makes one block per value ordered by size, with "No value" last', () => {
    const docs = mk(30, (i) => (i < 12 ? 'a' : i < 20 ? 'b' : i < 26 ? 'c' : i < 28 ? null : 'd'));
    const out = layoutBlocks({ docs, labels: labels(['a', 'b', 'c', 'd']), aspect: 1.6 });
    expect(out.blocks.map((b) => [b.id, b.count])).toEqual([['a', 12], ['b', 8], ['c', 6], ['d', 2], [NO_VALUE_BLOCK, 2]]);
    expect(out.blocks[0]!.label).toBe('A');
    expect(out.blocks.at(-1)!.label).toBe('No value');
  });

  it('puts every paper in its own cell inside its block, and blocks never overlap', () => {
    const docs = mk(200, (i) => `v${i % 9}`);
    const out = layoutBlocks({ docs, labels: new Map(), aspect: 1.5 });
    expect(out.cells.size).toBe(200);
    expect(new Set([...out.cells.values()].map(([x, y]) => `${x},${y}`)).size).toBe(200);
    for (const [i, a] of out.blocks.entries()) for (const b of out.blocks.slice(i + 1)) expect(overlap(a, b)).toBe(false);
    for (const d of docs) {
      const [x, y] = out.cells.get(d.id)!;
      const b = out.blocks.find((k) => k.id === out.blockOf.get(d.id)!.block)!;
      expect(x).toBeGreaterThanOrEqual(b.x);
      expect(y).toBeGreaterThanOrEqual(b.y);
      expect(x + CELL_W).toBeLessThanOrEqual(b.x + b.w);
      expect(y + CELL_H).toBeLessThanOrEqual(b.y + b.h);
    }
  });

  it('is nearly square: columns = round(sqrt(0.36 n))', () => {
    const out = layoutBlocks({ docs: mk(25, () => 'a'), labels: new Map(), aspect: 1 });
    expect(out.blocks[0]!.w).toBe(3 * CELL_W);
  });

  it('is deterministic whatever the order of the input', () => {
    const docs = mk(60, (i) => `v${i % 4}`);
    const a = layoutBlocks({ docs, labels: new Map(), aspect: 1.6 });
    const b = layoutBlocks({ docs: [...docs].reverse(), labels: new Map(), aspect: 1.6 });
    expect(b.blocks).toEqual(a.blocks);
    expect([...b.cells].sort()).toEqual([...a.cells].sort());
  });

  it('follows the aspect of the canvas', () => {
    const docs = mk(120, (i) => `v${i % 8}`);
    const wide = layoutBlocks({ docs, labels: new Map(), aspect: 4 }).blocks;
    const tall = layoutBlocks({ docs, labels: new Map(), aspect: 0.4 }).blocks;
    const ext = (bs: typeof wide) => Math.max(...bs.map((b) => b.x + b.w)) / Math.max(...bs.map((b) => b.y + b.h));
    expect(ext(wide)).toBeGreaterThan(ext(tall));
  });

  it('keeps the 12 biggest values and gathers the rest in Other', () => {
    const docs = mk(40, (i) => `v${String(i % 15).padStart(2, '0')}`, (i) => (i === 0 ? { others: ['v14', 'v13', 'v12'] } : {}));
    const out = layoutBlocks({ docs, labels: new Map(), aspect: 1.6 });
    expect(out.blocks.length).toBe(13);
    expect(out.blocks.at(-1)!.id).toBe(OTHER_BLOCK);
    expect(out.blockOf.get('d000')!.others.length).toBeLessThanOrEqual(2);
  });

  it('starts a row with a small name for each sub-area when there are enough papers', () => {
    const docs = mk(12, () => 'a', (i) => ({ sub: i < 6 ? 's1' : 's2' }));
    const out = layoutBlocks({ docs, labels: labels(['s1', 's2']), aspect: 1.6 });
    const b = out.blocks[0]!;
    expect(b.sub.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(b.sub[1]!.y).toBeGreaterThan(b.sub[0]!.y);
    const ys = docs.slice(0, 6).map((d) => out.cells.get(d.id)![1]);
    expect(Math.max(...ys) + CELL_H).toBeLessThanOrEqual(b.sub[1]!.y);
    const small = layoutBlocks({ docs: mk(5, () => 'a', (i) => ({ sub: i < 3 ? 's1' : 's2' })), labels: new Map(), aspect: 1 });
    expect(small.blocks[0]!.sub).toEqual([]);
  });

  it('orders the papers of a block along the main axis of the map and fills in a serpentine', () => {
    const line = Array.from({ length: 25 }, (_, i) => ({ id: `q${String(i).padStart(2, '0')}`, value: 'a', x: i, y: 0 }));
    const out = layoutBlocks({ docs: [...line].reverse(), labels: new Map(), aspect: 1 });
    // 3 columns: row 0 left to right, row 1 right to left
    expect(out.cells.get('q00')![0]).toBeLessThan(out.cells.get('q02')![0]);
    expect(out.cells.get('q03')![0]).toBeGreaterThan(out.cells.get('q05')![0]);
    expect(out.cells.get('q00')![1]).toBeLessThan(out.cells.get('q03')![1]);
  });

  it('copes with no papers', () => {
    expect(layoutBlocks({ docs: [], labels: new Map(), aspect: 1 }).blocks).toEqual([]);
  });
});
