import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { ShortcutId } from '@rl/core';
import { SHORTCUT_COMMANDS, SHORTCUT_IDS, effectiveShortcuts, normalizeAccelerator, normalizeReaderToolKey } from './shortcutDefs';
import { useApp } from '../state/app-context';

/**
 * The one keymap of the window (plan §8, D-257, D-280): every reassignable shortcut is looked up here, so the user's
 * overrides in `AppSettings.shortcuts` apply everywhere. Global commands are dispatched by one `keydown` listener to the
 * handler a component registered with `useShortcut`; `reader` commands are checked by the reader itself with
 * `useShortcutMatcher` (they only apply with the reader focused). Fixed keys (Esc, Enter, arrows, Ctrl+A/C/V/X) are
 * never taken: `FIXED_ACCELERATORS` cannot be assigned.
 */

/** Keys that cannot be assigned to a command (they keep their normal meaning in every text field). */
export const FIXED_ACCELERATORS: readonly string[] = ['Ctrl+A', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X'];

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'> & { code?: string };

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS']);

/** Canonical accelerator (`Ctrl+Alt+Shift+<key>`) of a key press, or null when it is a lone modifier or not assignable. */
export function eventAccelerator(e: KeyLike): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  let key = e.key;
  if (key === ' ') key = 'Space';
  // Shift changes the character of digits ("!"): the physical digit is what the user means.
  const digit = e.code ? /^Digit(\d)$/.exec(e.code) : null;
  // ...unless Shift+digit is itself an assignable punctuation key of the layout (Italian: Shift+7 is "/").
  if (digit && e.shiftKey && !(key.length === 1 && ",./;'[]-=\\".includes(key))) key = digit[1]!;
  // A punctuation character that needs Shift on this layout ("/" is Shift+7 on an Italian keyboard) already carries the
  // Shift: the accelerator is the character, so Ctrl+/ matches on every layout (D-301).
  const shift = e.shiftKey && !(key.length === 1 && !/[\p{L}\p{N}]/u.test(key));
  const parts = [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', shift ? 'Shift' : '', key].filter(Boolean);
  return normalizeAccelerator(parts.join('+'));
}

/** Command of `scope` whose accelerator the key press matches (the first, in the order of `SHORTCUT_COMMANDS`). */
export function resolveShortcut(e: KeyLike, effective: Record<ShortcutId, string | null>, scope: 'global' | 'reader' | 'reader-tool'): ShortcutId | null {
  // Reader tools are single keys: a press with Ctrl, Alt or Meta is never one of them.
  const accel = scope === 'reader-tool' ? (e.ctrlKey || e.altKey || e.metaKey || MODIFIER_KEYS.has(e.key) ? null : normalizeReaderToolKey(e.key === ' ' ? 'Space' : e.key)) : eventAccelerator(e);
  if (!accel) return null;
  return SHORTCUT_IDS.find((id) => SHORTCUT_COMMANDS[id].scope === scope && effective[id] === accel) ?? null;
}

/** Text fields keep their own native undo and typing: commands that would clash with them leave them alone. */
export function isTextTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes(type);
  }
  return false;
}

interface Registration {
  run(e: KeyboardEvent): void;
  /** Also works while a modal dialog is open (the dialogs themselves, the palette, the guide). */
  inModal: boolean;
  /** Leaves the key alone when the focus is in a text field. */
  skipInText: boolean;
}

const DEFAULTS = effectiveShortcuts([]);
const Ctx = createContext<Record<ShortcutId, string | null>>(DEFAULTS);

/** Accelerator in force for each command (override, `null` = off, or default). */
export const useEffectiveShortcuts = () => useContext(Ctx);

/** `matches(event, id)`: does this key press mean the (reader) command `id`? */
export function useShortcutMatcher(): (e: KeyLike, id: ShortcutId) => boolean {
  const effective = useContext(Ctx);
  return useCallback((e, id) => effective[id] !== null && eventAccelerator(e) === effective[id], [effective]);
}

// One listener for the whole window, installed while something is registered. The accelerators in force live here too
// (the provider keeps them current), so the defaults work even without a provider (unit tests of single views).
const regs = new Map<ShortcutId, Registration[]>();
let inForce: Record<ShortcutId, string | null> = DEFAULTS;
let listening = false;

function onKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.isComposing) return;
  const id = resolveShortcut(e, inForce, 'global');
  if (!id) return;
  const list = regs.get(id);
  const reg = list?.[list.length - 1];
  if (!reg) return;
  if (reg.skipInText && isTextTarget(e.target)) return;
  if (!reg.inModal && document.querySelector('[role="dialog"][aria-modal="true"]')) return;
  e.preventDefault();
  reg.run(e);
}

function register(id: ShortcutId, reg: Registration): () => void {
  regs.set(id, [...(regs.get(id) ?? []), reg]);
  if (!listening) {
    window.addEventListener('keydown', onKey);
    listening = true;
  }
  return () => {
    regs.set(
      id,
      (regs.get(id) ?? []).filter((r) => r !== reg),
    );
    if (listening && [...regs.values()].every((l) => l.length === 0)) {
      window.removeEventListener('keydown', onKey);
      listening = false;
    }
  };
}

/** Publishes the user's accelerators (from the settings) to the keymap. */
export function KeymapProvider({ children }: { children: ReactNode }) {
  const app = useApp();
  const overrides = app.settings?.shortcuts;
  const effective = useMemo(() => effectiveShortcuts(overrides ?? []), [overrides]);
  inForce = effective;
  useEffect(() => {
    inForce = effective;
    return () => {
      inForce = DEFAULTS;
    };
  }, [effective]);
  return <Ctx.Provider value={effective}>{children}</Ctx.Provider>;
}

/** Runs `handler` when the global command `id` is pressed (with the user's accelerator). The latest handler is used. */
export function useShortcut(id: ShortcutId, handler: (e: KeyboardEvent) => void, opts: { inModal?: boolean; skipInText?: boolean; enabled?: boolean } = {}): void {
  const ref = useRef(handler);
  ref.current = handler;
  const { inModal = false, skipInText = false, enabled = true } = opts;
  useEffect(() => {
    if (!enabled) return;
    return register(id, { run: (e) => ref.current(e), inModal, skipInText });
  }, [id, inModal, skipInText, enabled]);
}
