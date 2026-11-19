import { describe, expect, it } from 'vitest';
import { buildVocabTree, layoutVocab, MAX_VOCAB_NODES, type VocabSource } from './vocabTree';

const src = (id: string, parents: string[], subtree: number): VocabSource => ({ id, label: id.toUpperCase(), parents, subtree });

describe('buildVocabTree', () => {
  const nodes = [src('a', [], 10), src('b', [], 5), src('a1', ['a'], 6), src('a2', ['a'], 3), src('b1', ['b'], 4), src('a1x', ['a1'], 2), src('empty', ['a'], 0)];
  const roots = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];

  it('shows levels 1 and 2, biggest first, and leaves out nodes without papers', () => {
    const t = buildVocabTree(roots, nodes);
    expect(t.map((r) => r.id)).toEqual(['a', 'b']);
    expect(t[0]!.children.map((c) => c.id)).toEqual(['a1', 'a2']);
    expect(t[0]!.children[0]!.more).toBe(1);
    expect(t[0]!.children[0]!.children).toHaveLength(0);
  });

  it('opens level 3 on the node asked for', () => {
    const t = buildVocabTree(roots, nodes, new Set(['a1']));
    expect(t[0]!.children[0]!.children.map((c) => c.id)).toEqual(['a1x']);
    expect(t[0]!.children[0]!.children[0]!.depth).toBe(3);
  });

  it('holds at most 40 nodes in view and counts the rest in "+N", sharing the room between parents', () => {
    const many = [src('p', [], 500), src('q', [], 400)];
    for (let i = 0; i < 60; i++) many.push(src(`p${i}`, ['p'], 60 - i), src(`q${i}`, ['q'], 30 - (i % 30)));
    const t = buildVocabTree([{ id: 'p', label: 'P' }, { id: 'q', label: 'Q' }], many);
    const total = t.length + t.reduce((n, r) => n + r.children.length, 0);
    expect(total).toBe(MAX_VOCAB_NODES);
    expect(Math.abs(t[0]!.children.length - t[1]!.children.length)).toBeLessThanOrEqual(1);
    expect(t[0]!.more).toBe(60 - t[0]!.children.length);
  });
});

describe('layoutVocab', () => {
  it('gives each leaf its own row, centres a parent on its children and puts depth in columns', () => {
    const tree = buildVocabTree([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], [src('a', [], 9), src('b', [], 4), src('a1', ['a'], 5), src('a2', ['a'], 4), src('a3', ['a'], 1)]);
    const { placed, rows } = layoutVocab(tree);
    const at = (id: string) => placed.find((p) => p.node.id === id)!;
    expect(rows).toBe(4);
    expect([at('a1').row, at('a2').row, at('a3').row, at('b').row]).toEqual([0, 1, 2, 3]);
    expect(at('a').row).toBe(1);
    expect(at('a1').col).toBe(1);
    expect(at('a').col).toBe(0);
    const leafRows = placed.filter((p) => p.node.children.length === 0).map((p) => p.row);
    expect(new Set(leafRows).size).toBe(leafRows.length);
  });

  it('reserves a row for a "+N" line', () => {
    const tree = buildVocabTree([{ id: 'a', label: 'A' }], [src('a', [], 9), src('a1', ['a'], 5), src('a2', ['a'], 4)], new Set(), 2);
    expect(tree[0]!.more).toBe(1);
    expect(layoutVocab(tree).rows).toBe(2);
  });
});
