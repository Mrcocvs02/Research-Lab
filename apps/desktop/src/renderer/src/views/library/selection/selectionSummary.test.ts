import { describe, expect, it } from 'vitest';
import { commonFolder, summarizeSelection, type SummaryRow } from './summaryModel';

const row = (over: Partial<SummaryRow> = {}): SummaryRow => ({ authors: [], year: null, type: null, path: 'a/x.pdf', studyState: 'to-read', tags: [], directTags: [], ...over });

describe('commonFolder', () => {
  it('is the deepest shared folder, with either separator', () => {
    expect(commonFolder(['a/b/c/x.pdf', String.raw`a\b\d\y.pdf`, 'a/b/z.pdf'])).toBe('a/b');
    expect(commonFolder(['a/x.pdf', 'b/y.pdf'])).toBe('');
    expect(commonFolder(['a/b/x.pdf'])).toBe('a/b');
    expect(commonFolder([])).toBe('');
  });
});

describe('summarizeSelection', () => {
  it('shows a field whole only when it is the same everywhere', () => {
    const s = summarizeSelection([row({ type: 'article' }), row({ type: 'article' })]);
    expect(s.type.same).toBe('article');
    const m = summarizeSelection([row({ type: 'article' }), row({ type: 'article' }), row({ type: 'thesis' })]);
    expect(m.type.same).toBeNull();
    expect(m.type.values).toEqual([{ value: 'article', n: 2 }, { value: 'thesis', n: 1 }]);
  });

  it('gives the range of years and the authors in common', () => {
    const s = summarizeSelection([row({ year: 2017, authors: ['Ada', 'Bo'] }), row({ year: 2025, authors: ['Bo', 'Cy'] }), row({ year: null, authors: ['Bo'] })]);
    expect(s.years).toEqual({ min: 2017, max: 2025 });
    expect(s.authors).toEqual(['Bo']);
    expect(summarizeSelection([row(), row()]).years).toBeNull();
  });

  it('counts the reading states', () => {
    const s = summarizeSelection([row({ studyState: 'read' }), row(), row(), row({ studyState: 'read' }), row()]);
    expect(s.status).toEqual([{ state: 'to-read', n: 3 }, { state: 'read', n: 2 }]);
  });

  it('splits tags into those on all and those on some, by hand only', () => {
    const rows = [
      row({ directTags: ['a', 'b'], tags: ['a', 'b', 'implied'] }),
      row({ directTags: ['a', 'b', 'c'], tags: ['a', 'b', 'c', 'implied'] }),
      row({ directTags: ['a'], tags: ['a', 'implied'] }),
    ];
    const s = summarizeSelection(rows);
    expect(s.tagsAll).toEqual(['a']);
    expect(s.tagsSome).toEqual([{ value: 'b', n: 2 }, { value: 'c', n: 1 }]);
  });

  it('handles an empty selection', () => {
    const s = summarizeSelection([]);
    expect(s).toMatchObject({ total: 0, years: null, authors: [], folder: '', status: [], tagsAll: [], tagsSome: [] });
  });
});
