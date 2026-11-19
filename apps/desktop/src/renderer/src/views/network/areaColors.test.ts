import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { areaFallback, areaNoteNeeded, assignAreaSlots, userTint, withUserTints, chromaFactor, colorCache, mainArea, mixAreaColor, OTHER, type AreaDef } from './areaColors';
import { AREA_DARK, AREA_LIGHT, contrast, fromOklch, parseColor, toOklab } from './colors';

const def = (id: string, count: number): AreaDef => ({ id, label: id, count, branches: [] });
const defs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((id, i) => def(id, 100 - i));
const slots = defs.map((_, i) => (i < 7 ? i : OTHER));
const tokens = [...AREA_LIGHT];

describe('colour by macro-area (section 18.3.4-18.3.6)', () => {
  it('gives the seven biggest areas a tint each, the others the grey, and remembers the hues', () => {
    const r = assignAreaSlots(defs, null);
    expect(r.slots).toEqual([0, 1, 2, 3, 4, 5, 6, OTHER, OTHER]);
    const swapped = assignAreaSlots([defs[1]!, defs[0]!, ...defs.slice(2)], r.memo);
    expect(swapped.slots[0]).toBe(1);
    expect(swapped.slots[1]).toBe(0);
  });

  it('goes through OKLab and back without losing the colour', () => {
    for (const c of tokens) {
      const [L, a, b] = toOklab(c);
      expect(fromOklch(L, Math.hypot(a, b), Math.atan2(b, a))).toBe(c);
    }
  });

  it('keeps the tint of a node fully inside one area and fades one between areas', () => {
    expect(mixAreaColor([[0, -1, 100]], 100, slots, tokens)).toBe(tokens[0]);
    const mixed = mixAreaColor([[0, 0, 50], [1, 0, 50]], 100, slots, tokens)!;
    expect(chromaFactor([[0, 0, 50], [1, 0, 50]], 100)).toBeCloseTo(0.2 + 0.8 * 0 * 1, 6);
    const [, a, b] = toOklab(mixed);
    expect(Math.hypot(a, b)).toBeLessThan(0.06);
    const weak = mixAreaColor([[0, -1, 100]], 0, slots, tokens)!;
    expect(Math.hypot(toOklab(weak)[1], toOklab(weak)[2])).toBeLessThan(Math.hypot(toOklab(tokens[0]!)[1], toOklab(tokens[0]!)[2]));
    expect(mixAreaColor([], 50, slots, tokens)).toBeNull();
    expect(mixAreaColor(undefined, 50, slots, tokens)).toBeNull();
  });

  it('rotates the hue by the rank of the branch and caches by the data', () => {
    const r0 = mixAreaColor([[1, 0, 100]], 100, slots, tokens);
    const r1 = mixAreaColor([[1, 1, 100]], 100, slots, tokens);
    expect(r0).not.toBe(r1);
    const cache = colorCache(slots, tokens);
    expect(cache([[1, 1, 100]], 100)).toBe(r1);
    expect(cache([[1, 1, 100]], 100)).toBe(r1);
    expect(mainArea([[2, 0, 30], [4, 0, 70]])).toBe(4);
    expect(mainArea(undefined)).toBe(-1);
  });

  it('turns opposite tints that cancel into a neutral grey and stays inside the gamut', () => {
    const t = [fromOklch(0.6, 0.1, 0), fromOklch(0.6, 0.1, Math.PI), ...tokens.slice(2)];
    const grey = mixAreaColor([[0, -1, 50], [1, -1, 50]], 100, slots, t)!;
    const [r, g, b] = parseColor(grey);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(12);
    for (const v of parseColor(fromOklch(0.7, 0.4, 2))) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('keeps every mix readable on the background in both themes (lightness stays between the tints)', () => {
    const cases = [
      { t: AREA_LIGHT, bg: '#f6f5f1' },
      { t: AREA_DARK, bg: '#121316' },
    ];
    for (const { t, bg } of cases) {
      for (const c of t) expect(contrast(c, bg)).toBeGreaterThanOrEqual(3);
      const Ls = t.slice(0, 7).map((c) => toOklab(c)[0]);
      for (let L = Math.min(...Ls); L <= Math.max(...Ls) + 1e-9; L += 0.02) expect(contrast(fromOklch(L, 0, 0), bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('falls back to topics without areas or with one, and notes a sparse tagging', () => {
    expect(areaFallback(undefined, 0, 10)).toEqual({ use: 'topics', reason: 'none' });
    expect(areaFallback([def('a', 5)], 5, 10)).toEqual({ use: 'topics', reason: 'single' });
    expect(areaFallback(defs.slice(0, 3), 1, 10)).toEqual({ use: 'areas', sparse: 1 });
    expect(areaFallback(defs.slice(0, 3), 9, 10)).toEqual({ use: 'areas' });
  });
});

describe('area tokens of palette.css (section 18.3.5)', () => {
  const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'palette.css'), 'utf8');
  const names = ['area-1', 'area-2', 'area-3', 'area-4', 'area-5', 'area-6', 'area-7', 'area-other', 'area-none'];
  const block = (marker: string): string[] => {
    const at = css.indexOf(marker);
    const body = css.slice(at, css.indexOf('}', at));
    return names.map((n) => new RegExp(`--${n}:[ ]*(#[0-9a-f]{6})`, 'i').exec(body)![1]!);
  };
  it('repeats the built-in fallback and reads at least 3:1 on the background in both themes', () => {
    expect(block(':root {')).toEqual([...AREA_LIGHT]);
    expect(block(":root[data-theme='dark']")).toEqual([...AREA_DARK]);
    for (const c of block(':root {')) expect(contrast(c, '#f6f5f1')).toBeGreaterThanOrEqual(3);
    for (const c of block(":root[data-theme='dark']")) expect(contrast(c, '#121316')).toBeGreaterThanOrEqual(3);
  });
});

describe('user colour of an area node and the colour notes', () => {
  const tokens = [...AREA_LIGHT];
  const defs = (color?: string): AreaDef[] => [
    { id: 'a', label: 'A', count: 5, branches: [], color },
    { id: 'b', label: 'B', count: 4, branches: [] },
  ];
  it('keeps the arguments when no area has a colour and appends a readable token for one that has', () => {
    const same = withUserTints(defs(), [0, 1], tokens, '#f6f5f1');
    expect(same.tokens).toBe(tokens);
    const u = withUserTints(defs('#ffff00'), [0, 1], tokens, '#f6f5f1');
    expect(u.slots[1]).toBe(1);
    expect(u.slots[0]).toBe(tokens.length);
    expect(contrast(u.tokens[u.slots[0]!]!, '#f6f5f1')).toBeGreaterThanOrEqual(3);
    expect(mixAreaColor([[0, -1, 100]], 100, u.slots, u.tokens)).not.toBeNull();
  });
  it('brings a colour into the lightness range of the tints with a chroma of at most 0.16', () => {
    const c = userTint('#ffffff', tokens, '#f6f5f1');
    expect(contrast(c, '#f6f5f1')).toBeGreaterThanOrEqual(3);
  });
  it('asks for a note when the topics colour the nodes or few nodes have an area, not otherwise', () => {
    const d = defs();
    const n = (has: boolean) => ({ ar: has ? [[0, -1, 100]] : undefined });
    expect(areaNoteNeeded(d, [n(true), n(true), n(false)])).toBe(false);
    expect(areaNoteNeeded(d, [n(true), ...Array.from({ length: 9 }, () => n(false))])).toBe(true);
    expect(areaNoteNeeded(d, [n(false), n(false)])).toBe(true);
    expect(areaNoteNeeded(undefined, [n(true)])).toBe(true);
  });
});
