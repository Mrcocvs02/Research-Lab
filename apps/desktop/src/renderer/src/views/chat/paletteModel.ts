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

/** The groups of the palette, in the order they are shown (3.4). */
export const PALETTE_GROUPS = ['recent', 'docs', 'goto', 'actions', 'claude'] as const;
export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

/** Palette actions that are not prompts: go to a view, do something. `shortcut` is the command whose key is shown. */
export const PALETTE_ACTIONS = [
  { id: 'goLibrary', group: 'goto', shortcut: 'nav.library' },
  { id: 'goReview', group: 'goto', shortcut: 'nav.review' },
  { id: 'goProjects', group: 'goto', shortcut: 'nav.projects' },
  { id: 'goDiscover', group: 'goto', shortcut: 'nav.discover' },
  { id: 'goMap', group: 'goto', shortcut: 'nav.map' },
  { id: 'goSettings', group: 'goto', shortcut: 'nav.settings' },
  { id: 'openActivity', group: 'goto' },
  { id: 'scanNow', group: 'actions' },
  { id: 'backupNow', group: 'actions' },
  { id: 'addPdf', group: 'actions' },
  { id: 'newLibrary', group: 'actions' },
  { id: 'undo', group: 'actions', shortcut: 'history.undo' },
  { id: 'redo', group: 'actions', shortcut: 'history.redo' },
  { id: 'theme', group: 'actions' },
  { id: 'switchLanguage', group: 'actions' },
  { id: 'openGuide', group: 'actions', shortcut: 'guide.open' },
  { id: 'showShortcuts', group: 'actions', shortcut: 'shortcuts.show' },
] as const;
export type PaletteActionId = (typeof PALETTE_ACTIONS)[number]['id'];

/**
 * What the palette lists. With no text only the recent entries and the go-to and action groups are shown (the commands for
 * Claude and the documents need a few letters); with text every group is filtered. `max` caps a group of documents.
 */
export function groupItems<T extends { id: string; group: PaletteGroup }>(items: readonly T[], opts: { query: string; recents: readonly string[]; docs?: readonly T[] }): T[] {
  const typed = opts.query.trim() !== '';
  const recent = orderByRecent(items, opts.recents).filter((i) => opts.recents.includes(i.id)).slice(0, 5);
  const recentIds = new Set(recent.map((i) => i.id));
  const rest = items.filter((i) => typed || (!recentIds.has(i.id) && i.group !== 'claude'));
  const docs = typed ? (opts.docs ?? []) : [];
  const all = [...(typed ? [] : recent.map((i) => ({ ...i, group: 'recent' as const }))), ...docs, ...rest];
  return PALETTE_GROUPS.flatMap((g) => all.filter((i) => i.group === g));
}
