import { describe, expect, it } from 'vitest';
import type { TaxonomyNodeView } from '@rl/core';
import { buildModel } from './taxonomyModel';
import { oneFamilyRemoval, tagRowsOf } from './tagRows';
import { similarTag } from './tagSuggest';

const node = (id: string, label: string, parents: string[] = [], extra: Partial<TaxonomyNodeView> = {}): TaxonomyNodeView =>
  ({ id, label, parents, aliases: [], implies: [], status: 'active', origin: 'user', counts: { direct: 0, total: 0 }, ...extra }) as unknown as TaxonomyNodeView;

const model = buildModel([
  node('topic', 'Topic', [], { family: 'many' }),
  node('area', 'Area', ['topic']),
  node('method', 'Method', [], { family: 'one' }),
  node('m1', 'Survey', ['method']),
  node('m2', 'Experiment', ['method']),
  node('kw', 'Keywords', [], { family: 'keywords' }),
  node('k1', 'Alpha', ['kw']),
  node('loose', 'Misc'),
  node('abc', 'Alfa beta gamma (ABC)', [], { aliases: ['abcs'] }),
]);

describe('tag rows by family', () => {
  it('puts families first, loose tags next and keywords last', () => {
    const rows = tagRowsOf(model, ['k1', 'loose', 'm1', 'area']);
    expect(rows.map((r) => r.family)).toEqual(['Method', 'Topic', null, 'Keywords']);
    expect(rows[3]!.keywords).toBe(true);
  });
  it('replaces the value of a one-value family and leaves the others', () => {
    expect(oneFamilyRemoval(model, ['m1', 'area'], 'm2')).toEqual({ remove: ['m1'] });
    expect(oneFamilyRemoval(model, ['m1'], 'area')).toEqual({});
  });
  it('offers the existing tag when the typed name is a variant of it', () => {
    expect(similarTag(model, 'Surveys')).toEqual({ id: 'm1', label: 'Survey' });
    expect(similarTag(model, 'Method')).toBeNull(); // a family is not a tag
    expect(similarTag(model, 'misc')).toEqual({ id: 'loose', label: 'Misc' });
  });
});
