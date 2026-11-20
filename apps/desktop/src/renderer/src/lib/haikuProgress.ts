import { useEffect, useState, useSyncExternalStore } from 'react';
import type { TagAiProgress } from '@rl/core';
import { rl } from './rl';

/**
 * Progress of Haiku deciding the uncertain vocabulary questions (D-515), from the manual run and the automatic mode. One
 * listener of `tagReview:aiProgress`, shared by the dialog and the Activity chip; it exists only while one of them is mounted.
 */
let current: TagAiProgress | null = null;
const listeners = new Set<() => void>();
let off: (() => void) | null = null;

const set = (p: TagAiProgress | null) => {
  current = p;
  for (const l of listeners) l();
};

function subscribe(l: () => void): () => void {
  listeners.add(l);
  off ??= rl.on('tagReview:aiProgress', set);
  return () => {
    listeners.delete(l);
    if (listeners.size === 0) {
      off?.();
      off = null;
    }
  };
}

export const useHaikuProgress = (): TagAiProgress | null => useSyncExternalStore(subscribe, () => current);
export const dismissHaikuProgress = (): void => set(null);
export const haikuRunning = (p: TagAiProgress | null): boolean => p?.state === 'running';

/** "m:ss" of the time since `startedAt`, redrawn every second while `live`. */
export function useElapsed(startedAt: number | undefined, live: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [live, startedAt]);
  const sec = startedAt === undefined ? 0 : Math.max(0, Math.round(((live ? now : Date.now()) - startedAt) / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
