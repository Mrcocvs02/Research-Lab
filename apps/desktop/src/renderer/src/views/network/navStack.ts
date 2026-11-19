/**
 * The Back / Forward stack shared by the Map and the Neighbourhood (section 19.2.5): the last 50 states of the view, pure and tested.
 * A state is what the user would expect to find again: the tab, the grouping family, the selected paper, the centre of the
 * neighbourhood, the path between two papers and the frame of the camera.
 */
export type NavTab = 'map' | 'network' | 'explore' | 'surprising';

export interface NavState {
  tab: NavTab;
  family: string;
  /** The selected paper. */
  doc: string | null;
  /** The paper at the centre of the neighbourhood. */
  center: string | null;
  /** The two ends of the path shown. */
  path: [string, string] | null;
  /** Camera frame `[cx, cy, k]` of the Map, when the owner of the camera gives it. */
  frame?: [number, number, number] | undefined;
}

export const MAX_NAV = 50;

export interface NavStack {
  /** Oldest first; `at` is the index of the current state. */
  states: readonly NavState[];
  at: number;
}

export const emptyNav = (): NavStack => ({ states: [], at: -1 });

const sameState = (a: NavState, b: NavState): boolean =>
  a.tab === b.tab && a.family === b.family && a.doc === b.doc && a.center === b.center && a.path?.[0] === b.path?.[0] && a.path?.[1] === b.path?.[1];

/** Records a new state: the states ahead of the current one are dropped; the same state twice in a row is not recorded again; the oldest go past 50. */
export function pushNav(s: NavStack, next: NavState): NavStack {
  const cur = s.states[s.at];
  if (cur && sameState(cur, next)) return s;
  const kept = [...s.states.slice(0, s.at + 1), next];
  const cut = Math.max(0, kept.length - MAX_NAV);
  const states = cut > 0 ? kept.slice(cut) : kept;
  return { states, at: states.length - 1 };
}

export const canBack = (s: NavStack): boolean => s.at > 0;
export const canForward = (s: NavStack): boolean => s.at >= 0 && s.at < s.states.length - 1;

/** One step back or forward (the same stack when there is none). The state to show is `current` of the result. */
export const stepBack = (s: NavStack): NavStack => (canBack(s) ? { states: s.states, at: s.at - 1 } : s);
export const stepForward = (s: NavStack): NavStack => (canForward(s) ? { states: s.states, at: s.at + 1 } : s);
export const currentNav = (s: NavStack): NavState | null => s.states[s.at] ?? null;

/** The distinct centres visited up to the current state, oldest first, for the crumbs "A > B > C" (at most `max`, the last ones). */
export function crumbs(s: NavStack, max = 5): string[] {
  const out: string[] = [];
  for (const st of s.states.slice(0, s.at + 1)) {
    if (st.tab !== 'network' || st.center === null) continue;
    const i = out.indexOf(st.center);
    if (i >= 0) out.length = i;
    out.push(st.center);
  }
  return out.slice(-max);
}
