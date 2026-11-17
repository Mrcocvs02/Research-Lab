/** Text for comparing labels: no case, no accents (NFD without combining marks), single spaces. */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Items whose label holds every word of the query (accents and case ignored); labels that start with it come first. */
export function filterItems<T extends { label: string }>(items: readonly T[], query: string): T[] {
  const words = foldText(query).split(' ').filter(Boolean);
  if (words.length === 0) return [...items];
  const hits: Array<{ item: T; starts: boolean }> = [];
  for (const item of items) {
    const label = foldText(item.label);
    if (words.every((w) => label.includes(w))) hits.push({ item, starts: label.startsWith(words[0]!) });
  }
  // Array.prototype.sort is stable: items of equal rank keep their order.
  return hits.sort((a, b) => Number(b.starts) - Number(a.starts)).map((h) => h.item);
}

const RECENTS_KEY = 'rl.paletteRecent';
const MAX_RECENTS = 12;

/** Ids of the commands used most recently, newest first (per viewer, localStorage; empty when storage is unavailable). */
export function loadRecents(): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENTS_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

/** Puts `id` first in the recent list (kept in localStorage when possible) and returns the new list. */
export function rememberRecent(id: string): string[] {
  const next = [id, ...loadRecents().filter((x) => x !== id)].slice(0, MAX_RECENTS);
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: the order just is not kept
  }
  return next;
}

/** Recently used items first (newest first), the others in their own order. */
export function orderByRecent<T extends { id: string }>(items: readonly T[], recents: readonly string[]): T[] {
  const rank = (id: string) => {
    const i = recents.indexOf(id);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  return [...items].sort((a, b) => rank(a.id) - rank(b.id));
}
