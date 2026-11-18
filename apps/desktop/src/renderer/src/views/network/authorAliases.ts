import { useSyncExternalStore } from 'react';
import { rl } from '../../lib/rl';

/**
 * The user's corrections to the authors (D-386, D-454): "Separate these forms" and "Merge with…". They live in
 * `<dataDir>/graph/author-aliases.json`, written by the main process, which also applies them to the networks and to Explore.
 * Here only the change is announced, so the networks load again. Corrections an earlier version kept in this browser profile
 * (per library) are sent once and then forgotten.
 */
const OLD_KEY = (lib: string) => `rl.authorAliases.${lib}`;
let version = 0;
const listeners = new Set<() => void>();
const migrated = new Map<string, Promise<void>>();

function changed(): void {
  version++;
  listeners.forEach((l) => l());
}

/** Sends what localStorage holds for this library, once per session, and clears it when the main process has it. */
export function migrateAliases(lib: string): Promise<void> {
  let p = migrated.get(lib);
  if (!p) {
    p = (async () => {
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(OLD_KEY(lib));
      } catch {
        return;
      }
      if (raw === null) return;
      try {
        const old = JSON.parse(raw) as { merge?: Record<string, string>; split?: string[] };
        const merge = Object.fromEntries(Object.entries(old.merge ?? {}).filter(([k, v]) => typeof v === 'string' && k !== '' && v !== '' && k !== v));
        const split = (old.split ?? []).filter((k) => typeof k === 'string' && k !== '');
        if (Object.keys(merge).length > 0 || split.length > 0) await rl.invoke('graph:editAuthorAliases', { action: 'import', aliases: { merge, split } });
        localStorage.removeItem(OLD_KEY(lib));
      } catch {
        /* kept for the next start: nothing is lost */
        migrated.delete(lib);
      }
    })();
    migrated.set(lib, p);
  }
  return p;
}

/** `from` and `to` are author keys (the part after `author:`). */
export async function mergeAuthors(lib: string, from: string, to: string): Promise<void> {
  await migrateAliases(lib);
  await rl.invoke('graph:editAuthorAliases', { action: 'merge', from, to });
  changed();
}

export async function splitAuthor(lib: string, key: string): Promise<void> {
  await migrateAliases(lib);
  await rl.invoke('graph:editAuthorAliases', { action: 'split', key });
  changed();
}

/** Changes whenever a correction was saved, so the networks load again. */
export function useAliasVersion(): number {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => version,
    () => version,
  );
}
