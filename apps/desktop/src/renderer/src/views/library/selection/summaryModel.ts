import type { StudyState } from '@rl/core';

/** The part of a row the summary reads (a `DocRow` fits). */
export interface SummaryRow {
  authors: string[];
  year: number | null;
  type: string | null;
  path: string;
  studyState: StudyState;
  tags: string[];
  directTags: string[];
}

export interface Count {
  value: string;
  n: number;
}

export interface SelectionSummary {
  total: number;
  /** One value when every document has it, otherwise the values with their counts (most frequent first). */
  type: { same: string | null; values: Count[] };
  years: { min: number; max: number } | null;
  /** Authors named by every document. */
  authors: string[];
  /** The deepest folder that holds every document ('' when they share none). */
  folder: string;
  status: Array<{ state: StudyState; n: number }>;
  /** Tags put by hand on every document, and on some of them (with how many). Implied tags are left out. */
  tagsAll: string[];
  tagsSome: Count[];
}

const byCount = (a: Count, b: Count) => b.n - a.n || a.value.localeCompare(b.value);
const STATES: StudyState[] = ['to-read', 'reading', 'read'];

const count = (values: Iterable<string>): Count[] => {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].map(([value, n]) => ({ value, n })).sort(byCount);
};

/** The folder part of a path, as segments (both separators). */
const folderOf = (path: string): string[] => path.split(/[\\/]+/).filter(Boolean).slice(0, -1);

/** Deepest folder shared by every path. */
export function commonFolder(paths: readonly string[]): string {
  const all = paths.map(folderOf);
  const first = all[0];
  if (!first) return '';
  let n = first.length;
  for (const f of all) {
    let i = 0;
    while (i < n && i < f.length && f[i] === first[i]) i++;
    n = i;
  }
  return first.slice(0, n).join('/');
}

/** What the selected documents share: a field is whole only when it is the same everywhere, else a summary. Never a list per document. */
export function summarizeSelection(rows: readonly SummaryRow[]): SelectionSummary {
  const total = rows.length;
  const types = count(rows.map((r) => r.type ?? ''));
  const years = rows.map((r) => r.year).filter((y): y is number => y !== null);
  const authorSets = rows.map((r) => new Set(r.authors));
  const authors = total === 0 ? [] : [...authorSets[0]!].filter((a) => authorSets.every((s) => s.has(a)));
  const tagCounts = count(rows.flatMap((r) => [...new Set(r.directTags ?? r.tags)]));
  return {
    total,
    type: { same: types.length === 1 && types[0]!.value !== '' ? types[0]!.value : null, values: types.filter((c) => c.value !== '') },
    years: years.length === 0 ? null : { min: Math.min(...years), max: Math.max(...years) },
    authors,
    folder: commonFolder(rows.map((r) => r.path)),
    status: STATES.map((state) => ({ state, n: rows.filter((r) => r.studyState === state).length })).filter((s) => s.n > 0),
    tagsAll: tagCounts.filter((c) => c.n === total).map((c) => c.value),
    tagsSome: tagCounts.filter((c) => c.n < total),
  };
}
