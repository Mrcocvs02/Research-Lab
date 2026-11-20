import type { MenuItem } from '../../../components/Menu';
import { dotX, dotY, type BlockView } from '../blocksDraw';
import { toScreenX, toScreenY, type View } from '../geometry';
import type { Dir, KeyLike } from '../mapKeyboard';

/**
 * The rules of editing the Map by hand (D-521..D-524, D-530, section 20.3 and 20.4), pure so they are unit-tested: where a paper may be
 * dropped, who moves with it, what a press on the canvas starts, which papers a rectangle takes, how selections combine. The canvas and
 * the panel only wire these to the pointer, the keyboard and the main process.
 */

/** Most papers selected at once, and moved in one gesture (D-534). */
export const SELECTION_CAP = 5000;

/** Topic (also the one made of the old index's suggestions) and the roots are tags: only their blocks can be edited. */
export const editableFamily = (family: string): boolean => family === 'topic' || family.startsWith('root:');
/** The communities found in the network: not tags, so no edit, and the name goes through `graph:acceptFamilyName`. */
export const autoFamily = (family: string): boolean => family === 'auto';

/** The block whose frame holds a world point (band of the name included), or -1. */
export function blockAt(bv: BlockView, wx: number, wy: number): number {
  for (let b = 0; b < bv.blocks.length; b++) {
    const k = bv.blocks[b]!;
    if (wx >= k.x && wx <= k.x + k.w && wy >= k.y && wy <= k.y + k.h) return b;
  }
  return -1;
}

/** A block that can take dropped papers: a block of an editable family that is not "Other" (it gathers several values); "No value" is one (it takes the value off). */
export const canDropOn = (bv: BlockView, block: number, family: string): boolean => editableFamily(family) && block >= 0 && block < bv.blocks.length && !bv.blocks[block]!.other;

/** What a press on the canvas starts. */
export type Press = 'rect' | 'drag' | 'pan' | 'auto-no';

/**
 * A press with the modifier held draws a rectangle, from anywhere (the cells cover the inside of the blocks); a press on a paper that is
 * already selected is the start of a move in an editable family (in Automatic the view moves and the pill says why, once); any other press
 * moves the view: a paper that is not selected, the name of a block, the background (D-530).
 */
export function pressAction(p: { hit: number; ids: readonly string[]; selected: ReadonlySet<string>; family: string; mod: boolean }): Press {
  if (p.mod) return 'rect';
  if (p.hit < 0 || !p.selected.has(p.ids[p.hit]!)) return 'pan';
  if (editableFamily(p.family)) return 'drag';
  return autoFamily(p.family) ? 'auto-no' : 'pan';
}

/**
 * What the release of a drag changes: the papers that move (the whole selection when the grabbed one is in it, else the grabbed one alone),
 * those already in the block left out; null when nothing would change or the drop is not allowed. `to` is the block's value (null: "No value").
 */
export function dropOutcome(p: { bv: BlockView; family: string; grabbed: number; selected: ReadonlySet<string>; block: number }): { docIds: string[]; to: string | null; from: string[] } | null {
  const { bv, block } = p;
  if (!canDropOn(bv, block, p.family) || p.grabbed < 0) return null;
  const grabbedId = bv.ids[p.grabbed]!;
  const wanted = p.selected.has(grabbedId) ? [...p.selected] : [grabbedId];
  const docIds: string[] = [];
  const from: string[] = [];
  for (const id of wanted) {
    const i = bv.index.get(id);
    if (i === undefined || bv.block[i] === block) continue;
    docIds.push(id);
    from.push(bv.blocks[bv.block[i]!]!.id);
  }
  if (docIds.length === 0) return null;
  const to = bv.blocks[block]!;
  return { docIds: docIds.slice(0, SELECTION_CAP), to: to.none ? null : to.id, from: from.slice(0, SELECTION_CAP) };
}

export interface ScreenBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The papers whose dot lies inside a rectangle of screen pixels, in the order of the blocks, and whether the cap cut the list. */
export function rectIds(bv: BlockView, v: View, w: number, h: number, r: ScreenBox, cap = SELECTION_CAP): { ids: string[]; capped: boolean } {
  const x0 = Math.min(r.x0, r.x1);
  const x1 = Math.max(r.x0, r.x1);
  const y0 = Math.min(r.y0, r.y1);
  const y1 = Math.max(r.y0, r.y1);
  const ids: string[] = [];
  let capped = false;
  for (const members of bv.members) {
    for (const i of members) {
      const x = toScreenX(v, dotX(bv, i), w);
      const y = toScreenY(v, dotY(bv, i), h);
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (ids.length >= cap) return { ids, capped: true };
      ids.push(bv.ids[i]!);
    }
  }
  return { ids, capped };
}

/** Ctrl+A: the papers in view (the whole canvas rectangle). */
export const idsInView = (bv: BlockView, v: View, w: number, h: number, cap = SELECTION_CAP) => rectIds(bv, v, w, h, { x0: 0, y0: 0, x1: w, y1: h }, cap);

/** "Select the papers of the block": its members, the first `cap`. */
export function blockIds(bv: BlockView, block: number, cap = SELECTION_CAP): { ids: string[]; capped: boolean } {
  const members = bv.members[block] ?? [];
  return { ids: members.slice(0, cap).map((i) => bv.ids[i]!), capped: members.length > cap };
}

export type SelectMode = 'replace' | 'add' | 'toggle';

/** The selection after a gesture: `replace` (a rectangle), `add` (Ctrl+Shift rectangle) or `toggle` (Ctrl+click, Space); at most `cap`. */
export function combineSelection(cur: ReadonlySet<string>, ids: readonly string[], mode: SelectMode, cap = SELECTION_CAP): { set: Set<string>; capped: boolean } {
  let next: Set<string>;
  if (mode === 'replace') next = new Set(ids);
  else if (mode === 'add') next = new Set([...cur, ...ids]);
  else {
    next = new Set(cur);
    for (const id of ids) {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    }
  }
  if (next.size <= cap) return { set: next, capped: false };
  return { set: new Set([...next].slice(0, cap)), capped: true };
}

/** The papers a keyboard move or a bar action takes: the multiple selection, else the one selected paper, else the one under the keyboard cursor. */
export function actionIds(multi: ReadonlySet<string>, selected: string | null, cursor: string | null): string[] {
  if (multi.size > 0) return [...multi];
  const one = cursor ?? selected;
  return one ? [one] : [];
}

/** The naming convention of the tags (D-493), as the main process applies it: `_` to a space, spaces collapsed, a capital initial, at most 60 characters. */
export function conventionLabel(label: string): string {
  const t = label
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(?<![\p{L}\p{N}])[b-df-hj-np-tv-xz]{2,5}(?![\p{L}\p{N}])/giu, (m) => m.toUpperCase());
  const out = t.charAt(0).toUpperCase() + t.slice(1);
  return out.length > 60 ? out.slice(0, 60).trim() : out;
}

/** What to say after a move (the keys of `mapEdit.*` and their values); `many` is a family of several values, where the old value stays unless removed. */
export interface MoveSummary {
  key: 'moved' | 'movedMany' | 'movedKept' | 'movedKeptMany' | 'nowMain';
  to: string;
  from?: string;
  n: number;
  /** Offer "Also remove from ...". */
  offerRemove: boolean;
}
export function summarizeMove(p: { many: boolean; removeFrom: boolean; n: number; already: number; to: string; fromLabels: readonly string[] }): MoveSummary {
  const n = p.n;
  const same = p.fromLabels.length > 0 && p.fromLabels.every((l) => l === p.fromLabels[0]);
  const base = { to: p.to, n };
  if (!p.many || p.removeFrom) return { key: n > 1 ? 'movedMany' : 'moved', ...base, offerRemove: false };
  if (p.already >= n) return { key: 'nowMain', ...base, offerRemove: false };
  return same ? { key: n > 1 ? 'movedKeptMany' : 'movedKept', ...base, from: p.fromLabels[0]!, offerRemove: true } : { key: 'movedKeptMany', ...base, offerRemove: true };
}

/** What a key does on the blocks beyond the map's own keys (D-531): they are read before `mapAction`, which still owns M as `mode` for the other canvases. */
export type EditKey = { type: 'move-menu' } | { type: 'rename' } | { type: 'block-menu' } | { type: 'toggle' } | { type: 'extend'; dir: Dir } | { type: 'select-all' } | { type: 'cancel-drag' } | { type: 'clear-multi' };

/**
 * M opens "Move to...", F2 renames the block of the paper under the cursor, the Menu key (or Shift+F10) opens its menu, Space adds or takes off the
 * paper under the cursor, Shift+arrows extend the selection to the neighbour, Ctrl+A (Command on macOS) selects the papers in view; Esc ends a drag first,
 * then empties the multiple selection, and otherwise is left to the canvas. `mod` is the platform modifier.
 */
export function editKey(e: KeyLike, s: { dragging: boolean; multi: boolean; cursor: boolean }, mod: boolean): EditKey | null {
  if (e.key === 'Escape') return s.dragging ? { type: 'cancel-drag' } : s.multi ? { type: 'clear-multi' } : null;
  if (e.altKey) return null;
  if (mod) return (e.key === 'a' || e.key === 'A') && !e.shiftKey ? { type: 'select-all' } : null;
  if (e.ctrlKey || e.metaKey) return null;
  switch (e.key) {
    case 'm':
    case 'M':
      return { type: 'move-menu' };
    case 'F2':
      return { type: 'rename' };
    case 'ContextMenu':
      return { type: 'block-menu' };
    case 'F10':
      return e.shiftKey ? { type: 'block-menu' } : null;
    case ' ':
    case 'Spacebar':
      return s.cursor && !e.shiftKey ? { type: 'toggle' } : null;
    case 'ArrowLeft':
      return e.shiftKey ? { type: 'extend', dir: 'left' } : null;
    case 'ArrowRight':
      return e.shiftKey ? { type: 'extend', dir: 'right' } : null;
    case 'ArrowUp':
      return e.shiftKey ? { type: 'extend', dir: 'up' } : null;
    case 'ArrowDown':
      return e.shiftKey ? { type: 'extend', dir: 'down' } : null;
    default:
      return null;
  }
}

/** A menu entry that is off with a reason when `reason` is given (an entry is never hidden by context, D-412). */
export const menuItem = (item: { id: string; label: string; testId?: string; keys?: string; onSelect(): void }, reason?: string): MenuItem => (reason ? { ...item, disabled: true, disabledReason: reason } : item);
