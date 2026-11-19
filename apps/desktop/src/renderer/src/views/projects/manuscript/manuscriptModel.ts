import type { Claim, Manuscript, ManuscriptRef } from '@rl/core';

/** Pure parts of the manuscript view (§18.1, Z1b): gaps, matrix columns and cells. Kept apart so they are tested without the view. */

export type Section = Manuscript['sections'][number];
export type Assignment = Manuscript['assignments'][number];

/** What the matrix needs to know about a paper. */
export interface Paper {
  docId: string;
  title: string;
  authors: readonly string[];
  year: number | null;
}

export type RefKind = ManuscriptRef['kind'];
export const REF_KINDS: readonly RefKind[] = ['doc', 'ann', 'note', 'litnote', 'claim'];

/** The same reference (kind and ids; the page of a note is part of it). */
export function refKey(r: ManuscriptRef): string {
  switch (r.kind) {
    case 'doc':
    case 'litnote':
      return `${r.kind}:${r.docId}`;
    case 'ann':
      return `ann:${r.docId}:${r.annId}`;
    case 'note':
      return `note:${r.docId}:${r.page ?? ''}`;
    case 'claim':
      return `claim:${r.claimId}`;
  }
}

/** The papers a reference reaches: its own document, or (a claim) the documents of its evidence. */
export function refDocs(r: ManuscriptRef, claims: ReadonlyMap<string, Claim>): string[] {
  if (r.kind !== 'claim') return [r.docId];
  return [...new Set((claims.get(r.claimId)?.evidence ?? []).map((e) => e.docId))];
}

/** The sections that are still in the manuscript, in order (a vanished one is not a row). */
export const liveSections = (m: Manuscript): Section[] => m.sections.filter((s) => !s.gone).sort((a, b) => a.order - b.order);

export interface Counts {
  doc: number;
  ann: number;
  note: number;
  litnote: number;
  claim: number;
  total: number;
}
const zero = (): Counts => ({ doc: 0, ann: 0, note: 0, litnote: 0, claim: 0, total: 0 });
const KEYS = [...REF_KINDS, 'total'] as const;

export interface Row {
  section: Section;
  /** Entries of the section itself. */
  own: Counts;
  /** Entries of the section and of its subsections. */
  subtree: Counts;
  /** A gap: no entry, neither its own nor of its subsections. */
  gap: boolean;
  /** Index (in `rows`) of the parent, or -1. */
  parent: number;
}

/** Sections with their counts and gaps, from the flat list in order and the level of each (the subsections follow their section while the level is deeper). */
export function buildRows(m: Manuscript): Row[] {
  const byId = new Map<string, Counts>();
  for (const a of m.assignments) {
    const c = byId.get(a.sectionId) ?? zero();
    c[a.ref.kind]++;
    c.total++;
    byId.set(a.sectionId, c);
  }
  const rows: Row[] = [];
  const stack: number[] = [];
  for (const section of liveSections(m)) {
    while (stack.length > 0 && rows[stack[stack.length - 1]!]!.section.level >= section.level) stack.pop();
    const own = { ...(byId.get(section.id) ?? zero()) };
    rows.push({ section, own, subtree: { ...own }, gap: false, parent: stack.length > 0 ? stack[stack.length - 1]! : -1 });
    stack.push(rows.length - 1);
  }
  // Children come after their parent: walking backwards, a row's subtree is complete when it is reached.
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    r.gap = r.subtree.total === 0;
    const p = r.parent >= 0 ? rows[r.parent] : undefined;
    if (p) for (const k of KEYS) p.subtree[k] += r.subtree[k];
  }
  return rows;
}

/** The assignments whose section vanished from the file, or is unknown: "Senza sezione". */
export function orphans(m: Manuscript): Assignment[] {
  const live = new Set(liveSections(m).map((s) => s.id));
  return m.assignments.filter((a) => !live.has(a.sectionId));
}

export interface Summary {
  gaps: number;
  unused: number;
}
export const summarize = (rows: readonly Row[], columns: readonly Column[]): Summary => ({ gaps: rows.filter((r) => r.gap).length, unused: columns.filter((c) => c.unused).length });

/** An initial such as "R.", "J.-P." or "RJ": never taken for a surname. */
const INITIAL = /^(?:\p{Lu}{1,2}\.?-?)+$/u;

/** "Surname year" of a paper: the first author (the part before a comma, else the last word that is not an initial, so "Rossi M." and "M. Rossi" both give Rossi) and the year. */
export function paperLabel(p: Paper): string {
  const first = (p.authors[0] ?? '').trim();
  const words = first.split(/\s+/).filter((w) => w !== '');
  const surname = first.includes(',') ? first.split(',')[0]!.trim() : ([...words].reverse().find((w) => !INITIAL.test(w)) ?? words.pop() ?? '');
  return [surname || p.title.slice(0, 16), p.year ?? ''].filter((x) => x !== '').join(' ');
}

export interface Column {
  docId: string;
  /** "Author year", with a, b... after it when two papers share it. */
  label: string;
  title: string;
  unused: boolean;
}

/**
 * The columns of the matrix: the papers of the project plus those reached by the assignments, in the order of the first section where each
 * appears (a diagonal), then the unused ones after a separator. Equal labels get the suffix a, b...
 */
export function buildColumns(m: Manuscript, papers: readonly Paper[], claims: ReadonlyMap<string, Claim>): Column[] {
  const info = new Map(papers.map((p) => [p.docId, p]));
  const rank = new Map(liveSections(m).map((s, i) => [s.id, i]));
  const first = new Map<string, number>();
  for (const a of m.assignments) {
    const r = rank.get(a.sectionId) ?? Number.MAX_SAFE_INTEGER;
    for (const d of refDocs(a.ref, claims)) first.set(d, Math.min(first.get(d) ?? r, r));
  }
  const ids = [...new Set([...papers.map((p) => p.docId), ...first.keys()])];
  const order = new Map(ids.map((d, i) => [d, i]));
  const used = ids.filter((d) => first.has(d)).sort((a, b) => first.get(a)! - first.get(b)! || order.get(a)! - order.get(b)!);
  const unused = ids.filter((d) => !first.has(d));
  const cols = [...used, ...unused].map((docId) => {
    const p = info.get(docId) ?? { docId, title: docId, authors: [], year: null };
    return { docId, label: paperLabel(p), title: p.title, unused: !first.has(docId) };
  });
  const seen = new Map<string, number>();
  for (const c of cols) seen.set(c.label, (seen.get(c.label) ?? 0) + 1);
  const next = new Map<string, number>();
  return cols.map((c) => {
    if ((seen.get(c.label) ?? 0) < 2) return c;
    const n = next.get(c.label) ?? 0;
    next.set(c.label, n + 1);
    return { ...c, label: `${c.label}${String.fromCharCode(97 + (n % 26))}` };
  });
}

export type CellState = 'direct' | 'indirect' | 'empty' | 'proposed';
export interface Cell {
  state: CellState;
  /** `direct`: the other entries about the paper; `indirect`: all of them. */
  n: number;
  counts: Counts;
}

/** Every cell with something in it, by `sectionId|docId`; the rest are `empty` (see `cellOf`). */
export function buildCells(m: Manuscript, claims: ReadonlyMap<string, Claim>): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  for (const a of m.assignments) {
    for (const d of refDocs(a.ref, claims)) {
      const key = `${a.sectionId}|${d}`;
      const cell = cells.get(key) ?? { state: 'indirect' as CellState, n: 0, counts: zero() };
      cell.counts[a.ref.kind]++;
      cell.counts.total++;
      cells.set(key, cell);
    }
  }
  for (const cell of cells.values()) {
    const direct = cell.counts.doc > 0;
    cell.state = direct ? 'direct' : 'indirect';
    cell.n = direct ? cell.counts.total - cell.counts.doc : cell.counts.total;
  }
  return cells;
}

export const cellOf = (cells: ReadonlyMap<string, Cell>, sectionId: string, docId: string): Cell => cells.get(`${sectionId}|${docId}`) ?? { state: 'empty', n: 0, counts: zero() };

/** "Solo i buchi": only the gap rows and the unused columns. */
export function onlyGaps(rows: readonly Row[], cols: readonly Column[]): { rows: Row[]; cols: Column[] } {
  return { rows: rows.filter((r) => r.gap), cols: cols.filter((c) => c.unused) };
}

/** The window of a long list: the indexes to draw for a scroll offset (simple virtualisation, a few extra items on each side). */
export function windowOf(total: number, size: number, offset: number, viewport: number, overscan = 4): [number, number] {
  const start = Math.max(0, Math.floor(offset / size) - overscan);
  const end = Math.min(total, Math.ceil((offset + viewport) / size) + overscan);
  return [Math.min(start, total), Math.max(Math.min(start, total), end)];
}

/** The sections written in the app, one per line with `#`...`####` for the level. */
export const sectionsToText = (sections: readonly Pick<Section, 'title' | 'level'>[]): string => sections.map((s) => `${'#'.repeat(s.level)} ${s.title}`).join('\n');

export interface SectionDraft {
  id?: string;
  title: string;
  level: number;
}

/**
 * The sections from the text of the editor. A line equal to an old section (title and level) keeps its id; a new line takes the id of an old
 * section that no line matches, in order (the line was reworded: its assignments stay); a line without `#` is level 1.
 */
export function textToSections(text: string, prev: readonly Pick<Section, 'id' | 'title' | 'level'>[]): SectionDraft[] {
  const lines = text
    .split('\n')
    .map((l) => /^(#{1,4})?\s*(.*?)\s*$/.exec(l.replace(/\s+/g, ' '))!)
    .map((m) => ({ level: m[1]?.length ?? 1, title: m[2]!.slice(0, 200) }))
    .filter((l) => l.title !== '')
    .slice(0, 500);
  const taken = new Set<string>();
  const hits = lines.map((l) => prev.find((p) => p.title === l.title && p.level === l.level && !taken.has(p.id)));
  hits.forEach((h) => h && taken.add(h.id));
  const spare = prev.filter((p) => !taken.has(p.id));
  return lines.map((l, i) => {
    const hit = hits[i] ?? spare.shift();
    return hit ? { id: hit.id, ...l } : l;
  });
}
