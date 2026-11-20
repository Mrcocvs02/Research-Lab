// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampWidth, keyWidth, useResizable } from './useResizable';

const lim = { def: 200, min: 100, max: 300 };
afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('clampWidth', () => {
  it('keeps the width between min and max and survives garbage', () => {
    expect(clampWidth(50, lim)).toBe(100);
    expect(clampWidth(999, lim)).toBe(300);
    expect(clampWidth(150.4, lim)).toBe(150);
    expect(clampWidth(Number.NaN, lim)).toBe(100);
  });
});

describe('keyWidth', () => {
  it('moves by 16 px towards the side the edge grows to', () => {
    expect(keyWidth(200, 'ArrowRight', 'end', lim)).toBe(216);
    expect(keyWidth(200, 'ArrowLeft', 'end', lim)).toBe(184);
    expect(keyWidth(200, 'ArrowLeft', 'start', lim)).toBe(216);
    expect(keyWidth(200, 'ArrowRight', 'start', lim)).toBe(184);
  });
  it('clamps, jumps with Home/End and ignores other keys', () => {
    expect(keyWidth(298, 'ArrowRight', 'end', lim)).toBe(300);
    expect(keyWidth(200, 'Home', 'end', lim)).toBe(100);
    expect(keyWidth(200, 'End', 'start', lim)).toBe(300);
    expect(keyWidth(200, 'a', 'end', lim)).toBeNull();
  });
});

describe('useResizable', () => {
  it('starts at the default, clamps, persists on release and resets', () => {
    const { result } = renderHook(() => useResizable('k', lim));
    expect(result.current.width).toBe(200);
    act(() => result.current.set(500, false));
    expect(result.current.width).toBe(300);
    expect(window.localStorage.getItem('k')).toBeNull();
    act(() => result.current.set(250));
    expect(window.localStorage.getItem('k')).toBe('250');
    act(() => result.current.reset());
    expect(result.current.width).toBe(200);
    expect(window.localStorage.getItem('k')).toBeNull();
  });
  it('restores a saved width, clamped to the current limits', () => {
    window.localStorage.setItem('k', '999');
    expect(renderHook(() => useResizable('k', lim)).result.current.width).toBe(300);
    window.localStorage.setItem('k', 'abc');
    expect(renderHook(() => useResizable('k', lim)).result.current.width).toBe(100);
  });
  it('works when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useResizable('k', lim));
    expect(result.current.width).toBe(200);
    act(() => result.current.set(240));
    expect(result.current.width).toBe(240);
  });
});
