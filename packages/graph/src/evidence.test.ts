import { describe, expect, it } from 'vitest';
import { MAX_STEPS, buildEvidence, findPath, pairEvidence, similarityThreshold, topWeights, type EvidenceInput } from './evidence.js';

const none: EvidenceInput = { similar: [], cites: [], links: [] };

describe('similarityThreshold', () => {
  const ws = topWeights([Array.from({ length: 20 }, (_, i) => (i + 1) / 40)]);
  it('is 0.25 for fewer than 8 papers', () => {
    expect(similarityThreshold(ws, 'normal', 7)).toBe(0.25);
    expect(similarityThreshold([], 'normal', 50)).toBe(0.25);
  });
  it('reads P75 / P90 / P50 and clamps', () => {
    const t = (s: 'strict' | 'normal' | 'wide') => similarityThreshold(ws, s, 20);
    expect(t('wide')).toBeLessThan(t('normal'));
    expect(t('normal')).toBeLessThan(t('strict'));
    expect(similarityThreshold([0.9, 0.95, 0.99], 'normal', 20)).toBe(0.5);
    expect(similarityThreshold([0.01, 0.02], 'normal', 20)).toBe(0.15);
    expect(similarityThreshold([0.01, 0.02], 'wide', 20)).toBe(0.1);
    expect(similarityThreshold([0.9], 'strict', 20)).toBe(0.6);
  });
  it('only counts the 10 heaviest neighbours of each paper', () => {
    const w = topWeights([[...Array.from({ length: 30 }, () => 0.01), ...Array.from({ length: 10 }, () => 0.4)]]);
    expect(w.length).toBe(10);
    expect(w[0]).toBe(0.4);
  });
});

describe('pairEvidence', () => {
  it('sums the proofs of a pair capped at 1 and keeps every kind', () => {
    const [e] = pairEvidence({ similar: [{ a: 'b', b: 'a', w: 0.4 }], cites: [['a', 'b']], links: [['b', 'a']] }, 0.2);
    expect(e).toMatchObject({ a: 'a', b: 'b', e: 1, kinds: ['cites', 'linked', 'similar'], w: 0.4 });
  });
  it('never draws similarity under the cut, but explicit evidence stays', () => {
    const out = pairEvidence({ similar: [{ a: 'a', b: 'b', w: 0.19 }, { a: 'a', b: 'c', w: 0.2 }], cites: [['b', 'c']], links: [] }, 0.2);
    expect(out.map((e) => `${e.a}${e.b}`).sort()).toEqual(['ac', 'bc']);
  });
});

describe('buildEvidence', () => {
  it('lets each paper pick its k strongest, explicit first at equal score', () => {
    const similar = Array.from({ length: 9 }, (_, i) => ({ a: 'hub', b: `s${i}`, w: 1 - i * 0.01 }));
    const out = buildEvidence({ similar, cites: [['hub', 'x']], links: [] }, 0.1, 5);
    const hub = out.filter((e) => e.a === 'hub' || e.b === 'hub');
    // the leaves each have room for their one edge, so the hub keeps its 5 strongest through its own list and the rest through theirs
    expect(out.length).toBeLessThanOrEqual(5 * 11);
    expect(hub.some((e) => e.kinds.includes('cites'))).toBe(true);
    const own = buildEvidence({ similar, cites: [['hub', 'x']], links: [] }, 0.1, 1);
    expect(own.some((e) => e.kinds.includes('cites'))).toBe(true);
  });
  it('stays under 5 x papers and never goes below tau for similarity', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `d${i}`);
    const similar = ids.flatMap((a, i) => ids.slice(i + 1).map((b, j) => ({ a, b, w: 0.1 + ((i * 7 + j) % 40) / 100 })));
    const out = buildEvidence({ ...none, similar }, 0.2);
    expect(out.length).toBeLessThanOrEqual(5 * ids.length);
    expect(out.every((e) => (e.w ?? 1) >= 0.2)).toBe(true);
  });
  it('on a tie puts the explicit pair before the similar one', () => {
    const out = buildEvidence({ similar: [{ a: 'a', b: 'b', w: 1 }], cites: [['a', 'c']], links: [] }, 0.1, 1);
    expect(out.find((e) => e.a === 'a' && e.b === 'c')).toBeDefined();
  });
});

describe('findPath', () => {
  const input: EvidenceInput = {
    similar: [{ a: 'a', b: 'b', w: 0.5 }, { a: 'b', b: 'c', w: 0.5 }, { a: 'a', b: 'c', w: 0.1 }, { a: 'c', b: 'd', w: 0.3 }],
    cites: [],
    links: [['d', 'e']],
  };
  it('finds the cheapest chain and uses 0.75 tau as the floor of similarity', () => {
    // tau 0.4: floor 0.3. a-c (0.1) is under it, c-d (0.3) is at it.
    const steps = findPath(input, 0.4, 'a', 'e');
    expect(steps.map((s) => `${s.a}${s.b}`)).toEqual(['ab', 'bc', 'cd', 'de']);
  });
  it('is empty when the floor cuts the only bridge, or when it has too many steps', () => {
    expect(findPath(input, 0.6, 'a', 'e')).toEqual([]);
    const chain: EvidenceInput = { ...none, links: Array.from({ length: MAX_STEPS + 1 }, (_, i) => [`n${i}`, `n${i + 1}`] as const) };
    expect(findPath(chain, 0.3, 'n0', `n${MAX_STEPS + 1}`)).toEqual([]);
    expect(findPath(chain, 0.3, 'n0', `n${MAX_STEPS}`).length).toBe(MAX_STEPS);
  });
  it('prefers one strong step to two weak ones', () => {
    const direct: EvidenceInput = { similar: [{ a: 'a', b: 'c', w: 0.9 }, { a: 'a', b: 'b', w: 0.5 }, { a: 'b', b: 'c', w: 0.5 }], cites: [], links: [] };
    expect(findPath(direct, 0.2, 'a', 'c').length).toBe(1);
  });
  it('gives nothing for the same paper or an unknown one', () => {
    expect(findPath(input, 0.4, 'a', 'a')).toEqual([]);
    expect(findPath(input, 0.4, 'a', 'zz')).toEqual([]);
  });
});
