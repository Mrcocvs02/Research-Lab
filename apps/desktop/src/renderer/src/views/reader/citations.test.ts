import { describe, expect, it } from 'vitest';
import type { RefEntry } from '@rl/core';
import { entryFor, mentionAt, mentionsIn } from './citations';

const entry = (n: number, surname: string | null, year: number | null): RefEntry => ({ n, text: '', surname, year, work: null, docId: null });

describe('citation mentions', () => {
  it('reads each number of a bracket group', () => {
    expect(mentionsIn('as shown [3, 5]').map((m) => (m.kind === 'num' ? m.n : 0))).toEqual([3, 5]);
  });
  it('reads author-year mentions', () => {
    expect(mentionsIn('see Rossi et al. (2019)')[0]).toMatchObject({ kind: 'ay', surname: 'rossi', year: 2019 });
  });
  it('finds the mention under an offset, and none elsewhere', () => {
    const text = 'results [12] hold';
    expect(mentionAt(text, 9)).toMatchObject({ kind: 'num', n: 12 });
    expect(mentionAt(text, 0)).toBeNull();
  });
  it('matches entries by number, or by surname and year together', () => {
    const items = [entry(1, 'rossi', 2019), entry(2, 'rossi', 2020)];
    expect(entryFor({ kind: 'num', n: 2, start: 0, end: 1 }, items)?.n).toBe(2);
    expect(entryFor({ kind: 'ay', surname: 'rossi', year: 2020, start: 0, end: 1 }, items)?.n).toBe(2);
    expect(entryFor({ kind: 'ay', surname: 'bianchi', year: 2020, start: 0, end: 1 }, items)).toBeNull();
  });
});
