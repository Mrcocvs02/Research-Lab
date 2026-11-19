import { COMPARE_LIMITS, type CompareCell, type CompareColumn, type CompareRow } from '@rl/core';

/** The default columns come from the "Literature" template (§17.4.7): problem, method, data, results, limits. */
export const DEFAULT_KEYS = ['problem', 'method', 'data', 'results', 'limits'] as const;

export const defaultColumns = (name: (key: (typeof DEFAULT_KEYS)[number]) => string): CompareColumn[] => DEFAULT_KEYS.map((key) => ({ id: key, name: name(key), key }));

/** A free column name becomes a column; its id never clashes with the others. `null` when the name is empty or the table is full. */
export function addColumn(columns: readonly CompareColumn[], rawName: string): CompareColumn | null {
  const name = rawName.replace(/\s+/g, ' ').trim().slice(0, COMPARE_LIMITS.name);
  if (name === '' || columns.length >= COMPARE_LIMITS.columns) return null;
  const base = name.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'col';
  let id = `c-${base}`;
  for (let n = 2; columns.some((c) => c.id === id); n++) id = `c-${base}-${n}`;
  return { id, name, key: null };
}

/** What a cell shows: waiting (nothing yet), writing, ready by Claude (✦), from the note, edited by the user, or empty with the reason. */
export type CellState = 'waiting' | 'writing' | 'ai' | 'note' | 'user' | 'not-found' | 'not-enabled';

export function cellState(cell: CompareCell | undefined, writing: boolean): CellState {
  if (!cell) return writing ? 'writing' : 'waiting';
  if (cell.source === 'none') return cell.why === 'not-enabled' ? 'not-enabled' : 'not-found';
  if (cell.source === 'user') return 'user';
  return cell.ai ? 'ai' : cell.source === 'note' ? 'note' : 'user';
}

/** The ✦ is only on what Claude wrote: a cell from a note shows it when the note itself was written by Claude. */
export const hasStar = (s: CellState): boolean => s === 'ai';

/** The user's edit: the cell is the user's from now on (no ✦); an emptied cell goes back to waiting (it is written again on the next fill). */
export function editCell(rows: readonly CompareRow[], docId: string, colId: string, text: string): CompareRow[] {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, COMPARE_LIMITS.cell);
  return rows.map((r) => {
    if (r.docId !== docId) return r;
    const cells = { ...r.cells };
    if (clean === '') delete cells[colId];
    else cells[colId] = { text: clean, pages: cells[colId]?.pages ?? [], source: 'user', ai: false };
    return { ...r, cells };
  });
}

/** Keeps the cells of a table for the papers and columns it still has (a column removed takes its cells with it). */
export function pruneRows(rows: readonly CompareRow[], columns: readonly CompareColumn[]): CompareRow[] {
  const ids = new Set(columns.map((c) => c.id));
  return rows.map((r) => ({ ...r, cells: Object.fromEntries(Object.entries(r.cells).filter(([k]) => ids.has(k))) }));
}

/** An empty table for the papers: a row each, no cells yet. */
export const emptyRows = (labels: ReadonlyArray<{ docId: string; label: string }>): CompareRow[] => labels.map((l) => ({ docId: l.docId, label: l.label, cells: {} }));

/** Cells with nothing yet (the ones a fill would handle). */
export const missingCells = (rows: readonly CompareRow[], columns: readonly CompareColumn[]): number => rows.reduce((n, r) => n + columns.filter((c) => !r.cells[c.id]).length, 0);
