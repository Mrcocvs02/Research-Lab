import { describe, expect, it } from 'vitest';
import { nameStyle, tagHealth, tagStats, type HealthItem, type HealthKind } from './tag-health.js';
import type { ReviewInput } from './tag-review.js';
import { corpus, node } from './tag-test-corpus.js';

const get = (h: HealthItem[], k: HealthKind): HealthItem => h.find((x) => x.kind === k) as HealthItem;
const docs = (tags: string[][]) => tags.map((t, i) => ({ id: `d${i}`, tags: t }));
const fam = (label: string, family: 'one' | 'many' | 'keywords') => node(label, { family });
const under = (label: string, ...parents: string[]) => node(label, { parents });
const health = (input: ReviewInput) => tagHealth(input);

describe('tag health, one check at a time', () => {
  it('singletons: more than 25 % of the tags (keywords excluded)', () => {
    const nodes = ['a1', 'b1', 'c1', 'd1'].map((l) => node(l));
    const flagged = get(health({ nodes, docs: docs([['a1'], ['b1'], ['c1', 'd1'], ['c1', 'd1']]) }), 'singletons');
    expect(flagged).toMatchObject({ count: 2, flagged: true });
    const calm = get(health({ nodes, docs: docs([['a1'], ['b1', 'c1', 'd1'], ['b1', 'c1', 'd1'], ['b1', 'c1', 'd1'], ['b1', 'c1', 'd1']]) }), 'singletons');
    expect(calm).toMatchObject({ count: 1, flagged: false });
    const kw = [fam('Keywords', 'keywords'), under('k1', 'keywords'), under('k2', 'keywords')];
    expect(get(health({ nodes: kw, docs: docs([['k1'], ['k2']]) }), 'singletons').count).toBe(0);
  });
  it('dupes: concepts with sure or likely proposals; twins: groups with the same papers', () => {
    const h = health({ nodes: [node('Concetto'), node('Concetti'), node('aa'), node('bb')], docs: docs([['aa', 'bb'], ['aa', 'bb']]) });
    expect(get(h, 'dupes')).toMatchObject({ count: 1, flagged: true });
    expect(get(h, 'twins')).toMatchObject({ count: 1, flagged: true });
    expect(get(health({ nodes: [node('One'), node('Different')], docs: [] }), 'dupes')).toMatchObject({ count: 0, flagged: false });
  });
  it('generic: a tag on more than half of the papers, only from 10 papers', () => {
    const many = Array.from({ length: 10 }, (_, i) => (i < 6 ? ['g'] : ['h']));
    expect(get(health({ nodes: [node('g'), node('h')], docs: docs(many) }), 'generic')).toMatchObject({ count: 1, flagged: true, ids: ['g'] });
    expect(get(health({ nodes: [node('g')], docs: docs([['g'], ['g'], ['g']]) }), 'generic').count).toBe(0);
  });
  it('orphans: tags outside every family', () => {
    const nodes = [fam('Topic', 'many'), under('In family', 'topic'), node('Loose')];
    expect(get(health({ nodes, docs: [] }), 'orphans')).toMatchObject({ count: 1, ids: ['loose'] });
  });
  it('multiparent: several parents', () => {
    const nodes = [fam('Topic', 'many'), under('A', 'topic'), under('B', 'topic'), under('Child', 'a', 'b')];
    expect(get(health({ nodes, docs: [] }), 'multiparent')).toMatchObject({ count: 1, flagged: true });
  });
  it('onevalue: papers with two values of a one-value family', () => {
    const nodes = [fam('Method', 'one'), under('M one', 'method'), under('M two', 'method'), under('M one sub', 'm-one')];
    const h = get(health({ nodes, docs: docs([['m-one', 'm-two'], ['m-one', 'm-one-sub'], ['m-two']]) }), 'onevalue');
    expect(h).toMatchObject({ count: 1, ids: ['d0'], flagged: true });
  });
  it('styles: different name styles', () => {
    expect(nameStyle('word_word')).toBe('underscore');
    expect(nameStyle('lower words')).toBe('lower');
    expect(nameStyle('Capital')).toBe('capitalized');
    expect(nameStyle('Long name (ABC)')).toBe('acronym');
    expect(get(health({ nodes: [node('Alpha'), node('beta gamma'), node('delta_eps')], docs: [] }), 'styles')).toMatchObject({ count: 3, flagged: true });
    expect(get(health({ nodes: [node('Alpha'), node('Beta')], docs: [] }), 'styles')).toMatchObject({ count: 1, flagged: false });
    // The convention's own "Extended name (ACR)" is not a second style (D-505).
    expect(get(health({ nodes: [node('Alpha'), node('Long name (ABC)')], docs: [] }), 'styles')).toMatchObject({ count: 1, flagged: false });
  });
  it('metadata: tags that are a venue or a publication status', () => {
    const h = health({ nodes: [node('preprint'), node('Fine')], docs: [] });
    expect(get(h, 'metadata')).toMatchObject({ count: 1, flagged: true });
  });
  it('unused: leaves on no paper; structure nodes are not unused', () => {
    const nodes = [fam('Topic', 'many'), under('Area', 'topic'), under('Leaf', 'area'), node('Used')];
    const h = get(health({ nodes, docs: docs([['used']]) }), 'unused');
    expect(h).toMatchObject({ count: 1, ids: ['leaf'], flagged: true });
  });
  it('depth: the largest many-family has depth under 2 and more than 12 values', () => {
    const flat = [fam('Topic', 'many'), ...Array.from({ length: 13 }, (_, i) => under(`v${i}`, 'topic'))];
    expect(get(health({ nodes: flat, docs: [] }), 'depth')).toMatchObject({ count: 1, flagged: true });
    const deep = [...flat, under('sub', 'v0')];
    expect(get(health({ nodes: deep, docs: [] }), 'depth')).toMatchObject({ count: 2, flagged: false });
    expect(get(health({ nodes: flat.slice(0, 5), docs: [] }), 'depth').flagged).toBe(false);
  });
  it('the corpus and its stats', () => {
    const c = corpus();
    const h = health(c);
    expect(get(h, 'dupes').flagged).toBe(true);
    expect(get(h, 'twins').flagged).toBe(true);
    const st = tagStats(c);
    expect(st.tags).toBe(c.nodes.length);
    expect(st.dupeConcepts).toBeGreaterThan(10);
  });
});
