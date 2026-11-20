import { describe, expect, it } from 'vitest';
import type { TagCleanupRow, TagRun } from '@rl/core';
import { appliedSteps, currentStep, docEdits, ghosts, ghostsByParent, rowsAcceptAll, rowsToApply, stepState, summaryLines } from './tagCleanupModel';

const run = (steps: TagRun['steps']): TagRun => ({ startedAt: null, steps, before: null, dismissed: 0 });
const s = (step: number, status: 'applied' | 'skipped' | 'undone') => ({ step, status, changeIds: [], at: '' });
const row = (id: string, over: Partial<TagCleanupRow> = {}): TagCleanupRow => ({
  id,
  step: 4,
  kind: 'place',
  tags: ['x'],
  checked: true,
  variant: 'default',
  variants: { default: { ops: [{ op: 'move', id: 'x', parents: ['topic'] }], docEdits: 0 } },
  ...over,
});

describe('cleanup run', () => {
  it('finds the current step and takes an undone step back to do', () => {
    expect(currentStep(run([]))).toBe(1);
    expect(currentStep(run([s(1, 'applied'), s(2, 'skipped')]))).toBe(3);
    expect(currentStep(run([s(1, 'applied'), s(2, 'applied'), s(2, 'undone')]))).toBe(2);
    expect(currentStep(run([1, 2, 3, 4, 5].map((n) => s(n, 'applied'))))).toBe(6);
  });
  it('reads the last state of a step and lists the applied ones', () => {
    const r = run([s(1, 'applied'), s(1, 'undone'), s(2, 'applied')]);
    expect(stepState(r, 1)).toBe('undone');
    expect(stepState(r, 3)).toBe('todo');
    expect(appliedSteps(r)).toEqual([2]);
  });
});

describe('cleanup rows', () => {
  it('sends the ticked rows, with a variant only when it is not the proposed one', () => {
    const rows = [row('a'), row('b', { checked: false }), row('c', { variants: { default: { ops: [], docEdits: 0 }, keywords: { ops: [], docEdits: 3 } } })];
    expect(rowsToApply(rows, {})).toEqual([{ id: 'a' }, { id: 'c' }]);
    expect(rowsToApply(rows, { b: { checked: true }, a: { checked: false }, c: { variant: 'keywords' } })).toEqual([{ id: 'b' }, { id: 'c', variant: 'keywords' }]);
    expect(rowsToApply(rows, { c: { variant: 'nope' } })).toEqual([{ id: 'a' }, { id: 'c' }]);
  });
  it('totals the documents the ticked rows edit', () => {
    const rows = [row('a', { variants: { default: { ops: [], docEdits: 2 } } }), row('b', { variants: { default: { ops: [], docEdits: 5 } } })];
    expect(docEdits(rows, { b: { checked: false } })).toBe(2);
  });
  it('builds the before/after table, with now as before when the run has no baseline', () => {
    const now = { tags: 100, singletons: 10, dupeConcepts: 0, orphans: 5, maxDepth: 3 };
    expect(summaryLines({ tags: 120, singletons: 30, dupeConcepts: 9, orphans: 80, maxDepth: 1 }, now)[0]).toEqual({ key: 'tags', before: 120, after: 100 });
    expect(summaryLines(null, now).every((l) => l.before === l.after)).toBe(true);
  });
  it('shows the ticked placements as ghost rows under their parent', () => {
    const rows = [
      row('a'),
      row('b', { checked: false }),
      row('c', { variants: { default: { ops: [{ op: 'setFamily', id: 'fam', family: 'one' }], docEdits: 0 } } }),
    ];
    const g = ghosts(rows, {});
    expect(g).toEqual([
      { rowId: 'a', tagId: 'x', parentId: 'topic', family: null },
      { rowId: 'c', tagId: 'fam', parentId: null, family: 'one' },
    ]);
    expect([...ghostsByParent(g).keys()]).toEqual(['topic', null]);
  });
});

describe('accept all in a step (D-512)', () => {
  it('a proposal row needs main to find it acceptable; other rows only must not be maybe; defaults only', () => {
    const rows = [row('p1', { confidence: 'sure' }), row('p2', { confidence: 'likely' }), row('f1'), row('f2', { confidence: 'maybe' })];
    const r = rowsAcceptAll(rows, new Set(['p1', 'p2']), new Set(['p1']));
    expect(r.rows).toEqual([{ id: 'p1' }, { id: 'f1' }]);
    expect([r.sure, r.likely]).toEqual([2, 0]);
  });
});
