/** Pure rules of the side-by-side reader (feature 3, §17.4.11): when it narrows to tabs, where the divider can go, how scrolling links. */

/** Below this window width the second paper is an alternating tab (Ctrl+Tab) instead of a second column. */
export const SPLIT_MIN_WIDTH = 1280;
export type Side = 0 | 1;

export const isNarrow = (width: number): boolean => width < SPLIT_MIN_WIDTH;

/** The divider keeps at least a quarter of the width on each side. */
export const clampRatio = (ratio: number): number => (Number.isFinite(ratio) ? Math.min(0.75, Math.max(0.25, ratio)) : 0.5);

/** The side that has the focus after Ctrl+Alt+Left / Right (`order` lists the sides as laid out, left first). */
export const moveFocus = (order: readonly [Side, Side], dir: 'left' | 'right'): Side => (dir === 'left' ? order[0] : order[1]);

export interface ScrollBox {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Where the other pane scrolls to so that it sits at the same fraction of its length as the pane that moved. */
export function linkedTop(from: ScrollBox, to: Omit<ScrollBox, 'scrollTop'>): number {
  const room = from.scrollHeight - from.clientHeight;
  if (room <= 0) return 0;
  return Math.round((from.scrollTop / room) * Math.max(0, to.scrollHeight - to.clientHeight));
}

/** The title of the bar for two papers: "A ⇄ B" (each cut to a sensible length). */
export function pairTitle(a: string, b: string): string {
  const cut = (s: string) => (s.length > 48 ? `${s.slice(0, 47)}…` : s);
  return `${cut(a)} ⇄ ${cut(b)}`;
}
