// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_ACTIONS } from './commands';
import { SHORTCUT_COMMANDS } from '@rl/core';
import { filterItems, foldText, loadRecents, orderByRecent, rememberRecent } from './paletteModel';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const items = [
  { id: 'a', label: 'Vai alla Libreria' },
  { id: 'b', label: 'Apri le impostazioni' },
  { id: 'c', label: 'Già letti: elenco' },
  { id: 'd', label: 'Libreria nuova…' },
];

describe('palette search', () => {
  it('ignores case and accents', () => {
    expect(foldText('  Già   LETTI ')).toBe('gia letti');
    expect(filterItems(items, 'GIA').map((i) => i.id)).toEqual(['c']);
    expect(filterItems(items, 'già').map((i) => i.id)).toEqual(['c']);
    expect(filterItems(items, 'IMPOSTAZIONI').map((i) => i.id)).toEqual(['b']);
  });
  it('needs every word, in any order, and puts labels that start with the query first', () => {
    expect(filterItems(items, 'libreria vai').map((i) => i.id)).toEqual(['a']);
    expect(filterItems(items, 'libreria').map((i) => i.id)).toEqual(['d', 'a']);
    expect(filterItems(items, 'zzz')).toEqual([]);
  });
  it('returns everything for an empty query', () => {
    expect(filterItems(items, '  ')).toHaveLength(4);
  });
});

describe('recent use', () => {
  it('keeps the newest first, without repeats, and orders items by it', () => {
    expect(loadRecents()).toEqual([]);
    rememberRecent('b');
    rememberRecent('c');
    expect(rememberRecent('b')).toEqual(['b', 'c']);
    expect(loadRecents()).toEqual(['b', 'c']);
    expect(orderByRecent(items, loadRecents()).map((i) => i.id)).toEqual(['b', 'c', 'a', 'd']);
  });
  it('works when the storage throws or holds garbage', () => {
    window.localStorage.setItem('rl.paletteRecent', '{not json');
    expect(loadRecents()).toEqual([]);
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      expect(loadRecents()).toEqual([]);
      expect(rememberRecent('x')).toEqual(['x']);
    } finally {
      Object.defineProperty(window, 'localStorage', real);
    }
  });
});

describe('app actions', () => {
  it('only point at shortcut commands that exist', () => {
    for (const a of APP_ACTIONS) if ('shortcut' in a) expect(a.shortcut in SHORTCUT_COMMANDS).toBe(true);
  });
});
