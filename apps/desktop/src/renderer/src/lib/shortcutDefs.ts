import type { ShortcutId, ShortcutOverride } from '@rl/core';

/**
 * The shortcut table and the accelerator helpers of `@rl/core` (`shortcuts.ts`), copied here without zod: that file
 * builds zod schemas at load time, and importing it from the keymap (part of the first screen) would put zod, a third
 * of the bundle, in front of the first paint. `shortcutDefs.test.ts` checks that this copy and the contract agree
 * (same commands, scopes, defaults, same answers). The lazy parts (editor, guide) use the contract itself.
 */
export const SHORTCUT_COMMANDS: Record<ShortcutId, { scope: 'global' | 'reader'; default: string }> = {
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
};

export const SHORTCUT_IDS = Object.keys(SHORTCUT_COMMANDS) as ShortcutId[];

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

export function effectiveShortcuts(overrides: readonly ShortcutOverride[]): Record<ShortcutId, string | null> {
  const out = {} as Record<ShortcutId, string | null>;
  for (const id of SHORTCUT_IDS) out[id] = SHORTCUT_COMMANDS[id].default;
  for (const o of overrides) out[o.id] = o.accelerator;
  return out;
}
