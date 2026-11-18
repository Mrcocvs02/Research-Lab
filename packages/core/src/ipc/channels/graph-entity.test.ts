import { describe, expect, it } from 'vitest';
import { channels } from './index.js';

const entity = channels['graph:entityNetwork'];

describe('graph:entityNetwork contract', () => {
  it('fills in the defaults of the design and limits the request', () => {
    expect(entity.request.parse({ mode: 'author' })).toEqual({ mode: 'author', minDocs: 2, minWeight: 0, limit: 800 });
    expect(entity.request.safeParse({ mode: 'doc' }).success).toBe(false);
    expect(entity.request.safeParse({ mode: 'tag', limit: 801 }).success).toBe(false);
    expect(entity.request.safeParse({ mode: 'topic', level: 1, years: [2000, 2020], scope: { folder: 'a/b' } }).success).toBe(true);
  });

  it('describes nodes with ten year bins, edges, the cap and the year range', () => {
    const ok = {
      nodes: [{ id: 'author:a b', label: 'A B', count: 3, years: new Array(10).fill(0), colorKey: 'c0.1', group: '', variants: ['A B', 'Anna B'] }],
      edges: [{ a: 'x', b: 'y', w: 0.5, n: 2, implies: true }],
      total: 1,
      truncated: false,
      yearRange: [2000, 2020],
      documents: 3,
    };
    expect(entity.response.safeParse(ok).success).toBe(true);
    expect(entity.response.safeParse({ ...ok, nodes: [{ ...ok.nodes[0], years: [1, 2] }] }).success).toBe(false);
  });

  it('has the author correction channels', () => {
    expect(channels['graph:editAuthorAliases'].request.safeParse({ action: 'merge', from: 'a b', to: 'c d' }).success).toBe(true);
    expect(channels['graph:editAuthorAliases'].request.safeParse({ action: 'split', key: '' }).success).toBe(false);
    expect(channels['graph:editAuthorAliases'].response.safeParse({ merge: { a: 'b' }, split: ['c'] }).success).toBe(true);
  });

  it('accepts the topic filter of the Library', () => {
    expect(channels['search:query'].request.safeParse({ text: '', filters: { topic: 'c0.1' } }).success).toBe(true);
  });
});
