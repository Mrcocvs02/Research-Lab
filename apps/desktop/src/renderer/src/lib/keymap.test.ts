// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectiveShortcuts, findShortcutConflicts } from '@rl/core';
import { FIXED_ACCELERATORS, KeymapProvider, eventAccelerator, isTextTarget, resolveShortcut, useShortcut } from './keymap';

let overrides: Array<{ id: string; accelerator: string | null }> = [];
vi.mock('../state/app-context', () => ({ useApp: () => ({ settings: { shortcuts: overrides } }) }));

const key = (init: Partial<KeyboardEventInit> & { key: string }) => init;

afterEach(() => {
  cleanup();
  overrides = [];
  document.body.innerHTML = '';
});

describe('eventAccelerator', () => {
  it('builds the canonical form, Ctrl standing for Cmd as well', () => {
    expect(eventAccelerator({ key: 'k', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBe('Ctrl+K');
    expect(eventAccelerator({ key: 'k', ctrlKey: false, metaKey: true, shiftKey: false, altKey: false })).toBe('Ctrl+K');
    expect(eventAccelerator({ key: 'H', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false })).toBe('Ctrl+Shift+H');
    expect(eventAccelerator({ key: ',', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBe('Ctrl+,');
    expect(eventAccelerator({ key: 'F1', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false })).toBe('F1');
  });
  it('uses the physical digit with Shift, and ignores lone modifiers and plain keys', () => {
    expect(eventAccelerator({ key: '!', code: 'Digit1', ctrlKey: false, metaKey: false, shiftKey: true, altKey: true })).toBe('Alt+Shift+1');
    expect(eventAccelerator({ key: 'Control', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBeNull();
    expect(eventAccelerator({ key: 'a', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false })).toBeNull();
  });
});

describe('resolveShortcut', () => {
  const press = (k: string, mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
  it('finds the command of a scope with the defaults', () => {
    const eff = effectiveShortcuts([]);
    expect(resolveShortcut(press('k', { ctrlKey: true }), eff, 'global')).toBe('palette.open');
    expect(resolveShortcut(press('3', { altKey: true }), eff, 'global')).toBe('nav.network');
    expect(resolveShortcut(press('f', { ctrlKey: true }), eff, 'global')).toBeNull();
    expect(resolveShortcut(press('f', { ctrlKey: true }), eff, 'reader')).toBe('reader.find');
  });
  it('follows an override and a disabled command', () => {
    const eff = effectiveShortcuts([
      { id: 'palette.open', accelerator: 'Ctrl+P' },
      { id: 'chat.toggle', accelerator: null },
    ]);
    expect(resolveShortcut(press('k', { ctrlKey: true }), eff, 'global')).toBeNull();
    expect(resolveShortcut(press('p', { ctrlKey: true }), eff, 'global')).toBe('palette.open');
    expect(resolveShortcut(press('j', { ctrlKey: true }), eff, 'global')).toBeNull();
  });
  it('the defaults have no conflict, a repeated key in one scope has', () => {
    expect(findShortcutConflicts(effectiveShortcuts([]))).toEqual([]);
    expect(findShortcutConflicts(effectiveShortcuts([{ id: 'chat.toggle', accelerator: 'Ctrl+K' }]))).toEqual([['palette.open', 'chat.toggle']]);
  });
  it('keeps the fixed keys out of reach', () => {
    for (const f of FIXED_ACCELERATORS) expect(Object.values(effectiveShortcuts([])).includes(f)).toBe(false);
  });
});

describe('isTextTarget', () => {
  it('is true for text fields and false for buttons and checkboxes', () => {
    const input = document.createElement('input');
    const box = document.createElement('input');
    box.type = 'checkbox';
    expect(isTextTarget(input)).toBe(true);
    expect(isTextTarget(box)).toBe(false);
    expect(isTextTarget(document.createElement('button'))).toBe(false);
  });
});

function Probe({ onRun, inModal = false, skipInText = false }: { onRun(): void; inModal?: boolean; skipInText?: boolean }) {
  useShortcut('palette.open', onRun, { inModal, skipInText });
  return createElement('input', { 'data-testid': 'field' });
}
const mount = (props: Parameters<typeof Probe>[0]) => render(createElement(KeymapProvider, null, createElement(Probe, props)));

describe('KeymapProvider', () => {
  it('dispatches the registered handler for the accelerator in force and prevents the default', () => {
    const run = vi.fn();
    mount({ onRun: run });
    const ev = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(run).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });
  it('honours an override: the default key no longer works, the new one does', () => {
    overrides = [{ id: 'palette.open', accelerator: 'Ctrl+P' }];
    const run = vi.fn();
    mount({ onRun: run });
    fireEvent.keyDown(window, key({ key: 'k', ctrlKey: true }));
    expect(run).not.toHaveBeenCalled();
    fireEvent.keyDown(window, key({ key: 'p', ctrlKey: true }));
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('does nothing for a disabled command', () => {
    overrides = [{ id: 'palette.open', accelerator: null }];
    const run = vi.fn();
    mount({ onRun: run });
    fireEvent.keyDown(window, key({ key: 'k', ctrlKey: true }));
    expect(run).not.toHaveBeenCalled();
  });
  it('leaves text fields alone when asked, and stays quiet behind a modal dialog unless allowed', () => {
    const run = vi.fn();
    const { getByTestId } = mount({ onRun: run, skipInText: true });
    fireEvent.keyDown(getByTestId('field'), key({ key: 'k', ctrlKey: true }));
    expect(run).not.toHaveBeenCalled();
    cleanup();
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    const blocked = vi.fn();
    mount({ onRun: blocked });
    fireEvent.keyDown(window, key({ key: 'k', ctrlKey: true }));
    expect(blocked).not.toHaveBeenCalled();
    cleanup();
    const allowed = vi.fn();
    mount({ onRun: allowed, inModal: true });
    fireEvent.keyDown(window, key({ key: 'k', ctrlKey: true }));
    expect(allowed).toHaveBeenCalledTimes(1);
  });
});
