import { describe, expect, it } from 'vitest';
import type { TagProposal } from '@rl/core';
import { applyItem, countByKind, filterProposals, keepOptions, moveIndex, paperTotal, proposalsFor, sortProposals, sureOnes, uncertainCount } from './tagReviewModel';

const p = (id: string, over: Partial<TagProposal> = {}): TagProposal => ({
  id,
  kind: 'merge',
  tags: ['a', 'b'],
  confidence: 'sure',
  reason: 'form',
  evidence: { papers: { a: 3, b: 2 }, shared: 1, jaccard: 0.2 },
  ...over,
});

describe('review list model', () => {
  it('sorts by confidence, folding the rows Claude called different', () => {
    const list = [p('m', { confidence: 'maybe' }), p('d', { confidence: 'likely', ai: { verdict: 'different', note: '' } }), p('s'), p('l', { confidence: 'likely' })];
    expect(sortProposals(list).map((x) => x.id)).toEqual(['s', 'l', 'm', 'd']);
  });
  it('filters by kind and counts them', () => {
    const list = [p('1'), p('2', { kind: 'twins' }), p('3', { kind: 'name' })];
    expect(filterProposals(list, new Set()).length).toBe(3);
    expect(filterProposals(list, new Set(['twins', 'name'] as const)).map((x) => x.id)).toEqual(['2', '3']);
    expect(countByKind(list)).toEqual({ merge: 1, twins: 1, parent: 0, name: 1, metadata: 0 });
  });
  it('takes the sure merges and renames only', () => {
    const list = [p('1'), p('2', { kind: 'twins' }), p('3', { kind: 'name' }), p('4', { confidence: 'likely' }), p('5', { kind: 'metadata' })];
    expect(sureOnes(list).map((x) => x.id)).toEqual(['1', '3']);
  });
  it('counts the uncertain rows not yet asked about', () => {
    expect(uncertainCount([p('1', { confidence: 'maybe' }), p('2', { confidence: 'likely', ai: { verdict: 'same', note: '' } }), p('3'), p('4', { confidence: 'maybe', kind: 'twins' })])).toBe(1);
  });
  it('builds the apply item with the chosen survivor, label and twins action', () => {
    expect(applyItem(p('1', { keep: 'a' }), { keep: 'b', label: ' X ' })).toEqual({ id: '1', keep: 'b', label: 'X' });
    expect(applyItem(p('1', { keep: 'a', label: 'X' }), { label: 'X' })).toEqual({ id: '1', keep: 'a' });
    expect(applyItem(p('2', { kind: 'twins', action: 'keywords' }), undefined)).toEqual({ id: '2', action: 'keywords' });
    expect(applyItem(p('2', { kind: 'twins', action: 'keywords' }), { action: 'merge' })).toEqual({ id: '2', action: 'merge' });
  });
  it('totals papers and lists survivors with the proposed one first', () => {
    expect(paperTotal(p('1'))).toBe(4);
    expect(keepOptions(p('1', { keep: 'b' }))).toEqual(['b', 'a']);
    expect(keepOptions(p('1'))).toEqual(['a', 'b']);
  });
  it('moves the row focus within bounds', () => {
    expect(moveIndex(0, 'ArrowUp', 3)).toBe(0);
    expect(moveIndex(1, 'ArrowDown', 3)).toBe(2);
    expect(moveIndex(2, 'ArrowDown', 3)).toBe(2);
    expect(moveIndex(1, 'End', 3)).toBe(2);
    expect(moveIndex(0, 'ArrowDown', 0)).toBe(-1);
  });
  it('finds the rows that touch a tag', () => {
    expect(proposalsFor([p('1'), p('2', { tags: ['c', 'd'] }), p('3', { kind: 'parent' })], 'a').map((x) => x.id)).toEqual(['1']);
  });
});
