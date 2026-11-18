import { describe, expect, it } from 'vitest';
import { ERASE_LIMIT, initialCtx, step, type Ctx, type Env, type Ev, type Mode } from './toolMachine';

const env: Env = { inTextField: false, overlayOpen: false, findOpen: false };
const idle: Mode = { m: 'idle', hasSelection: false };
const down = (on: 'text' | 'annotation' | 'empty', extra: Partial<Extract<Ev, { e: 'down' }>> = {}): Ev => ({ e: 'down', on, pointerId: 1, pen: 'mouse', eraserButton: false, ...extra });
const run = (ctx: Ctx, mode: Mode, ev: Ev, e: Partial<Env> = {}, root?: 'hint' | 'close') => step(ctx, mode, ev, { ...env, ...e }, root);
const ctxOf = (tool: Ctx['tool'], prev: Ctx['tool'] = 'highlight', color: Ctx['color'] = 1): Ctx => ({ tool, prev, color });

/** One test per row of the table of 8.2.4 (and the row of 8.2.7), in the order of the table. */
describe('tool machine: the rows of 8.2.4', () => {
  it('row 1: a key that goes to a text field or an open dialog changes nothing', () => {
    for (const ev of [{ e: 'tool', tool: 'eraser' }, { e: 'swap', repeat: false }, { e: 'color', n: 3 }, { e: 'esc' }] as Ev[]) {
      for (const e of [{ inTextField: true }, { overlayOpen: true }]) {
        const r = run(ctxOf('select'), idle, ev, e);
        expect(r).toEqual({ ctx: ctxOf('select'), mode: idle, effects: [] });
      }
    }
  });
  it('row 2: idle + tool X (X != tool) -> prev = tool, tool = X, announce', () => {
    const r = run(ctxOf('select', 'highlight'), idle, { e: 'tool', tool: 'underline' });
    expect(r.ctx).toMatchObject({ tool: 'underline', prev: 'select' });
    expect(r.effects).toEqual(['announce']);
    expect(run(ctxOf('select'), idle, { e: 'tool', tool: 'select' }).effects).toEqual([]);
  });
  it('row 3: idle + swap swaps tool and prev, announce; a repeat does nothing', () => {
    const r = run(ctxOf('select', 'highlight'), idle, { e: 'swap', repeat: false });
    expect(r.ctx).toMatchObject({ tool: 'highlight', prev: 'select' });
    expect(r.effects).toEqual(['announce']);
    expect(run(ctxOf('select'), idle, { e: 'swap', repeat: true }).ctx).toEqual(ctxOf('select'));
  });
  it('row 4: idle + colour n sets the current colour', () => {
    expect(run(ctxOf('highlight'), idle, { e: 'color', n: 4 }).ctx.color).toBe(4);
  });
  it('row 5: idle + down on text with Select -> selecting', () => {
    expect(run(ctxOf('select'), idle, down('text')).mode).toEqual({ m: 'selecting' });
  });
  it('row 6: idle + down on text or an annotation with a brush -> stroking', () => {
    expect(run(ctxOf('highlight'), idle, down('text')).mode).toEqual({ m: 'stroking', kind: 'highlight', pointerId: 1 });
    expect(run(ctxOf('underline'), idle, down('annotation', { annId: 'a' })).mode).toEqual({ m: 'stroking', kind: 'underline', pointerId: 1 });
  });
  it('row 7: idle + down with the eraser, or the pen eraser button -> erasing (the button makes the eraser temporary)', () => {
    expect(run(ctxOf('eraser', 'select'), idle, down('text')).mode).toEqual({ m: 'erasing', pointerId: 1, erased: [] });
    const r = run(ctxOf('highlight', 'select'), idle, down('text', { pen: 'pen', eraserButton: true }));
    expect(r.ctx).toMatchObject({ tool: 'eraser', tempFrom: 'highlight' });
    expect(r.mode.m).toBe('erasing');
  });
  it('row 8: idle + down on empty space with Select or a brush -> clear-selection', () => {
    for (const tool of ['select', 'highlight', 'underline'] as const) {
      const r = run(ctxOf(tool), idle, down('empty'));
      expect(r.mode).toEqual(idle);
      expect(r.effects).toEqual(['clear-selection']);
    }
  });
  it('row 9: selecting + up with text -> idle with a selection, show-popover', () => {
    const r = run(ctxOf('select'), { m: 'selecting' }, { e: 'up', selectionText: 'words' });
    expect(r.mode).toEqual({ m: 'idle', hasSelection: true });
    expect(r.effects).toEqual(['show-popover']);
  });
  it('row 10: selecting + up without text on an annotation -> selected, show-popover', () => {
    const r = run(ctxOf('select'), { m: 'selecting' }, { e: 'up', selectionText: '', annId: 'a1' });
    expect(r.mode).toEqual({ m: 'selected', annId: 'a1' });
    expect(r.effects).toEqual(['show-popover']);
  });
  it('row 11: selecting + up without text elsewhere -> idle', () => {
    expect(run(ctxOf('select'), { m: 'selecting' }, { e: 'up', selectionText: '' })).toMatchObject({ mode: idle, effects: [] });
  });
  it('row 12: stroking + up with text -> create and clear-selection; the tool does not change', () => {
    const c = ctxOf('highlight', 'select', 2);
    const r = run(c, { m: 'stroking', kind: 'highlight', pointerId: 1 }, { e: 'up', selectionText: 'x' });
    expect(r.effects).toEqual(['create', 'clear-selection']);
    expect(r.ctx).toEqual(c);
    expect(r.mode).toEqual(idle);
  });
  it('row 13: stroking + up without text on an annotation -> selected, show-popover', () => {
    const r = run(ctxOf('underline'), { m: 'stroking', kind: 'underline', pointerId: 1 }, { e: 'up', selectionText: '', annId: 'a2' });
    expect(r.mode).toEqual({ m: 'selected', annId: 'a2' });
    expect(r.effects).toEqual(['show-popover']);
  });
  it('row 14: stroking + up without text elsewhere, or cancel -> idle with clear-selection', () => {
    const m: Mode = { m: 'stroking', kind: 'highlight', pointerId: 1 };
    expect(run(ctxOf('highlight'), m, { e: 'up', selectionText: '' })).toMatchObject({ mode: idle, effects: ['clear-selection'] });
    expect(run(ctxOf('highlight'), m, { e: 'cancel' })).toMatchObject({ mode: idle, effects: ['clear-selection'] });
  });
  it('row 15: stroking or selecting + esc -> idle with clear-selection', () => {
    expect(run(ctxOf('highlight'), { m: 'stroking', kind: 'highlight', pointerId: 1 }, { e: 'esc' })).toMatchObject({ mode: idle, effects: ['clear-selection'] });
    expect(run(ctxOf('select'), { m: 'selecting' }, { e: 'esc' })).toMatchObject({ mode: idle, effects: ['clear-selection'] });
  });
  it('row 16: during a gesture swap, tool and colour change nothing', () => {
    for (const mode of [{ m: 'stroking', kind: 'highlight', pointerId: 1 }, { m: 'selecting' }, { m: 'erasing', pointerId: 1, erased: [] }] as Mode[]) {
      for (const ev of [{ e: 'swap', repeat: false }, { e: 'tool', tool: 'select' }, { e: 'color', n: 5 }] as Ev[]) {
        expect(run(ctxOf('highlight'), mode, ev)).toEqual({ ctx: ctxOf('highlight'), mode, effects: [] });
      }
    }
  });
  it('row 17: erasing + move with annotations under -> each one is collected once (the outline shows, the deletion waits)', () => {
    const m: Mode = { m: 'erasing', pointerId: 1, erased: ['a'] };
    const r = run(ctxOf('eraser'), m, { e: 'move', annIdsUnder: ['a', 'b'] });
    expect(r.mode).toEqual({ m: 'erasing', pointerId: 1, erased: ['a', 'b'] });
    expect(r.effects).toEqual(['erase-hint']);
    expect(run(ctxOf('eraser'), r.mode, { e: 'move', annIdsUnder: ['b'] }).effects).toEqual([]);
  });
  it('row 18: erasing + up, cancel or esc -> idle; up to 3 are deleted, the tool of a pen eraser is given back', () => {
    const m: Mode = { m: 'erasing', pointerId: 1, erased: ['a', 'b', 'c'].slice(0, ERASE_LIMIT) };
    for (const ev of [{ e: 'up', selectionText: '' }, { e: 'cancel' }, { e: 'esc' }] as Ev[]) expect(run(ctxOf('eraser'), m, ev)).toMatchObject({ mode: idle, effects: ['delete'] });
    expect(run(ctxOf('eraser'), { m: 'erasing', pointerId: 1, erased: [] }, { e: 'up', selectionText: '' }).effects).toEqual([]);
    const temp: Ctx = { tool: 'eraser', prev: 'highlight', color: 1, tempFrom: 'underline' };
    expect(run(temp, m, { e: 'up', selectionText: '' }).ctx).toEqual({ tool: 'underline', prev: 'highlight', color: 1 });
  });
  it('row 19 (8.2.7): erasing + up with more than 3 -> idle with confirm-erase, nothing deleted', () => {
    const m: Mode = { m: 'erasing', pointerId: 1, erased: ['a', 'b', 'c', 'd', 'e'] };
    expect(run(ctxOf('eraser'), m, { e: 'up', selectionText: '' })).toMatchObject({ mode: idle, effects: ['confirm-erase'] });
  });
  it('row 20: selected + colour n -> recolor, the current colour stays', () => {
    const r = run(ctxOf('select', 'highlight', 2), { m: 'selected', annId: 'a' }, { e: 'color', n: 5 });
    expect(r.effects).toEqual(['recolor']);
    expect(r.ctx.color).toBe(2);
    expect(r.mode).toEqual({ m: 'selected', annId: 'a' });
  });
  it('row 21: selected + comment -> commenting, with the current comment as the draft', () => {
    expect(run(ctxOf('select'), { m: 'selected', annId: 'a' }, { e: 'comment', current: 'old' }).mode).toEqual({ m: 'commenting', annId: 'a', draft: 'old', original: 'old' });
  });
  it('row 22: selected + delete -> idle, delete and hide-popover', () => {
    expect(run(ctxOf('select'), { m: 'selected', annId: 'a' }, { e: 'delete' })).toMatchObject({ mode: idle, effects: ['delete', 'hide-popover'] });
  });
  it('row 23: selected + esc, or a down outside the popover -> idle with hide-popover (the down is handled again from idle)', () => {
    expect(run(ctxOf('select'), { m: 'selected', annId: 'a' }, { e: 'esc' })).toMatchObject({ mode: idle, effects: ['hide-popover'] });
    const r = run(ctxOf('highlight'), { m: 'selected', annId: 'a' }, down('text'));
    expect(r.mode.m).toBe('stroking');
    expect(r.effects).toEqual(['hide-popover']);
  });
  it('row 24: selected + swap or tool -> idle with hide-popover, then as from idle', () => {
    const r = run(ctxOf('select', 'highlight'), { m: 'selected', annId: 'a' }, { e: 'swap', repeat: false });
    expect(r.ctx.tool).toBe('highlight');
    expect(r.effects).toEqual(['hide-popover', 'announce']);
    expect(run(ctxOf('select'), { m: 'selected', annId: 'a' }, { e: 'tool', tool: 'eraser' }).effects).toEqual(['hide-popover', 'announce']);
  });
  it('row 25: commenting + commit-comment or esc -> selected, save-comment only if the text changed', () => {
    const m: Mode = { m: 'commenting', annId: 'a', draft: 'new', original: 'old' };
    for (const ev of [{ e: 'commit-comment' }, { e: 'esc' }] as Ev[]) expect(run(ctxOf('select'), m, ev, { inTextField: true })).toMatchObject({ mode: { m: 'selected', annId: 'a' }, effects: ['save-comment'] });
    expect(run(ctxOf('select'), { ...m, draft: 'old' }, { e: 'esc' }).effects).toEqual([]);
    const typed = run(ctxOf('select'), { ...m, draft: 'old' }, { e: 'draft', value: 'x' });
    expect(typed.mode).toMatchObject({ draft: 'x' });
  });
  it('row 26: idle with a selection + esc -> clear-selection', () => {
    expect(run(ctxOf('select'), { m: 'idle', hasSelection: true }, { e: 'esc' })).toMatchObject({ mode: idle, effects: ['clear-selection'] });
  });
  it('row 27: idle, tool != select + esc -> prev = tool, tool = select, announce', () => {
    const r = run(ctxOf('underline', 'highlight'), idle, { e: 'esc' });
    expect(r.ctx).toMatchObject({ tool: 'select', prev: 'underline' });
    expect(r.effects).toEqual(['announce']);
  });
  it('row 28: idle, Select, find open + esc -> close-find', () => {
    expect(run(ctxOf('select'), idle, { e: 'esc' }, { findOpen: true }).effects).toEqual(['close-find']);
  });
  it('row 29: idle, Select, nothing open + esc -> root-hint by default (D-329), close-reader when ESC_AT_ROOT is "close"', () => {
    expect(run(ctxOf('select'), idle, { e: 'esc' }).effects).toEqual(['root-hint']);
    expect(run(ctxOf('select'), idle, { e: 'esc' }, {}, 'close').effects).toEqual(['close-reader']);
  });
  it('row 30: blur or doc-change -> idle, strokes and popovers dropped, tool, prev and colour stay', () => {
    const c = ctxOf('underline', 'select', 4);
    expect(run(c, { m: 'stroking', kind: 'underline', pointerId: 1 }, { e: 'blur' })).toMatchObject({ ctx: c, mode: idle, effects: ['clear-selection'] });
    expect(run(c, { m: 'selected', annId: 'a' }, { e: 'doc-change' })).toMatchObject({ ctx: c, mode: idle, effects: ['hide-popover'] });
    expect(run(c, { m: 'erasing', pointerId: 1, erased: ['x'] }, { e: 'blur' })).toMatchObject({ ctx: c, mode: idle, effects: [] });
  });
});

describe('tool machine: properties', () => {
  it('Space twice gives back the initial state', () => {
    for (const tool of ['select', 'highlight', 'underline', 'eraser'] as const) {
      const c = initialCtx(tool, tool === 'select' ? 'highlight' : 'select');
      const once = run(c, idle, { e: 'swap', repeat: false });
      expect(run(once.ctx, idle, { e: 'swap', repeat: false }).ctx).toEqual(c);
    }
  });
  it('prev changes only when the tool really changes', () => {
    const c = ctxOf('highlight', 'select');
    expect(run(c, idle, { e: 'tool', tool: 'highlight' }).ctx).toEqual(c);
    expect(run(run(c, idle, { e: 'tool', tool: 'underline' }).ctx, idle, { e: 'tool', tool: 'underline' }).ctx.prev).toBe('highlight');
  });
  it('no create effect without text, and no event changes the tool during a stroke', () => {
    const m: Mode = { m: 'stroking', kind: 'highlight', pointerId: 1 };
    const events: Ev[] = [{ e: 'up', selectionText: '' }, { e: 'up', selectionText: '  ', annId: 'a' }, { e: 'cancel' }, { e: 'esc' }, { e: 'move', annIdsUnder: ['a'] }, { e: 'tool', tool: 'eraser' }, { e: 'swap', repeat: false }, { e: 'color', n: 2 }];
    for (const ev of events) {
      const r = run(ctxOf('highlight', 'select'), m, ev);
      expect(r.effects).not.toContain('create');
      if (ev.e !== 'up' && ev.e !== 'cancel' && ev.e !== 'esc') expect(r.ctx).toEqual(ctxOf('highlight', 'select'));
      expect(r.ctx.tool).toBe('highlight');
    }
  });
  it('starts on Select with the last brush remembered', () => {
    expect(initialCtx()).toEqual({ tool: 'select', prev: 'highlight', color: 1 });
  });
});

/** The rows of Crop (§17.4.8), one test per row, added to the table of 8.2.4. */
describe('tool machine: the rows of Crop', () => {
  const cropping: Mode = { m: 'cropping', pointerId: 1 };
  it('crop row 1: idle + tool crop -> crop becomes the tool, the previous one is kept, announce', () => {
    const r = run(ctxOf('select', 'highlight'), idle, { e: 'tool', tool: 'crop' });
    expect(r.ctx).toMatchObject({ tool: 'crop', prev: 'select' });
    expect(r.effects).toEqual(['announce']);
  });
  it('crop row 2: idle + down on a page (text or empty page area) with Crop -> cropping, nothing else', () => {
    const r = run(ctxOf('crop', 'select'), idle, down('text'));
    expect(r.mode).toEqual(cropping);
    expect(r.effects).toEqual([]);
  });
  it('crop row 3: idle + down on an existing annotation with Crop -> selecting (a click opens its popover)', () => {
    expect(run(ctxOf('crop', 'select'), idle, down('annotation', { annId: 'a' })).mode).toEqual({ m: 'selecting' });
  });
  it('crop row 4: idle + down outside the pages with Crop -> clear-selection', () => {
    const r = run(ctxOf('crop', 'select'), idle, down('empty'));
    expect(r.mode).toEqual(idle);
    expect(r.effects).toEqual(['clear-selection']);
  });
  it('crop row 5: cropping + up -> idle, crop-commit (the tool stays Crop)', () => {
    const r = run(ctxOf('crop', 'select'), cropping, { e: 'up', selectionText: '' });
    expect(r.mode).toEqual(idle);
    expect(r.ctx.tool).toBe('crop');
    expect(r.effects).toEqual(['crop-commit']);
  });
  it('crop row 6: cropping + Escape or cancel -> idle, crop-cancel', () => {
    for (const ev of [{ e: 'esc' }, { e: 'cancel' }] as Ev[]) {
      const r = run(ctxOf('crop', 'select'), cropping, ev);
      expect(r.mode).toEqual(idle);
      expect(r.effects).toEqual(['crop-cancel']);
    }
  });
  it('crop row 7: a tool, swap or colour key during the drag changes nothing', () => {
    for (const ev of [{ e: 'tool', tool: 'eraser' }, { e: 'swap', repeat: false }, { e: 'color', n: 2 }] as Ev[]) {
      expect(run(ctxOf('crop', 'select'), cropping, ev)).toEqual({ ctx: ctxOf('crop', 'select'), mode: cropping, effects: [] });
    }
  });
  it('crop row 8: blur or a document change during the drag -> idle, crop-cancel, the tool stays', () => {
    for (const ev of [{ e: 'blur' }, { e: 'doc-change' }] as Ev[]) {
      const r = run(ctxOf('crop', 'select'), cropping, ev);
      expect(r.mode).toEqual(idle);
      expect(r.ctx.tool).toBe('crop');
      expect(r.effects).toEqual(['crop-cancel']);
    }
  });
  it('crop row 9: idle + Escape with Crop -> back to Select, announce', () => {
    const r = run(ctxOf('crop', 'select'), idle, { e: 'esc' });
    expect(r.ctx.tool).toBe('select');
    expect(r.effects).toEqual(['announce']);
  });
});
