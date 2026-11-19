import { describe, expect, it } from 'vitest';
import type { TaxonomyNodeView } from '@rl/core';
import { buildModel, placeTargets, treeSections } from '../taxonomyModel';

const node = (id: string, over: Partial<TaxonomyNodeView> = {}): TaxonomyNodeView => ({
  id,
  label: id,
  parents: [],
  aliases: [],
  implies: [],
  status: 'active',
  origin: 'user',
  counts: { direct: 0, implied: 0, subtree: 0 },
  ...over,
});

describe('tree sections of the vocabulary', () => {
  const nodes = [
    node('topic', { family: 'many' }),
    node('area', { parents: ['topic'] }),
    node('sub', { parents: ['area'] }),
    node('detail', { parents: ['sub'] }),
    node('method', { family: 'one' }),
    node('kw', { family: 'keywords' }),
    node('loose'),
    node('loose-child', { parents: ['loose'] }),
    node('old', { status: 'deprecated' }),
    node('both', { parents: ['loose', 'area'] }),
  ];
  const m = buildModel(nodes);
  it('splits families, keywords and the tags to sort', () => {
    const s = treeSections(m);
    expect(s.families).toEqual(['method', 'topic']);
    expect(s.keywords).toBe('kw');
    expect(s.unsortedRoots).toEqual(['loose']);
    expect(s.unsortedIds.sort()).toEqual(['loose', 'loose-child']);
  });
  it('lists the places a tag may go, to level 2, with keywords flat', () => {
    const t = placeTargets(m);
    expect(t.map((x) => x.path)).toEqual(['kw', 'method', 'topic', 'topic › area', 'topic › area › both', 'topic › area › sub']);
    expect(t.find((x) => x.id === 'sub')?.depth).toBe(2);
  });
});
