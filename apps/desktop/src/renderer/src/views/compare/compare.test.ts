import { describe, expect, it } from 'vitest';
import type { CompareCell, CompareRow } from '@rl/core';
import { addColumn, cellState, defaultColumns, editCell, hasStar, missingCells, pruneRows } from './model';

const claude: CompareCell = { text: 'x', pages: [2], source: 'claude', ai: true };
const rows: CompareRow[] = [{ docId: 'a', label: 'A', cells: { problem: claude, method: { text: 'm', pages: [], source: 'note', ai: false } } }];

describe('compare model', () => {
  it('starts from the five columns of the literature template', () => {
    expect(defaultColumns((k) => k).map((c) => c.id)).toEqual(['problem', 'method', 'data', 'results', 'limits']);
  });
  it('adds a free column with a safe unique id, and stops at the limit', () => {
    const cols = defaultColumns((k) => k);
    const c = addColumn(cols, ' Dimensione del campione ')!;
    expect(c).toMatchObject({ name: 'Dimensione del campione', key: null, id: 'c-dimensione-del-campione' });
    expect(addColumn([...cols, c], 'dimensione del campione')!.id).toBe('c-dimensione-del-campione-2');
    expect(addColumn(cols, '  ')).toBeNull();
    expect(addColumn(Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, name: 'n', key: null })), 'x')).toBeNull();
  });
  it('shows the star only on what Claude wrote', () => {
    expect(hasStar(cellState(claude, false))).toBe(true);
    expect(hasStar(cellState(rows[0]!.cells['method'], false))).toBe(false);
    expect(cellState(undefined, true)).toBe('writing');
    expect(cellState(undefined, false)).toBe('waiting');
    expect(cellState({ text: '', pages: [], source: 'none', ai: false, why: 'not-enabled' }, false)).toBe('not-enabled');
  });
  it("makes an edited cell the user's, without the star, and an emptied one waits again", () => {
    const e = editCell(rows, 'a', 'problem', ' mine ');
    expect(e[0]!.cells['problem']).toEqual({ text: 'mine', pages: [2], source: 'user', ai: false });
    expect(cellState(e[0]!.cells['problem'], false)).toBe('user');
    expect(editCell(rows, 'a', 'problem', '')[0]!.cells['problem']).toBeUndefined();
  });
  it('counts the empty cells and drops those of a removed column', () => {
    const cols = defaultColumns((k) => k);
    expect(missingCells(rows, cols)).toBe(3);
    expect(Object.keys(pruneRows(rows, cols.filter((c) => c.id !== 'method'))[0]!.cells)).toEqual(['problem']);
  });
});
