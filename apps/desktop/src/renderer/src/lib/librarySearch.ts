import { useSyncExternalStore } from 'react';

/**
 * The text of the library search. The box lives in the top bar (D-441), the results in the Library view: this is the one
 * place both read and write. The Library clears it when it goes away, as the box of the view used to.
 */
let text = '';
const listeners = new Set<() => void>();

export const getSearchText = (): string => text;

export function setSearchText(next: string): void {
  if (next === text) return;
  text = next;
  for (const l of [...listeners]) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const useSearchText = (): string => useSyncExternalStore(subscribe, getSearchText, getSearchText);
