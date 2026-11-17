import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { rl } from '../../lib/rl';
import { useApp } from '../../state/app-context';

export type WatchOp = 'check' | 'checkPublished';
export interface OpState<R> {
  running: boolean;
  cancelling: boolean;
  /** `done` of `total` looked at, `failed` of those (from `watch:progress`). */
  progress: { done: number; total: number; failed: number } | null;
  result: R | null;
  error: unknown;
}

const IDLE: OpState<never> = { running: false, cancelling: false, progress: null, result: null, error: null };
let states: Record<WatchOp, OpState<any>> = { check: IDLE, checkPublished: IDLE };
const listeners = new Set<() => void>();
let library: string | null = null;
let epoch = 0;

const set = (op: WatchOp, patch: Partial<OpState<any>>) => {
  states = { ...states, [op]: { ...states[op], ...patch } };
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/**
 * The state of a long network check, kept outside the views: leaving the tab (or the section) does not lose it, and
 * the answer of a check that ends meanwhile is there when the user comes back. A check started in another library is
 * forgotten when the library changes.
 */
export function useWatchOp<R>(op: WatchOp) {
  const { activeLibraryId } = useApp();
  const state = useSyncExternalStore(subscribe, () => states[op]) as OpState<R>;
  useEffect(() => {
    if (library === activeLibraryId) return;
    library = activeLibraryId;
    epoch++;
    states = { check: IDLE, checkPublished: IDLE };
    for (const l of listeners) l();
  }, [activeLibraryId]);

  const run = useCallback(
    async (invoke: () => Promise<R>, done?: (r: R) => void) => {
      if (states[op].running) return;
      const mine = epoch;
      set(op, { running: true, cancelling: false, progress: null, error: null });
      const off = rl.on('watch:progress', (p) => {
        if (p.op === op && mine === epoch) set(op, { progress: { done: p.done, total: p.total, failed: p.failed } });
      });
      try {
        const r = await invoke();
        if (mine === epoch) set(op, { running: false, cancelling: false, result: r });
        done?.(r);
      } catch (e) {
        if (mine === epoch) set(op, { running: false, cancelling: false, error: e });
      } finally {
        off();
      }
    },
    [op],
  );
  const cancel = useCallback(async () => {
    set(op, { cancelling: true });
    try {
      await rl.invoke('watch:cancel', { op });
    } catch {
      set(op, { cancelling: false });
    }
  }, [op]);
  /** Changes the stored result (a proposal applied is dropped from it). */
  const patch = useCallback((fn: (r: R) => R) => {
    const cur = states[op].result as R | null;
    if (cur) set(op, { result: fn(cur) });
  }, [op]);
  return { ...state, run, cancel, patch };
}

/** Forgets every operation (tests; the app forgets them when the library changes). */
export function resetWatchOps(): void {
  epoch++;
  library = null;
  states = { check: IDLE, checkPublished: IDLE };
  for (const l of listeners) l();
}
