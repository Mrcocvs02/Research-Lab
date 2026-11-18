import { useSyncExternalStore } from 'react';
import { NO_ALIASES, type AuthorAliases } from './entityData';

/**
 * The user's corrections to the authors (D-386): "Separate these forms" and "Merge with…". They belong in
 * `<dataDir>/graph/author-aliases.json`, written by the main process (N4); until that handler exists they are kept for this
 * browser profile and per library, and applied to the networks the view derives itself.
 */
const KEY = (lib: string) => `rl.authorAliases.${lib}`;
let version = 0;
const listeners = new Set<() => void>();

export function readAliases(lib: string): AuthorAliases {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(lib)) ?? 'null') as Partial<AuthorAliases> | null;
    return { merge: raw?.merge ?? {}, split: raw?.split ?? [] };
  } catch {
    return NO_ALIASES;
  }
}

function save(lib: string, a: AuthorAliases): void {
  try {
    localStorage.setItem(KEY(lib), JSON.stringify(a));
  } catch {
    /* storage unavailable: the correction lasts until the view reloads */
  }
  version++;
  listeners.forEach((l) => l());
}

/** `from` and `to` are author keys (the part after `author:`). */
export function mergeAuthors(lib: string, from: string, to: string): void {
  const a = readAliases(lib);
  if (from === to) return;
  save(lib, { split: a.split, merge: { ...a.merge, [from]: to } });
}

export function splitAuthor(lib: string, key: string): void {
  const a = readAliases(lib);
  const merge = Object.fromEntries(Object.entries(a.merge).filter(([k, v]) => k !== key && v !== key));
  save(lib, { merge, split: a.split.includes(key) ? a.split : [...a.split, key] });
}

/** Changes whenever a correction was saved, so the networks load again. */
export function useAliasVersion(): number {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => version,
    () => version,
  );
}
