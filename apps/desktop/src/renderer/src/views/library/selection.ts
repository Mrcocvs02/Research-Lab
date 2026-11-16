/**
 * Multi-selection of a list (checklist item 4): click, Shift-click ranges, Ctrl-click toggles and the keyboard.
 * Pure functions over an ordered list of ids; a hole (`undefined`) is a row not loaded yet.
 */
export interface SelectionState {
  ids: ReadonlySet<string>;
  /** Id of the row that starts a Shift range (tracked by id: the list can change under it). */
  anchor: string | null;
  /** Id of the row that has the keyboard focus. */
  active: string | null;
}

export type Order = ReadonlyArray<string | undefined>;
export interface Mods {
  shift?: boolean;
  ctrl?: boolean;
}

/** Index of `id` in the order, or -1 (also when the row is not loaded or left the list). */
export const indexOfId = (order: Order, id: string | null): number => (id === null ? -1 : order.indexOf(id));

export const emptySelection = (): SelectionState => ({ ids: new Set(), anchor: null, active: null });

const range = (order: Order, a: number, b: number): string[] => {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const out: string[] = [];
  for (let i = Math.max(0, lo); i <= Math.min(order.length - 1, hi); i++) {
    const id = order[i];
    if (id !== undefined) out.push(id);
  }
  return out;
};

/** True when part of the range is not loaded, so the caller must load everything before using it. */
export function rangeHasHoles(order: Order, a: number, b: number): boolean {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  for (let i = Math.max(0, lo); i <= Math.min(order.length - 1, hi); i++) if (order[i] === undefined) return true;
  return false;
}

/** A mouse click on row `index`. */
export function clickSelect(state: SelectionState, order: Order, index: number, mods: Mods = {}): SelectionState {
  const id = order[index];
  if (id === undefined) return state;
  const anchorAt = indexOfId(order, state.anchor);
  if (mods.shift && anchorAt >= 0) {
    const span = range(order, anchorAt, index);
    return { ids: new Set(mods.ctrl ? [...state.ids, ...span] : span), anchor: state.anchor, active: id };
  }
  if (mods.ctrl) {
    const ids = new Set(state.ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    return { ids, anchor: id, active: id };
  }
  return { ids: new Set([id]), anchor: id, active: id };
}

export type Move = number | 'home' | 'end';

/** An arrow, Home or End key: moves the focus; Shift extends the range, Ctrl only moves the focus. */
export function moveSelect(state: SelectionState, order: Order, move: Move, mods: Mods = {}): SelectionState {
  if (order.length === 0) return state;
  const activeAt = indexOfId(order, state.active);
  const from = activeAt >= 0 ? activeAt : typeof move === 'number' && move < 0 ? order.length : -1;
  const target = move === 'home' ? 0 : move === 'end' ? order.length - 1 : from + move;
  const at = Math.max(0, Math.min(order.length - 1, target));
  const id = order[at] ?? null;
  if (mods.ctrl && !mods.shift) return { ...state, active: id };
  if (mods.shift) {
    const anchorAt = indexOfId(order, state.anchor);
    const from2 = anchorAt >= 0 ? anchorAt : activeAt >= 0 ? activeAt : at;
    return { ids: new Set(range(order, from2, at)), anchor: order[from2] ?? id, active: id };
  }
  return { ids: id === null ? new Set() : new Set([id]), anchor: id, active: id };
}

/** Space with Ctrl: toggles the focused row without touching the rest. */
export function toggleActive(state: SelectionState, order: Order): SelectionState {
  const at = indexOfId(order, state.active);
  if (at < 0) return state;
  return clickSelect(state, order, at, { ctrl: true });
}

/** Selects every id of `order` (the whole result, loaded or not: see `DocList.allIds`). */
export function selectAll(order: Order): SelectionState {
  const ids = order.filter((x): x is string => x !== undefined);
  return { ids: new Set(ids), anchor: ids[0] ?? null, active: ids[ids.length - 1] ?? null };
}

export const selectedCount = (s: SelectionState) => s.ids.size;
