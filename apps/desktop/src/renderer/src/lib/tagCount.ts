import { useEffect, useState } from 'react';

/**
 * Proposals waiting in the tag review, as last seen by the tag manager (it computes them; the sidebar must not run the detector on
 * every change). Kept in localStorage per window session; absent until the manager was opened once.
 */
const KEY = 'rl.tagReviewCount';
const EVENT = 'rl:tag-count';

export function publishTagCount(n: number): void {
  try {
    window.localStorage.setItem(KEY, String(n));
  } catch {
    /* storage unavailable: no badge */
  }
  window.dispatchEvent(new Event(EVENT));
}

function read(): number {
  try {
    return Math.max(0, Number(window.localStorage.getItem(KEY)) || 0);
  } catch {
    return 0;
  }
}

export function useTagCount(): number {
  const [n, setN] = useState(read);
  useEffect(() => {
    const on = () => setN(read());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return n;
}
