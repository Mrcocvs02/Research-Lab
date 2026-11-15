import { useCallback, useState } from 'react';

/** Boolean kept in localStorage as a per-viewer convenience; works without storage. */
export function useLocalFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initial : raw === '1';
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        window.localStorage.setItem(key, v ? '1' : '0');
      } catch {
        // storage unavailable: keep the in-memory value
      }
    },
    [key],
  );
  return [value, set];
}
