import { z } from 'zod';

/**
 * Keyboard shortcuts of the app (plan §8). The ids and the defaults live here so that the renderer (handlers, the
 * shortcut list, the editor in the settings) and the tests agree; the user's overrides are in `AppSettings.shortcuts`.
 * Only the commands listed here can be rebound; fixed keys (Escape, Ctrl+A, arrows, Enter) are not customizable.
 * `scope`: `global` works everywhere; `reader` only with the PDF reader focused (so a reader key may repeat a global
 * one of another scope without a conflict, but never one of the same scope or of `global`).
 */
export const SHORTCUT_COMMANDS = {
  'palette.open': { scope: 'global', default: 'Ctrl+K' },
  'chat.toggle': { scope: 'global', default: 'Ctrl+J' },
  'history.undo': { scope: 'global', default: 'Ctrl+Z' },
  'history.redo': { scope: 'global', default: 'Ctrl+Y' },
  'search.focus': { scope: 'global', default: 'Ctrl+L' },
  'nav.library': { scope: 'global', default: 'Alt+1' },
  'nav.projects': { scope: 'global', default: 'Alt+2' },
  'nav.network': { scope: 'global', default: 'Alt+3' },
  'nav.inbox': { scope: 'global', default: 'Alt+4' },
  'nav.review': { scope: 'global', default: 'Alt+5' },
  'nav.settings': { scope: 'global', default: 'Ctrl+,' },
  'guide.open': { scope: 'global', default: 'F1' },
  'shortcuts.show': { scope: 'global', default: 'Ctrl+/' },
  'reader.find': { scope: 'reader', default: 'Ctrl+F' },
  'reader.highlight': { scope: 'reader', default: 'Ctrl+Shift+H' },
  'reader.underline': { scope: 'reader', default: 'Ctrl+Shift+U' },
} as const satisfies Record<string, { scope: 'global' | 'reader'; default: string }>;

export type ShortcutId = keyof typeof SHORTCUT_COMMANDS;
export const SHORTCUT_IDS = Object.keys(SHORTCUT_COMMANDS) as ShortcutId[];
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

/** One override: `accelerator` null disables the command. Commands without an override use their default. */
export const shortcutOverrideSchema = z.object({ id: shortcutIdSchema, accelerator: acceleratorSchema.nullable() });
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

/** Pairs of commands that would answer the same key in the same place. Empty list: no conflict. */
export function findShortcutConflicts(effective: Record<ShortcutId, string | null>): [ShortcutId, ShortcutId][] {
  const out: [ShortcutId, ShortcutId][] = [];
  for (let i = 0; i < SHORTCUT_IDS.length; i++) {
    for (let j = i + 1; j < SHORTCUT_IDS.length; j++) {
      const a = SHORTCUT_IDS[i]!;
      const b = SHORTCUT_IDS[j]!;
      const ka = effective[a];
      if (ka === null || ka !== effective[b]) continue;
      const sa = SHORTCUT_COMMANDS[a].scope;
      const sb = SHORTCUT_COMMANDS[b].scope;
      if (sa === 'global' || sb === 'global' || sa === sb) out.push([a, b]);
    }
  }
  return out;
}
