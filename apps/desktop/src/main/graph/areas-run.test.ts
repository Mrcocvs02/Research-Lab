import { describe, expect, it } from 'vitest';
import { topicNodes, withoutKeywords } from './areas-run.js';

const n = (id: string, parents: string[] = [], family?: 'one' | 'many' | 'keywords') => ({ id, parents, ...(family ? { family } : {}) });

describe('the nodes of the Topic areas (D-505, D-509)', () => {
  const nodes = [n('topic', [], 'many'), n('a', ['topic']), n('b', ['topic']), n('a1', ['a']), n('gen', [], 'many'), n('g1', ['gen']), n('kw', [], 'keywords'), n('k1', ['kw']), n('loose')];
  it('never holds keywords', () => {
    expect(withoutKeywords(nodes).map((x) => x.id)).not.toContain('k1');
  });
  it('with two families, only the biggest many-valued one (the others are offered by themselves)', () => {
    expect(topicNodes(nodes).map((x) => x.id).sort()).toEqual(['a', 'a1', 'b', 'loose', 'topic']);
  });
  it('with one family or none, everything but the keywords', () => {
    const one = nodes.filter((x) => x.id !== 'gen' && x.id !== 'g1');
    expect(topicNodes(one).map((x) => x.id).sort()).toEqual(['a', 'a1', 'b', 'loose', 'topic']);
  });
});
