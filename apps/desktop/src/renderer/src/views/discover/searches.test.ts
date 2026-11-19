import { describe, expect, it } from 'vitest';
import { discoverReasonSchema } from '@rl/core';
import en from '../../i18n/locales/parts/en/discover.json';
import it_ from '../../i18n/locales/parts/it/discover.json';
import { bridgePath, strengthDots } from '../network/BridgePath';

describe('bridge path and strength', () => {
  it('draws A, the bridge as a ghost node outside the library, then B, joined by two dashed edges', () => {
    const p = bridgePath({ docId: 'a'.repeat(16), title: 'A' }, { key: 'W7', title: null }, { docId: 'b'.repeat(16), title: 'B' });
    expect(p.nodes.map((n) => n.kind)).toEqual(['doc', 'ghost', 'doc']);
    expect(p.nodes[1]!.id).toBe('ghost:W7');
    expect(p.edges).toEqual([[0, 1], [1, 2]]);
    expect(p.dashed).toBe(true);
  });

  it('shows one to four dots', () => {
    expect([0, 0.1, 0.25, 0.26, 0.5, 0.74, 0.75, 1].map(strengthDots)).toEqual([1, 1, 1, 2, 2, 3, 3, 4]);
  });
});

describe('texts of the searches', () => {
  it('has a reason in both languages for every reason code, and the same keys in both', () => {
    const codes = discoverReasonSchema.shape.code.options;
    for (const dict of [en, it_]) for (const c of codes) expect((dict.discover.searches as Record<string, string>)[`reason_${c}`]).toBeTruthy();
    const keys = (o: unknown, p = ''): string[] => Object.entries(o as object).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
    expect(keys(it_).sort()).toEqual(keys(en).sort());
  });
});
