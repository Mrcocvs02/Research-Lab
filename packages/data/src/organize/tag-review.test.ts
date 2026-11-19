import { describe, expect, it } from 'vitest';
import { buildIndex, chooseCanonical, conventionName, distance, reviewTags, type ReviewInput } from './tag-review.js';
import { corpus, DIFFERENT, idOf, node, TRUTH } from './tag-test-corpus.js';

const merges = (input: ReviewInput) => reviewTags(input).proposals.filter((p) => p.kind === 'merge');
const ids = (labels: string[]) => labels.map(idOf).sort();
const input = (labels: string[], docs: Array<{ id: string; tags: string[] }> = []): ReviewInput => ({ nodes: labels.map((l) => node(l)), docs });
const docsOf = (tags: string[][]) => tags.map((t, i) => ({ id: `d${i}`, tags: t }));

describe('rules R1-R6 in positive and negative', () => {
  it('R1 form: case, separators, accents', () => {
    const p = merges({ nodes: [node('2x'), node('2-x'), node('Café noir'), node('cafe_noir', { id: 'cafe-noir-b' })], docs: [] });
    expect(p.map((x) => x.tags)).toEqual(expect.arrayContaining([ids(['2x', '2-x']), ['cafe-noir', 'cafe-noir-b']]));
    expect(p.every((x) => x.confidence === 'sure')).toBe(true);
  });
  it('digits must coincide: 2x and 3x never', () => {
    expect(merges(input(['2x', '3x', 'model a', 'model b', 'alpha 1', 'alpha 2']))).toEqual([]);
  });
  it('R2 plural, English and Romance', () => {
    const p = merges(input(['concetto', 'concetti', 'study', 'studies', 'class', 'classes']));
    expect(p).toHaveLength(3);
    expect(p.every((x) => x.confidence === 'sure')).toBe(true);
    expect(merges(input(['cell', 'cello']))).toEqual([]);
  });
  it('R3 acronym in the name', () => {
    const p = merges(input(['ABC', 'Alfa beta gamma (ABC)', 'Unit (XYZ)', 'Unit']));
    expect(p.map((x) => x.tags)).toEqual(expect.arrayContaining([ids(['ABC', 'Alfa beta gamma (ABC)']), ids(['Unit (XYZ)', 'Unit'])]));
  });
  it('R4 sigla and expansion: likely, sure when they share a paper', () => {
    const labels = ['DEZ', 'Delta epsilon zeta'];
    expect(merges(input(labels))[0]?.confidence).toBe('likely');
    expect(merges(input(labels, [{ id: 'd1', tags: labels.map(idOf) }]))[0]?.confidence).toBe('sure');
    expect(merges(input(['DEZ', 'Delta epsilon eta']))).toEqual([]);
  });
  it('R5 spelling and regional pairs; short or one-letter differences are not', () => {
    const p = merges(input(['colour x', 'color x', 'organisation', 'organization', 'model a', 'model b', 'abcde', 'abcdf']));
    const sets = p.map((x) => x.tags.join('|'));
    expect(sets).toEqual(expect.arrayContaining([ids(['colour x', 'color x']).join('|'), ids(['organisation', 'organization']).join('|')]));
    expect(sets.some((s) => s.includes('model-a'))).toBe(false);
    expect(sets.some((s) => s.includes('abcde'))).toBe(false);
    expect(merges({ ...input(['colour x', 'color x']), docs: [{ id: 'd1', tags: ['colour-x', 'color-x'] }] })[0]?.confidence).toBe('likely');
    expect(merges(input(['colour x', 'color x']))[0]?.confidence).toBe('maybe');
  });
  it('R6 alias collision', () => {
    const p = merges({ nodes: [node('Alpha'), node('Beta', { aliases: ['alpha'] })], docs: [] });
    expect(p).toHaveLength(1);
    expect(p[0]?.reason).toContain('alias');
  });
});

describe('twins, inclusion, co-occurrence, metadata, names', () => {
  it('R7 twins: same papers; keywords by default from four tags or with no name link', () => {
    const labels = ['aa', 'bb', 'cc', 'dd', 'ee'];
    const p = reviewTags({ nodes: labels.map((l) => node(l)), docs: docsOf([labels, labels, ['aa']]) }).proposals.filter((x) => x.kind === 'twins');
    expect(p).toHaveLength(1);
    expect(p[0]?.action).toBe('keywords');
    const few = reviewTags({ nodes: ['aa', 'bb'].map((l) => node(l)), docs: docsOf([['aa', 'bb'], ['aa', 'bb']]) }).proposals.filter((x) => x.kind === 'twins');
    expect(few[0]?.action).toBe('keywords');
    const single = reviewTags({ nodes: ['aa', 'bb'].map((l) => node(l)), docs: docsOf([['aa', 'bb']]) }).proposals.filter((x) => x.kind === 'twins');
    expect(single).toEqual([]);
  });
  it('R8 inclusion: X and X methods', () => {
    const d = docsOf([['xtopic', 'xtopic-methods'], ['xtopic', 'xtopic-methods'], ['xtopic']]);
    const p = reviewTags({ nodes: [node('Xtopic'), node('Xtopic methods')], docs: d }).proposals.filter((x) => x.kind === 'parent');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ keep: 'xtopic', tags: ['xtopic', 'xtopic-methods'], confidence: 'likely' });
    expect(reviewTags({ nodes: [node('Unrelated one'), node('Other thing')], docs: [] }).proposals).toEqual([]);
  });
  it('R9 co-occurrence is a maybe', () => {
    const d = docsOf([['pp', 'qq', 'x1'], ['pp', 'qq', 'x2'], ['pp', 'qq', 'x3'], ['pp', 'qq'], ['pp', 'qq'], ['pp', 'x4']]);
    const p = reviewTags({ nodes: ['pp', 'qq', 'x1', 'x2', 'x3', 'x4'].map((l) => node(l)), docs: d }).proposals.filter((x) => x.reason === 'cooccurrence');
    expect(p).toHaveLength(1);
    expect(p[0]?.confidence).toBe('maybe');
  });
  it('metadata: venue names and status words', () => {
    const r = reviewTags({ nodes: [node('Journal of Things'), node('preprint'), node('Plain')], docs: [], venues: [{ id: 'v1', name: 'Journal of Things', aliases: [] }] });
    expect(r.proposals.filter((p) => p.kind === 'metadata').map((m) => m.meta)).toEqual(expect.arrayContaining([{ field: 'venue', value: 'v1' }, { field: 'status', value: 'preprint' }]));
  });
  it('names: underscores and lower case, sigla kept', () => {
    expect(conventionName('alfa_beta')).toBe('Alfa beta');
    expect(conventionName('ABC  protocol')).toBe('ABC protocol');
    const r = reviewTags({ nodes: [node('alfa_beta'), node('Fine name'), node('ABC')], docs: [] }).proposals.filter((p) => p.kind === 'name');
    expect(r.map((p) => p.label)).toEqual(['Alfa beta']);
  });
  it('deprecated, derived and distinct pairs are left out', () => {
    const base = [node('Concetto'), node('Concetti')];
    expect(merges({ nodes: base, docs: [] })).toHaveLength(1);
    expect(merges({ nodes: base, docs: [], distinct: [{ a: 'concetto', b: 'concetti' }] })).toEqual([]);
    expect(merges({ nodes: [node('Concetto'), node('Concetti', { status: 'deprecated' })], docs: [] })).toEqual([]);
    expect(merges({ nodes: [node('Aa', { id: 'grp:aa' }), node('AA', { id: 'grp:ab' })], docs: [] })).toEqual([]);
  });
});

describe('canonical choice', () => {
  const pick = (labels: string[], docs: Array<{ id: string; tags: string[] }> = []) => {
    const nodes = labels.map((l) => node(l));
    return chooseCanonical(buildIndex({ nodes, docs }), nodes.map((n) => n.id));
  };
  it('"Extended (ACR)" when there is a sigla and an expansion; built when missing', () => {
    expect(pick(['ABC', 'alfa_beta_gamma', 'Alfa beta gamma (ABC)']).keep).toBe('alfa-beta-gamma-abc');
    expect(pick(['ABC', 'alfa_beta_gamma'])).toEqual({ keep: 'alfa-beta-gamma', label: 'Alfa beta gamma (ABC)' });
  });
  it('else the one with more papers, then the singular', () => {
    expect(pick(['concetto', 'concetti'], [{ id: 'd', tags: ['concetti'] }]).keep).toBe('concetti');
    expect(pick(['gamma models', 'gamma model']).keep).toBe('gamma-model');
  });
  it('edit distance helper', () => {
    expect(distance('ab', 'ba', 1)).toBe(1);
    expect(distance('abcdef', 'abcxyz', 1)).toBeGreaterThan(1);
  });
});

describe('the synthetic corpus', () => {
  const r = reviewTags(corpus());
  const concepts = r.proposals.filter((p) => p.kind === 'merge' && p.confidence !== 'maybe');
  const groupOf = new Map<string, number>();
  TRUTH.forEach((g, i) => g.forEach((l) => groupOf.set(idOf(l), i)));

  it('precision of the sure rows >= 95 %', () => {
    const sure = r.proposals.filter((p) => p.kind === 'merge' && p.confidence === 'sure');
    expect(sure.length).toBeGreaterThan(0);
    const good = sure.filter((p) => groupOf.has(p.tags[0] as string) && new Set(p.tags.map((t) => groupOf.get(t))).size === 1);
    expect(good.length / sure.length).toBeGreaterThanOrEqual(0.95);
  });
  it('recall of the double concepts >= 90 %', () => {
    const found = TRUTH.filter((g) => concepts.some((p) => ids(g).every((t) => p.tags.includes(t))));
    expect(found.length / TRUTH.length).toBeGreaterThanOrEqual(0.9);
  });
  it('different tags are never merged', () => {
    for (const p of r.proposals.filter((x) => x.kind === 'merge')) for (const d of DIFFERENT) expect(p.tags).not.toContain(idOf(d));
  });
  it('twin block and parent pair are found', () => {
    expect(r.proposals.some((p) => p.kind === 'twins' && p.tags.includes('twin-a') && p.action === 'keywords')).toBe(true);
    expect(r.proposals.some((p) => p.kind === 'parent' && p.keep === 'xtopic')).toBe(true);
  });
  it('the ABC concept has the extended canonical; distinct is respected', () => {
    const abc = concepts.find((p) => p.tags.includes('abc'));
    expect(abc?.keep).toBe('alfa-beta-gamma-abc');
    expect(abc?.tags).toHaveLength(4);
    const first = TRUTH[0] as string[];
    const d = reviewTags({ ...corpus(), distinct: [{ a: idOf(first[0] as string), b: idOf(first[1] as string) }] });
    expect(d.proposals.some((p) => p.kind === 'merge' && p.tags.includes('concetto') && p.tags.includes('concetti'))).toBe(false);
  });
  it('is deterministic', () => {
    expect(reviewTags(corpus()).proposals.map((p) => p.id)).toEqual(r.proposals.map((p) => p.id));
  });
  it('5000 tags (measure only)', () => {
    const nodes = Array.from({ length: 5000 }, (_, i) => node(`word${i} thing${i % 97} item${i % 13}`, { id: `n${i}` }));
    const docs = Array.from({ length: 600 }, (_, i) => ({ id: `d${i}`, tags: [`n${(i * 7) % 5000}`, `n${(i * 13 + 1) % 5000}`, `n${(i * 31 + 2) % 5000}`] }));
    const t0 = performance.now();
    reviewTags({ nodes, docs });
    const ms = performance.now() - t0;
    console.log(`tag-review 5000 tags: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(15_000);
  });
});
