import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * The window's own navigation history (design 3): the current place and two stacks (back, forward, at most 50 places
 * each). No router and no URL: a place is a plain object. The reader is a sub-view of the Library. Whoever moves the
 * window (the sidebar, the palette, a link of the chat, Alt+Left) calls `navigate`, so Back works after any of them.
 *
 * Kept tiny on purpose: it is part of the first screen. It imports nothing from `@rl/core` (zod); `nav.test.ts` checks
 * that the order below is the one of the contracts.
 */
export type NavView = 'library' | 'review' | 'projects' | 'discover' | 'map' | 'settings';

export interface NavLocation {
  view: NavView | 'reader';
  /** `reader`: the document (and page) that is open. */
  docId?: string;
  page?: number;
  /** `review`: `files` or `proposals`. Views with their own tabs may record them here. */
  tab?: string;
  /** `projects`: the open project. */
  projectId?: string;
  /** `settings`: the section id and an anchor inside it. */
  section?: string;
  anchor?: string;
}

/** The sidebar order and the accelerator command of each view (Alt+1..5, N21), then Settings. */
export const NAV_ORDER = [
  { id: 'nav.library', view: 'library' },
  { id: 'nav.review', view: 'review' },
  { id: 'nav.projects', view: 'projects' },
  { id: 'nav.discover', view: 'discover' },
  { id: 'nav.map', view: 'map' },
] as const;

const MAX_STACK = 50;

export const sameLocation = (a: NavLocation, b: NavLocation): boolean =>
  a.view === b.view && a.docId === b.docId && a.page === b.page && a.tab === b.tab && a.projectId === b.projectId && a.section === b.section && a.anchor === b.anchor;

interface NavValue {
  loc: NavLocation;
  /** The main view shown: the reader counts as the Library. */
  view: NavView;
  canBack: boolean;
  canForward: boolean;
  /** Moves to a place (pushing the current one). `replace` swaps the current place instead (no new entry). */
  navigate(loc: NavLocation, opts?: { replace?: boolean }): void;
  back(): void;
  forward(): void;
  /** A library switch: places of another library make no sense, so both stacks are dropped. */
  reset(loc?: NavLocation): void;
  /** Text for the last crumb (a document title, a project name), forgotten at the next move. */
  title: string | null;
  setTitle(title: string | null): void;
}

const HOME: NavLocation = { view: 'library' };
const NONE: NavValue = { loc: HOME, view: 'library', canBack: false, canForward: false, navigate() {}, back() {}, forward() {}, reset() {}, title: null, setTitle() {} };
const Ctx = createContext<NavValue>(NONE);
export const useNav = (): NavValue => useContext(Ctx);

export function NavProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ loc: NavLocation; back: NavLocation[]; fwd: NavLocation[] }>({ loc: HOME, back: [], fwd: [] });
  const [title, setTitleState] = useState<string | null>(null);

  const navigate = useCallback<NavValue['navigate']>((loc, opts) => {
    setTitleState(null);
    setState((s) => {
      if (sameLocation(s.loc, loc)) return s;
      if (opts?.replace) return { ...s, loc };
      return { loc, back: [...s.back, s.loc].slice(-MAX_STACK), fwd: [] };
    });
  }, []);
  const back = useCallback(() => {
    setTitleState(null);
    setState((s) => (s.back.length === 0 ? s : { loc: s.back[s.back.length - 1]!, back: s.back.slice(0, -1), fwd: [s.loc, ...s.fwd].slice(0, MAX_STACK) }));
  }, []);
  const forward = useCallback(() => {
    setTitleState(null);
    setState((s) => (s.fwd.length === 0 ? s : { loc: s.fwd[0]!, back: [...s.back, s.loc].slice(-MAX_STACK), fwd: s.fwd.slice(1) }));
  }, []);
  const reset = useCallback((loc?: NavLocation) => {
    setTitleState(null);
    setState((s) => ({ loc: loc ?? (s.loc.view === 'reader' ? HOME : s.loc), back: [], fwd: [] }));
  }, []);

  // Alt+Left / Alt+Right and the side buttons of the mouse (3 and 4).
  const act = useRef({ back, forward });
  act.current = { back, forward };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
      if (e.key === 'ArrowLeft') (e.preventDefault(), act.current.back());
      else if (e.key === 'ArrowRight') (e.preventDefault(), act.current.forward());
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) (e.preventDefault(), act.current.back());
      else if (e.button === 4) (e.preventDefault(), act.current.forward());
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onMouse);
    };
  }, []);

  const { loc } = state;
  const value = useMemo<NavValue>(
    () => ({ loc, view: loc.view === 'reader' ? 'library' : loc.view, canBack: state.back.length > 0, canForward: state.fwd.length > 0, navigate, back, forward, reset, title, setTitle: setTitleState }),
    [loc, state.back.length, state.fwd.length, navigate, back, forward, reset, title],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
