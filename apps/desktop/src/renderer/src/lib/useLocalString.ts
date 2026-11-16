import { useCallback, useState } from 'react';

/** One of a fixed set of strings kept in localStorage as a per-viewer convenience; works without storage. */
export function useLocalChoice<T extends string>(key: string, allowed: readonly T[], initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key) as T | null;
      return raw !== null && allowed.includes(raw) ? raw : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        window.localStorage.setItem(key, v);
      } catch {
        // storage unavailable: keep the in-memory value
      }
    },
    [key],
  );
  return [value, set];
}
