import { describe, expect, it } from 'vitest';
import * as core from '@rl/core';
import * as lite from './shortcutDefs';

describe('shortcutDefs (the zod-free copy for the first screen)', () => {
  it('has the same commands, scopes and defaults as the contract', () => {
    expect(lite.SHORTCUT_COMMANDS).toEqual(core.SHORTCUT_COMMANDS);
    expect(lite.SHORTCUT_IDS).toEqual(core.SHORTCUT_IDS);
  });

  it('normalizes accelerators like the contract', () => {
    const inputs = ['ctrl+k', 'Ctrl+Shift+h', 'alt+1', 'F1', 'f12', 'F13', 'Shift+A', 'a', 'Ctrl+,', 'Ctrl+/', 'ctrl+alt+shift+x', 'Ctrl+Ctrl+K', 'Meta+K', 'Ctrl+', 'Ctrl+space', 'ctrl+arrowup', 'Ctrl+Escape', '', 'Ctrl+Enter', 'Alt+Tab'];
    for (const i of inputs) expect(lite.normalizeAccelerator(i), i).toBe(core.normalizeAccelerator(i));
  });

  it('computes the accelerators in force like the contract', () => {
    const lists = [[], [{ id: 'palette.open', accelerator: 'Ctrl+P' }], [{ id: 'chat.toggle', accelerator: null }, { id: 'nav.review', accelerator: 'Alt+9' }]] as core.ShortcutOverride[][];
    for (const l of lists) expect(lite.effectiveShortcuts(l)).toEqual(core.effectiveShortcuts(l));
  });
});
