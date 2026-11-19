import { describe, expect, it } from 'vitest';
import { resolveIncomingLabels } from './tag-resolve.js';
import { node } from './tag-test-corpus.js';

const vocab = [node('Alfa beta gamma (ABC)', { aliases: ['alfa_beta_gamma'] }), node('Concetto'), node('2x'), node('Gamma model'), node('Old', { status: 'deprecated' }), node('Aa', { id: 'grp:aa' })];

describe('resolveIncomingLabels (the sure rules only)', () => {
  it('exact names and aliases match without a new alias', () => {
    const r = resolveIncomingLabels(['concetto', 'alfa_beta_gamma', 'Alfa beta gamma (ABC)'], vocab);
    expect(r.matched).toEqual({ concetto: 'concetto', alfa_beta_gamma: 'alfa-beta-gamma-abc', 'Alfa beta gamma (ABC)': 'alfa-beta-gamma-abc' });
    expect(r.aliasAdds).toEqual([]);
    expect(r.fresh).toEqual([]);
  });
  it('R1 form, R2 plural, R3 acronym: matched, the new spelling becomes an alias', () => {
    const r = resolveIncomingLabels(['2-x', 'Concetti', 'Gamma models', 'ABC', 'Alfa beta gamma'], vocab);
    expect(r.matched).toEqual({ '2-x': '2x', Concetti: 'concetto', 'Gamma models': 'gamma-model', ABC: 'alfa-beta-gamma-abc', 'Alfa beta gamma': 'alfa-beta-gamma-abc' });
    expect(r.aliasAdds.map((a) => a.alias).sort()).toEqual(['2-x', 'ABC', 'Concetti', 'Gamma models']);
    expect(r.fresh).toEqual([]);
  });
  it('uncertain rules are not applied: spelling, digits, other words', () => {
    const r = resolveIncomingLabels(['3x', 'Gama model', 'Something else'], vocab);
    expect(r.matched).toEqual({});
    expect(r.fresh).toEqual(['3x', 'Gama model', 'Something else']);
  });
  it('deprecated and derived nodes are never targets; duplicates are listed once', () => {
    const r = resolveIncomingLabels(['Old', 'grp:aa', 'new tag', 'New_tag'], vocab);
    expect(r.matched).toEqual({});
    expect(r.fresh).toEqual(['Old', 'grp:aa', 'new tag']);
  });
});
