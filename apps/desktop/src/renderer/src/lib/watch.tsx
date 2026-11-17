import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useApp } from '../state/app-context';
import { rl } from './rl';

const Ctx = createContext(0);
/** New works found by the followed sources and not dismissed (the badge of the Discover section). */
export const useWatchCount = () => useContext(Ctx);

/**
 * The count for the badge, from `watch:list` only: a local read of `watch.json`, so no network call is made here, at
 * startup or later. It is read when the library opens and again when `watch:changed` arrives (after a check or a
 * dismissal). The Discover view itself loads when it is opened.
 */
export function WatchProvider({ children }: { children: ReactNode }) {
  const { activeLibraryId } = useApp();
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(0);
    if (!activeLibraryId) return;
    let live = true;
    const load = () =>
      rl.invoke('watch:list', {}).then(
        (r) => live && setCount(r.sources.reduce((n, s) => n + s.newCount, 0)),
        () => {},
      );
    void load();
    const off = rl.on('watch:changed', () => void load());
    return () => {
      live = false;
      off();
    };
  }, [activeLibraryId]);
  return <Ctx.Provider value={count}>{children}</Ctx.Provider>;
}
