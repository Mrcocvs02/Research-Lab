/**
 * The tool machine of the reader (ARCHITETTURA-UI 8.2.4, 8.2.7): pure, no DOM and no React. The reader feeds it pointer and
 * keyboard events and carries out the effects it returns. Crop (R) is not here: its behaviour arrives with the crop feature.
 */
export type Tool = 'select' | 'highlight' | 'underline' | 'eraser';
export type Brush = 'highlight' | 'underline';
export type ColorNo = 1 | 2 | 3 | 4 | 5;
/** The pen eraser button of a stylus makes the eraser a temporary tool (`tempFrom` is the tool to give back). */
export type Ctx = { tool: Tool; prev: Tool; color: ColorNo; tempFrom?: Tool };
export type Mode =
  | { m: 'idle'; hasSelection: boolean }
  | { m: 'selecting' }
  | { m: 'stroking'; kind: Brush; pointerId: number }
  | { m: 'erasing'; pointerId: number; erased: string[] }
  | { m: 'selected'; annId: string }
  | { m: 'commenting'; annId: string; draft: string; original: string };
export type Ev =
  | { e: 'tool'; tool: Tool }
  | { e: 'swap'; repeat: boolean }
  | { e: 'color'; n: ColorNo }
  | { e: 'down'; on: 'text' | 'annotation' | 'empty'; annId?: string; pointerId: number; pen: 'mouse' | 'touch' | 'pen'; eraserButton: boolean }
  | { e: 'move'; annIdsUnder: string[] }
  | { e: 'up'; selectionText: string; annId?: string }
  | { e: 'cancel' }
  | { e: 'comment'; current?: string }
  | { e: 'draft'; value: string }
  | { e: 'delete' }
  | { e: 'esc' }
  | { e: 'commit-comment' }
  | { e: 'blur' }
  | { e: 'doc-change' };
export type Effect =
  | 'create'
  | 'delete'
  | 'recolor'
  | 'save-comment'
  | 'clear-selection'
  | 'show-popover'
  | 'hide-popover'
  | 'announce'
  | 'close-find'
  | 'root-hint'
  | 'close-reader'
  /** An annotation was touched by the eraser: outline it (`--danger`); the deletion waits for the release. */
  | 'erase-hint'
  /** The stroke touched more than `ERASE_LIMIT` annotations: ask before deleting any of them. */
  | 'confirm-erase';
export interface Env {
  inTextField: boolean;
  overlayOpen: boolean;
  findOpen: boolean;
}
export interface Result {
  ctx: Ctx;
  mode: Mode;
  effects: Effect[];
}

/** What Escape does with nothing open and the Select tool: `hint` only says how to close (D-329, provisional default), `close` leaves the reader. */
export const ESC_AT_ROOT: 'hint' | 'close' = 'hint';
/** More than this many annotations under one eraser stroke are deleted only after a confirmation. */
export const ERASE_LIMIT = 3;
const KEYBOARD = new Set<Ev['e']>(['tool', 'swap', 'color', 'comment', 'delete', 'esc']);
const IDLE = { m: 'idle', hasSelection: false } as const;

export const initialCtx = (tool: Tool = 'select', prev: Tool = 'highlight', color: ColorNo = 1): Ctx => ({ tool, prev, color });

const switchTo = (ctx: Ctx, tool: Tool): Ctx => (tool === ctx.tool ? ctx : { ...ctx, prev: ctx.tool, tool });
const swapped = (ctx: Ctx): Ctx => (ctx.prev === ctx.tool ? ctx : { ...ctx, tool: ctx.prev, prev: ctx.tool });
/** Gives the tool back after a temporary eraser. */
function restore(ctx: Ctx): Ctx {
  if (!ctx.tempFrom) return ctx;
  const { tempFrom, ...rest } = ctx;
  return { ...rest, tool: tempFrom };
}

export function step(ctx: Ctx, mode: Mode, ev: Ev, env: Env, escAtRoot: 'hint' | 'close' = ESC_AT_ROOT): Result {
  const out = (c: Ctx, m: Mode, ...effects: Effect[]): Result => ({ ctx: c, mode: m, effects });
  const same = out(ctx, mode);

  // The window lost the focus or the document changed: strokes and popovers are dropped, tool, last tool and colour stay.
  if (ev.e === 'blur' || ev.e === 'doc-change') {
    const hide: Effect[] = mode.m === 'stroking' ? ['clear-selection'] : mode.m === 'selected' || mode.m === 'commenting' ? ['hide-popover'] : [];
    return out(restore(ctx), IDLE, ...hide);
  }

  // The comment box is a text field that belongs to this mode: Escape and Enter reach the machine from it.
  if (mode.m === 'commenting') {
    if (ev.e === 'draft') return out(ctx, { ...mode, draft: ev.value });
    if (ev.e === 'commit-comment' || ev.e === 'esc') {
      const saved: Mode = { m: 'selected', annId: mode.annId };
      return mode.draft.trim() !== mode.original.trim() ? out(ctx, saved, 'save-comment') : out(ctx, saved);
    }
    return same;
  }

  // A key that goes to a text field or a dialog is not ours.
  if (KEYBOARD.has(ev.e) && (env.inTextField || env.overlayOpen)) return same;

  // A gesture in progress keeps its tool: tool, swap and colour only count from the next gesture.
  if (mode.m === 'selecting' || mode.m === 'stroking' || mode.m === 'erasing') {
    if (ev.e === 'tool' || ev.e === 'swap' || ev.e === 'color') return same;
  }

  switch (mode.m) {
    case 'idle':
      return idle(ctx, mode, ev, env, escAtRoot);
    case 'selecting': {
      if (ev.e === 'up') {
        if (ev.selectionText.trim() !== '') return out(ctx, { m: 'idle', hasSelection: true }, 'show-popover');
        return ev.annId ? out(ctx, { m: 'selected', annId: ev.annId }, 'show-popover') : out(ctx, IDLE);
      }
      if (ev.e === 'esc') return out(ctx, IDLE, 'clear-selection');
      if (ev.e === 'cancel') return out(ctx, IDLE);
      return same;
    }
    case 'stroking': {
      if (ev.e === 'up') {
        if (ev.selectionText.trim() !== '') return out(ctx, IDLE, 'create', 'clear-selection');
        return ev.annId ? out(ctx, { m: 'selected', annId: ev.annId }, 'show-popover') : out(ctx, IDLE, 'clear-selection');
      }
      if (ev.e === 'cancel' || ev.e === 'esc') return out(ctx, IDLE, 'clear-selection');
      return same;
    }
    case 'erasing': {
      if (ev.e === 'move') {
        const fresh = ev.annIdsUnder.filter((id) => !mode.erased.includes(id));
        return fresh.length > 0 ? out(ctx, { ...mode, erased: [...mode.erased, ...fresh] }, 'erase-hint') : same;
      }
      if (ev.e === 'up' || ev.e === 'cancel' || ev.e === 'esc') {
        const n = mode.erased.length;
        const effects: Effect[] = n === 0 ? [] : n > ERASE_LIMIT ? ['confirm-erase'] : ['delete'];
        return out(restore(ctx), IDLE, ...effects);
      }
      return same;
    }
    case 'selected': {
      if (ev.e === 'color') return out(ctx, mode, 'recolor');
      if (ev.e === 'comment') return out(ctx, { m: 'commenting', annId: mode.annId, draft: ev.current ?? '', original: ev.current ?? '' });
      if (ev.e === 'delete') return out(ctx, IDLE, 'delete', 'hide-popover');
      if (ev.e === 'esc') return out(ctx, IDLE, 'hide-popover');
      if (ev.e === 'down' || ev.e === 'swap' || ev.e === 'tool') {
        const again = idle(ctx, { m: 'idle', hasSelection: false }, ev, env, escAtRoot);
        return { ...again, effects: ['hide-popover', ...again.effects] };
      }
      return same;
    }
  }
}

function idle(ctx: Ctx, mode: Extract<Mode, { m: 'idle' }>, ev: Ev, env: Env, escAtRoot: 'hint' | 'close'): Result {
  const out = (c: Ctx, m: Mode, ...effects: Effect[]): Result => ({ ctx: c, mode: m, effects });
  switch (ev.e) {
    case 'tool':
      return ev.tool === ctx.tool ? out(ctx, mode) : out(switchTo(ctx, ev.tool), mode, 'announce');
    case 'swap': {
      const next = ev.repeat ? ctx : swapped(ctx);
      return next === ctx ? out(ctx, mode) : out(next, mode, 'announce');
    }
    case 'color':
      return out({ ...ctx, color: ev.n }, mode);
    case 'down': {
      if (ev.eraserButton || ctx.tool === 'eraser') {
        const c = ev.eraserButton && ctx.tool !== 'eraser' ? { ...switchTo(ctx, 'eraser'), tempFrom: ctx.tool } : ctx;
        return out(c, { m: 'erasing', pointerId: ev.pointerId, erased: [] });
      }
      if (ev.on === 'empty') return out(ctx, { m: 'idle', hasSelection: false }, 'clear-selection');
      if (ctx.tool === 'select') return out(ctx, { m: 'selecting' });
      return out(ctx, { m: 'stroking', kind: ctx.tool, pointerId: ev.pointerId });
    }
    case 'esc':
      if (mode.hasSelection) return out(ctx, { m: 'idle', hasSelection: false }, 'clear-selection');
      if (ctx.tool !== 'select') return out(switchTo(ctx, 'select'), mode, 'announce');
      if (env.findOpen) return out(ctx, mode, 'close-find');
      return out(ctx, mode, escAtRoot === 'close' ? 'close-reader' : 'root-hint');
    default:
      return out(ctx, mode);
  }
}
