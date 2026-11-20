import { describe, expect, it } from 'vitest';
import { mapAction } from '../mapKeyboard';
import { buildBlockView, dotX, dotY, NONE_BLOCK, OTHER_BLOCK, type FamilyResponse } from '../blocksDraw';
import type { View } from '../geometry';
import { actionIds, blockAt, blockIds, canDropOn, combineSelection, conventionLabel, dropOutcome, editKey, editableFamily, idsInView, pressAction, rectIds, SELECTION_CAP, summarizeMove } from './editModel';

// Four blocks side by side, 200 x 200 world units each: two values, "Other" and "No value".
const specs = [
  { id: 'va', label: 'Value A', count: 3, x: 0, y: 0, w: 200, h: 200, sub: [] },
  { id: 'vb', label: 'Value B', count: 2, x: 210, y: 0, w: 200, h: 200, sub: [] },
  { id: OTHER_BLOCK, label: 'Other', count: 1, x: 420, y: 0, w: 200, h: 200, sub: [] },
  { id: NONE_BLOCK, label: 'No value', count: 1, x: 630, y: 0, w: 200, h: 200, sub: [] },
];
const place: Array<[string, string, number, number]> = [
  ['p1', 'va', 10, 40],
  ['p2', 'va', 10, 100],
  ['p3', 'va', 10, 160],
  ['p4', 'vb', 220, 40],
  ['p5', 'vb', 220, 100],
  ['p6', OTHER_BLOCK, 430, 40],
  ['p7', NONE_BLOCK, 640, 40],
];
const items: FamilyResponse['items'] = place.map(([id, block, x, y]) => ({ id, block, cell: [x, y] }));
const bv = buildBlockView(items, specs);
const at = (id: string): number => bv.index.get(id)!;
const none = new Set<string>();

describe('where a paper can be dropped', () => {
  it('edits Topic and the roots only', () => {
    expect(editableFamily('topic')).toBe(true);
    expect(editableFamily('root:method')).toBe(true);
    for (const f of ['auto', 'none', 'group:x', 'prefix:grp:', 'level:method']) expect(editableFamily(f)).toBe(false);
  });

  it('refuses Automatic, "Other" and the groups; takes "No value"', () => {
    expect(canDropOn(bv, 0, 'topic')).toBe(true);
    expect(canDropOn(bv, 3, 'topic')).toBe(true);
    expect(canDropOn(bv, 2, 'topic')).toBe(false);
    expect(canDropOn(bv, -1, 'topic')).toBe(false);
    expect(canDropOn(bv, 0, 'auto')).toBe(false);
    expect(canDropOn(bv, 0, 'group:x')).toBe(false);
    expect(canDropOn(bv, 0, 'prefix:grp:')).toBe(false);
  });

  it('finds the block under a point, band of the name included', () => {
    expect(blockAt(bv, 5, 5)).toBe(0);
    expect(blockAt(bv, 215, 150)).toBe(1);
    expect(blockAt(bv, 205, 100)).toBe(-1);
  });
});

describe('what the release of a drag changes', () => {
  it('moves the grabbed paper alone when it is not selected', () => {
    const out = dropOutcome({ bv, family: 'topic', grabbed: at('p1'), selected: none, block: 1 });
    expect(out).toEqual({ docIds: ['p1'], to: 'vb', from: ['va'] });
  });

  it('moves the whole selection when the grabbed paper is in it, leaving out the ones already there', () => {
    const out = dropOutcome({ bv, family: 'topic', grabbed: at('p1'), selected: new Set(['p1', 'p2', 'p4']), block: 1 });
    expect(out?.docIds).toEqual(['p1', 'p2']);
    expect(out?.to).toBe('vb');
  });

  it('does nothing when dropped on its own block, on "Other", on the background or in Automatic', () => {
    expect(dropOutcome({ bv, family: 'topic', grabbed: at('p1'), selected: none, block: 0 })).toBeNull();
    expect(dropOutcome({ bv, family: 'topic', grabbed: at('p1'), selected: new Set(['p1', 'p2', 'p3']), block: 0 })).toBeNull();
    expect(dropOutcome({ bv, family: 'topic', grabbed: at('p1'), selected: none, block: 2 })).toBeNull();
    expect(dropOutcome({ bv, family: 'topic', grabbed: at('p1'), selected: none, block: -1 })).toBeNull();
    expect(dropOutcome({ bv, family: 'auto', grabbed: at('p1'), selected: none, block: 1 })).toBeNull();
  });

  it('"No value" takes the value off: `to` is null', () => {
    expect(dropOutcome({ bv, family: 'root:r', grabbed: at('p4'), selected: none, block: 3 })).toEqual({ docIds: ['p4'], to: null, from: ['vb'] });
  });

  it('caps a move at 5000 papers', () => {
    const big = new Set(Array.from({ length: 6000 }, (_, i) => `x${i}`));
    big.add('p1');
    expect(dropOutcome({ bv, family: 'topic', grabbed: at('p1'), selected: big, block: 1 })?.docIds).toEqual(['p1']);
  });
});

describe('what a press starts', () => {
  const base = { ids: bv.ids, family: 'topic', mod: false };
  it('moves the view from a paper that is not selected, from a block name and from the background (D-530)', () => {
    expect(pressAction({ ...base, hit: at('p1'), selected: new Set(['p2']) })).toBe('pan');
    expect(pressAction({ ...base, hit: -2, selected: new Set(['p1']) })).toBe('pan');
    expect(pressAction({ ...base, hit: -1, selected: new Set(['p1']) })).toBe('pan');
  });

  it('drags from a selected paper, alone or in a multiple selection', () => {
    expect(pressAction({ ...base, hit: at('p1'), selected: new Set(['p1']) })).toBe('drag');
    expect(pressAction({ ...base, hit: at('p1'), selected: new Set(['p1', 'p2']) })).toBe('drag');
  });

  it('draws a rectangle with the modifier, from a paper too', () => {
    expect(pressAction({ ...base, hit: at('p1'), selected: none, mod: true })).toBe('rect');
    expect(pressAction({ ...base, hit: -1, selected: none, mod: true })).toBe('rect');
  });

  it('says why nothing moves in Automatic, and moves the view in the groups that are no tags', () => {
    expect(pressAction({ ...base, family: 'auto', hit: at('p1'), selected: new Set(['p1']) })).toBe('auto-no');
    expect(pressAction({ ...base, family: 'group:x', hit: at('p1'), selected: new Set(['p1']) })).toBe('pan');
  });
});

describe('the rectangle and the selection', () => {
  const v: View = { cx: 100, cy: 100, k: 1 };
  const w = 800;
  const h = 400;
  // World (0, 0) is at screen (w/2 - 100, h/2 - 100) = (300, 100).
  const sx = (x: number) => x + 300;
  const sy = (y: number) => y + 100;

  it('takes the papers whose dot is inside, in the order of the blocks, from any corner', () => {
    const r = { x0: sx(dotX(bv, at('p5')) + 5), y0: sy(150), x1: sx(0), y1: sy(0) };
    expect(rectIds(bv, v, w, h, r).ids).toEqual(['p1', 'p2', 'p4', 'p5']);
    expect(rectIds(bv, v, w, h, { x0: 0, y0: 0, x1: 5, y1: 5 }).ids).toEqual([]);
  });

  it('covers a paper whose cell is under the rectangle only if its dot is', () => {
    const r = { x0: sx(dotX(bv, at('p1')) - 3), y0: sy(dotY(bv, at('p1')) - 3), x1: sx(dotX(bv, at('p1')) + 3), y1: sy(dotY(bv, at('p1')) + 3) };
    expect(rectIds(bv, v, w, h, r).ids).toEqual(['p1']);
  });

  it('cuts at the cap and says so', () => {
    const r = rectIds(bv, v, w, h, { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 }, 3);
    expect(r.ids).toHaveLength(3);
    expect(r.capped).toBe(true);
    expect(idsInView(bv, v, w, h).capped).toBe(false);
  });

  it('selects the papers of a block, the first ones beyond the cap', () => {
    expect(blockIds(bv, 0)).toEqual({ ids: ['p1', 'p2', 'p3'], capped: false });
    expect(blockIds(bv, 0, 2)).toEqual({ ids: ['p1', 'p2'], capped: true });
  });

  it('combines: replace, add (Ctrl+Shift), toggle (Ctrl+click, Space)', () => {
    const cur = new Set(['p1', 'p2']);
    expect([...combineSelection(cur, ['p4'], 'replace').set]).toEqual(['p4']);
    expect([...combineSelection(cur, ['p2', 'p4'], 'add').set]).toEqual(['p1', 'p2', 'p4']);
    expect([...combineSelection(cur, ['p2', 'p4'], 'toggle').set]).toEqual(['p1', 'p4']);
    const many = combineSelection(new Set(), Array.from({ length: SELECTION_CAP + 5 }, (_, i) => `x${i}`), 'replace');
    expect(many.set.size).toBe(SELECTION_CAP);
    expect(many.capped).toBe(true);
  });

  it('acts on the multiple selection, else on the selected paper, else on the one under the cursor', () => {
    expect(actionIds(new Set(['a', 'b']), 'c', 'd')).toEqual(['a', 'b']);
    expect(actionIds(none, 'c', 'd')).toEqual(['d']);
    expect(actionIds(none, 'c', null)).toEqual(['c']);
    expect(actionIds(none, null, null)).toEqual([]);
  });
});

describe('what a move says', () => {
  it('says what stays in a family of several values and offers to take it off', () => {
    expect(summarizeMove({ many: true, removeFrom: false, n: 1, already: 0, to: 'B', fromLabels: ['A'] })).toMatchObject({ key: 'movedKept', from: 'A', offerRemove: true });
    expect(summarizeMove({ many: true, removeFrom: false, n: 3, already: 0, to: 'B', fromLabels: ['A', 'A', 'A'] })).toMatchObject({ key: 'movedKeptMany', offerRemove: true });
    expect(summarizeMove({ many: true, removeFrom: false, n: 2, already: 0, to: 'B', fromLabels: ['A', 'C'] })).toMatchObject({ key: 'movedKeptMany', offerRemove: true });
  });

  it('says "now the main value" when the paper already had it, and nothing to take off after a remove or in one value', () => {
    expect(summarizeMove({ many: true, removeFrom: false, n: 1, already: 1, to: 'B', fromLabels: ['A'] })).toMatchObject({ key: 'nowMain', offerRemove: false });
    expect(summarizeMove({ many: true, removeFrom: true, n: 1, already: 0, to: 'B', fromLabels: ['A'] })).toMatchObject({ key: 'moved', offerRemove: false });
    expect(summarizeMove({ many: false, removeFrom: false, n: 4, already: 0, to: 'B', fromLabels: [] })).toMatchObject({ key: 'movedMany', offerRemove: false });
  });

  it('writes the name of a block by the convention of the tags', () => {
    expect(conventionLabel('  many_body   physics ')).toBe('Many body physics');
    expect(conventionLabel('pqr methods')).toBe('PQR methods');
    expect(conventionLabel('x'.repeat(80)).length).toBe(60);
  });
});

describe('keys of the blocks', () => {
  const s = { dragging: false, multi: false, cursor: true };
  it('maps M, F2, the Menu key, Space, Shift+arrows and Ctrl+A', () => {
    expect(editKey({ key: 'm' }, s, false)).toEqual({ type: 'move-menu' });
    expect(editKey({ key: 'M', shiftKey: true }, s, false)).toEqual({ type: 'move-menu' });
    expect(editKey({ key: 'F2' }, s, false)).toEqual({ type: 'rename' });
    expect(editKey({ key: 'ContextMenu' }, s, false)).toEqual({ type: 'block-menu' });
    expect(editKey({ key: 'F10', shiftKey: true }, s, false)).toEqual({ type: 'block-menu' });
    expect(editKey({ key: ' ' }, s, false)).toEqual({ type: 'toggle' });
    expect(editKey({ key: ' ' }, { ...s, cursor: false }, false)).toBeNull();
    expect(editKey({ key: 'ArrowRight', shiftKey: true }, s, false)).toEqual({ type: 'extend', dir: 'right' });
    expect(editKey({ key: 'ArrowRight' }, s, false)).toBeNull();
    expect(editKey({ key: 'a', ctrlKey: true }, s, true)).toEqual({ type: 'select-all' });
    expect(editKey({ key: 'm', ctrlKey: true }, s, true)).toBeNull();
    expect(editKey({ key: 'm', altKey: true }, s, false)).toBeNull();
  });

  it('Esc ends a drag first, then empties the selection, then is left to the canvas', () => {
    expect(editKey({ key: 'Escape' }, { dragging: true, multi: true, cursor: true }, false)).toEqual({ type: 'cancel-drag' });
    expect(editKey({ key: 'Escape' }, { dragging: false, multi: true, cursor: true }, false)).toEqual({ type: 'clear-multi' });
    expect(editKey({ key: 'Escape' }, { dragging: false, multi: false, cursor: true }, false)).toBeNull();
  });

  it('leaves M as `mode` in the keyboard shared with the networks (m4.test.ts)', () => {
    expect(mapAction({ key: 'M' })?.type).toBe('mode');
  });
});
