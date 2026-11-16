/**
 * Multi-selection of a list (checklist item 4): click, Shift-click ranges, Ctrl-click toggles and the keyboard.
 * Pure functions over an ordered list of ids; a hole (`undefined`) is a row not loaded yet.
 */
export interface SelectionState {
  ids: ReadonlySet<string>;
  /** Start of a Shift range. */
  anchor: number | null;
  /** The row that has the keyboard focus. */
  active: number | null;
}

export type Order = ReadonlyArray<string | undefined>;
export interface Mods {
  shift?: boolean;
  ctrl?: boolean;
}

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
  if (mods.shift && state.anchor !== null) {
    const span = range(order, state.anchor, index);
    return { ids: new Set(mods.ctrl ? [...state.ids, ...span] : span), anchor: state.anchor, active: index };
  }
  if (mods.ctrl) {
    const ids = new Set(state.ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    return { ids, anchor: index, active: index };
  }
  return { ids: new Set([id]), anchor: index, active: index };
}

export type Move = number | 'home' | 'end';

/** An arrow, Home or End key: moves the focus; Shift extends the range, Ctrl only moves the focus. */
export function moveSelect(state: SelectionState, order: Order, move: Move, mods: Mods = {}): SelectionState {
  if (order.length === 0) return state;
  const from = state.active ?? (typeof move === 'number' && move < 0 ? order.length : -1);
  const target = move === 'home' ? 0 : move === 'end' ? order.length - 1 : from + move;
  const active = Math.max(0, Math.min(order.length - 1, target));
  if (mods.ctrl && !mods.shift) return { ...state, active };
  if (mods.shift) {
    const anchor = state.anchor ?? (state.active ?? active);
    return { ids: new Set(range(order, anchor, active)), anchor, active };
  }
  const id = order[active];
  return { ids: id === undefined ? new Set() : new Set([id]), anchor: active, active };
}

/** Space with Ctrl: toggles the focused row without touching the rest. */
export function toggleActive(state: SelectionState, order: Order): SelectionState {
  if (state.active === null) return state;
  return clickSelect(state, order, state.active, { ctrl: true });
}

export function selectAll(order: Order): SelectionState {
  const ids = order.filter((x): x is string => x !== undefined);
  return { ids: new Set(ids), anchor: 0, active: Math.max(0, order.length - 1) };
}

export const selectedCount = (s: SelectionState) => s.ids.size;
