import { describe, expect, it } from 'vitest';
import type { TaxonomyNodeView } from '@rl/core';
import { buildModel, familyOps, tagFamilies } from './taxonomyModel';

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

describe('tag families (D-491)', () => {
  const nodes = [node('a', { group: 'extra:Metodo' }), node('b', { group: 'extra:Metodo' }), node('c', { group: 'extra:Sistema' }), node('d', { group: 'macro' }), node('e', { group: 'extra:Metodo', status: 'deprecated' }), node('f')];
  it('lists the user families with their live members', () => {
    expect(tagFamilies(nodes)).toEqual([
      { name: 'Metodo', members: ['a', 'b'] },
      { name: 'Sistema', members: ['c'] },
    ]);
  });
  it('builds the operations that move tags in, rename and clear, skipping no-ops', () => {
    const m = buildModel(nodes);
    expect(familyOps(m, ['a', 'f', 'zz'], 'Metodo')).toEqual([{ op: 'setGroup', id: 'f', group: 'extra:Metodo' }]);
    expect(familyOps(m, ['a', 'b'], ' Tecnica ')).toEqual([
      { op: 'setGroup', id: 'a', group: 'extra:Tecnica' },
      { op: 'setGroup', id: 'b', group: 'extra:Tecnica' },
    ]);
    expect(familyOps(m, ['a', 'f'], null)).toEqual([{ op: 'setGroup', id: 'a', group: null }]);
  });
});
