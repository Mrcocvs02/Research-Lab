import { describe, expect, it } from 'vitest';
import type { EvEdge } from './edges';
import { nextToRead } from './reading';

const sim = (a: string, b: string, e: number): EvEdge => ({ a, b, e, kinds: ['similar'], w: e });
const cites = (a: string, b: string): EvEdge => ({ a, b, e: 1, kinds: ['cites'] });
const linked = (a: string, b: string): EvEdge => ({ a, b, e: 1, kinds: ['linked'] });
const read = (...ids: string[]) => new Map<string, 1 | 2>(ids.map((i) => [i, 2]));

describe('next to read: from a paper', () => {
  it('takes the unread neighbour with the strongest evidence, and skips the ones already read', () => {
    const edges = [sim('a', 'b', 0.4), sim('a', 'c', 0.9), cites('a', 'd'), sim('a', 'e', 0.7)];
    expect(nextToRead(edges, read('d'), ['a'])?.id).toBe('c');
    expect(nextToRead(edges, read(), ['a'])?.id).toBe('d');
  });

  it('counts a paper in studio as unread', () => {
    const edges = [sim('a', 'b', 0.9), sim('a', 'c', 0.4)];
    expect(nextToRead(edges, new Map([['b', 1]]), ['a'])?.id).toBe('b');
  });

  it('breaks a tie by explicit evidence, then by the block of the start, then by the id', () => {
    expect(nextToRead([sim('a', 'b', 1), linked('a', 'c')], read(), ['a'])?.id).toBe('c');
    const blockOf = (id: string) => (id === 'a' || id === 'z' ? 'X' : 'Y');
    expect(nextToRead([sim('a', 'b', 0.8), sim('a', 'z', 0.8)], read(), ['a'], { blockOf })?.id).toBe('z');
    expect(nextToRead([sim('a', 'q', 0.8), sim('a', 'b', 0.8)], read(), ['a'])?.id).toBe('b');
  });

  it('explains the pick: the tie to the start and the strongest tie to a paper already read', () => {
    const edges = [sim('a', 'c', 0.42), cites('c', 'x')];
    const pick = nextToRead(edges, read('x'), ['a'])!;
    expect(pick).toMatchObject({ id: 'c', step: 1, from: { id: 'a', kind: 'similar', e: 0.42 }, read: { id: 'x', kind: 'cites' } });
  });

  it('works from a selection: the union of their edges, never a paper of the selection', () => {
    const edges = [sim('a', 'b', 0.99), sim('a', 'c', 0.5), sim('b', 'd', 0.6)];
    expect(nextToRead(edges, read(), ['a', 'b'])?.id).toBe('d');
  });

  it('goes two steps when every direct neighbour is read, scoring e1 * e2', () => {
    const edges = [sim('a', 'm', 0.8), sim('a', 'n', 0.5), sim('m', 'c', 0.5), sim('n', 'd', 0.9)];
    const pick = nextToRead(edges, read('m', 'n'), ['a'])!;
    expect(pick).toMatchObject({ id: 'd', step: 2, via: 'n' });
    expect(nextToRead([sim('a', 'm', 0.8), sim('m', 'c', 0.5), sim('m', 'd', 0.6)], read('m'), ['a'])?.id).toBe('d');
  });

  it('says there is nothing when no unread paper is within two steps', () => {
    expect(nextToRead([sim('a', 'b', 0.8), sim('b', 'c', 0.8)], read('b', 'c'), ['a'])).toBeNull();
    expect(nextToRead([], read(), ['a'])).toBeNull();
  });
});

describe('next to read: with no start', () => {
  const ids = ['r', 'u1', 'u2', 'u3'];
  it('takes the unread paper most tied to what was read', () => {
    const edges = [sim('r', 'u1', 0.4), sim('r', 'u2', 0.9), sim('u1', 'u3', 0.95)];
    expect(nextToRead(edges, read('r'), null, { ids })?.id).toBe('u2');
  });

  it('with nothing read, or nothing tied to it, takes the most central one (evidence degree, then centrality, then id)', () => {
    const edges = [sim('u1', 'u2', 0.5), sim('u1', 'u3', 0.5)];
    expect(nextToRead(edges, read(), null, { ids })?.id).toBe('u1');
    expect(nextToRead([sim('u1', 'u2', 0.5)], read(), null, { ids, central: (id) => (id === 'u2' ? 5 : 0) })?.id).toBe('u2');
    expect(nextToRead([], read(), null, { ids })?.id).toBe('r');
  });

  it('returns null when every paper is read', () => {
    expect(nextToRead([sim('r', 'u1', 0.5)], read('r', 'u1'), null, { ids: ['r', 'u1'] })).toBeNull();
  });

  it('is deterministic', () => {
    const edges = [sim('a', 'b', 0.5), sim('a', 'c', 0.5), sim('b', 'c', 0.5)];
    const a = nextToRead(edges, read(), null, { ids: ['c', 'b', 'a'] });
    const b = nextToRead([...edges].reverse(), read(), null, { ids: ['a', 'b', 'c'] });
    expect(a?.id).toBe(b?.id);
  });
});
