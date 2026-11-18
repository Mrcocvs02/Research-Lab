import { z } from 'zod';

/**
 * Keyboard shortcuts of the app (plan §8). The ids and the defaults live here so that the renderer (handlers, the
 * shortcut list, the editor in the settings) and the tests agree; the user's overrides are in `AppSettings.shortcuts`.
 * Only the commands listed here can be rebound; fixed keys (Escape, Ctrl+A, arrows, Enter) are not customizable.
 * `scope`: `global` works everywhere; `reader` only with the PDF reader focused (so a reader key may repeat a global
 * one of another scope without a conflict, but never one of the same scope or of `global`); `reader-tool` is the
 * annotation tools of the reader (D-332, §8.2.6): a bare key without modifiers (letters, digits, Space, Delete), live
 * only while the focus is inside the reader region and not in a text field. It conflicts with its own scope and with
 * `reader`, never with `global` (a bare key cannot equal a global accelerator).
 */
export type ShortcutScope = 'global' | 'reader' | 'reader-tool';

/**
 * Alt+1..5 follow the sidebar (N21). `reader.tool.crop` (R) is the fifth tool of D-410/§17.4.8: the key is reserved
 * now, its behaviour arrives with the crop feature. `reader.tool.swap` (Space) swaps the current and the last tool.
 * Each scope has its own key grammar (see `shortcutOverrideSchema`).
 */
export const SHORTCUT_COMMANDS = {
  'palette.open': { scope: 'global', default: 'Ctrl+K' },
  'chat.toggle': { scope: 'global', default: 'Ctrl+J' },
  'history.undo': { scope: 'global', default: 'Ctrl+Z' },
  'history.redo': { scope: 'global', default: 'Ctrl+Y' },
  'search.focus': { scope: 'global', default: 'Ctrl+L' },
  'nav.library': { scope: 'global', default: 'Alt+1' },
  'nav.review': { scope: 'global', default: 'Alt+2' },
  'nav.projects': { scope: 'global', default: 'Alt+3' },
  'nav.discover': { scope: 'global', default: 'Alt+4' },
  'nav.map': { scope: 'global', default: 'Alt+5' },
  'nav.settings': { scope: 'global', default: 'Ctrl+,' },
  'guide.open': { scope: 'global', default: 'F1' },
  'shortcuts.show': { scope: 'global', default: 'Ctrl+/' },
  'reader.find': { scope: 'reader', default: 'Ctrl+F' },
  'reader.highlight': { scope: 'reader', default: 'Ctrl+Shift+H' },
  'reader.underline': { scope: 'reader', default: 'Ctrl+Shift+U' },
  'reader.close': { scope: 'reader', default: 'Ctrl+W' },
  'reader.tool.select': { scope: 'reader-tool', default: 'V' },
  'reader.tool.highlight': { scope: 'reader-tool', default: 'H' },
  'reader.tool.underline': { scope: 'reader-tool', default: 'U' },
  'reader.tool.crop': { scope: 'reader-tool', default: 'R' },
  'reader.tool.eraser': { scope: 'reader-tool', default: 'E' },
  'reader.tool.swap': { scope: 'reader-tool', default: 'Space' },
  'reader.color.1': { scope: 'reader-tool', default: '1' },
  'reader.color.2': { scope: 'reader-tool', default: '2' },
  'reader.color.3': { scope: 'reader-tool', default: '3' },
  'reader.color.4': { scope: 'reader-tool', default: '4' },
  'reader.color.5': { scope: 'reader-tool', default: '5' },
  'reader.comment': { scope: 'reader-tool', default: 'C' },
  'reader.annotation.delete': { scope: 'reader-tool', default: 'Delete' },
} as const satisfies Record<string, { scope: ShortcutScope; default: string }>;

/**
 * The navigation ids in the order of the sidebar (Alt+1..5) and the main view each one opens. `nav.settings` is not in
 * the sidebar order (Ctrl+,). Typed so that the shell, the palette and the settings list cannot drift apart.
 */
export const NAV_VIEW_OF = {
  'nav.library': 'library',
  'nav.review': 'review',
  'nav.projects': 'projects',
  'nav.discover': 'discover',
  'nav.map': 'map',
  'nav.settings': 'settings',
} as const;
export type NavShortcutId = keyof typeof NAV_VIEW_OF;
export type NavView = (typeof NAV_VIEW_OF)[NavShortcutId];
export const NAV_SIDEBAR_IDS = ['nav.library', 'nav.review', 'nav.projects', 'nav.discover', 'nav.map'] as const satisfies readonly NavShortcutId[];

export type ShortcutId = keyof typeof SHORTCUT_COMMANDS;
export const SHORTCUT_IDS = Object.keys(SHORTCUT_COMMANDS) as ShortcutId[];
/** Ids that existed before the redesign (Arrivals and Network became To review and Map); old overrides move to them. */
const LEGACY_SHORTCUT_IDS: Record<string, ShortcutId> = { 'nav.inbox': 'nav.review', 'nav.network': 'nav.map' };

/**
 * For the overrides read from the settings file only: moves the overrides of the renamed ids to their new ids, drops
 * the ones of commands that no longer exist and keeps the first of a repeated id, so a file written by an older
 * version still loads instead of being refused as a whole.
 */
export function migrateShortcutOverrides(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const o of raw) {
    const id = typeof o === 'object' && o !== null ? (o as { id?: unknown }).id : undefined;
    if (typeof id !== 'string') {
      out.push(o);
      continue;
    }
    const to = LEGACY_SHORTCUT_IDS[id] ?? id;
    if (!Object.hasOwn(SHORTCUT_COMMANDS, to) || seen.has(to)) continue;
    seen.add(to);
    out.push({ ...(o as object), id: to });
  }
  return out;
}

export const shortcutIdSchema = z.enum(SHORTCUT_IDS as [ShortcutId, ...ShortcutId[]]);

const NAMED_KEYS = ['Enter', 'Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const PUNCTUATION = ",./;'[]-=\\";

/**
 * Canonical form of an accelerator (`Ctrl+Alt+Shift+<key>`, modifiers in that order, letters in upper case) or null
 * when it is not valid. Needs Ctrl or Alt unless the key is F1..F12 (Shift alone would clash with typing).
 */
export function normalizeAccelerator(input: string): string | null {
  const parts = input.split('+').map((p) => p.trim());
  // "Ctrl++" and "Ctrl+," style: an empty piece followed by nothing means the key is '+'.
  const key = parts.pop() ?? '';
  if (key === '' && input.trim().endsWith('+')) return null;
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  if (mods.size !== parts.length) return null;
  for (const m of mods) if (m !== 'ctrl' && m !== 'alt' && m !== 'shift') return null;
  let k: string;
  if (/^[a-z0-9]$/i.test(key)) k = key.toUpperCase();
  else if (/^f([1-9]|1[0-2])$/i.test(key)) k = key.toUpperCase();
  else if (key.length === 1 && PUNCTUATION.includes(key)) k = key;
  else {
    const named = NAMED_KEYS.find((n) => n.toLowerCase() === key.toLowerCase());
    if (!named) return null;
    k = named;
  }
  if (!/^F\d+$/.test(k) && !mods.has('ctrl') && !mods.has('alt')) return null;
  return [mods.has('ctrl') ? 'Ctrl' : '', mods.has('alt') ? 'Alt' : '', mods.has('shift') ? 'Shift' : '', k].filter(Boolean).join('+');
}

export const acceleratorSchema = z
  .string()
  .max(40)
  .transform((s, ctx) => {
    const n = normalizeAccelerator(s);
    if (n === null) ctx.issues.push({ code: 'custom', message: 'invalid accelerator', input: s });
    return n ?? '';
  });

/**
 * Canonical bare key of the `reader-tool` scope (no modifiers: a letter, a digit, Space or Delete) or null. Letters are
 * upper case.
 */
export function normalizeReaderToolKey(input: string): string | null {
  const k = input.trim();
  if (/^[a-z0-9]$/i.test(k)) return k.toUpperCase();
  if (k.toLowerCase() === 'space') return 'Space';
  if (k.toLowerCase() === 'delete') return 'Delete';
  return null;
}

/** One override: `accelerator` null disables the command. Commands without an override use their default. */
export const shortcutOverrideSchema = z
  .object({ id: shortcutIdSchema, accelerator: z.string().max(40).nullable() })
  .transform((o, ctx) => {
    if (o.accelerator === null) return { id: o.id, accelerator: null };
    const n = SHORTCUT_COMMANDS[o.id].scope === 'reader-tool' ? normalizeReaderToolKey(o.accelerator) : normalizeAccelerator(o.accelerator);
    if (n === null) ctx.issues.push({ code: 'custom', message: 'invalid accelerator', input: o.accelerator });
    return { id: o.id, accelerator: n ?? '' };
  });
export type ShortcutOverride = z.infer<typeof shortcutOverrideSchema>;

/** The list is replaced as a whole when saved (an empty list restores every default); an id appears at most once. */
export const shortcutOverridesSchema = z
  .array(shortcutOverrideSchema)
  .max(SHORTCUT_IDS.length)
  .refine((l) => new Set(l.map((o) => o.id)).size === l.length, 'duplicate shortcut id');

/** Accelerator in force for each command: the override (null = off) or the default. */
export function effectiveShortcuts(overrides: readonly ShortcutOverride[]): Record<ShortcutId, string | null> {
  const out = {} as Record<ShortcutId, string | null>;
  for (const id of SHORTCUT_IDS) out[id] = SHORTCUT_COMMANDS[id].default;
  for (const o of overrides) out[o.id] = o.accelerator;
  return out;
}

/** Pairs of commands bound to the same accelerator (see the note inside about scopes). Empty list: no conflict. */
export function findShortcutConflicts(effective: Record<ShortcutId, string | null>): [ShortcutId, ShortcutId][] {
  const out: [ShortcutId, ShortcutId][] = [];
  for (let i = 0; i < SHORTCUT_IDS.length; i++) {
    for (let j = i + 1; j < SHORTCUT_IDS.length; j++) {
      const a = SHORTCUT_IDS[i]!;
      const b = SHORTCUT_IDS[j]!;
      const ka = effective[a];
      if (ka === null || ka !== effective[b]) continue;
      out.push([a, b]);
    }
  }
  return out;
}
