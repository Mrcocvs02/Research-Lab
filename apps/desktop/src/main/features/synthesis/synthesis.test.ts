import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMPARE_BLOCK, comparePrompt, compareSystem, COMPARE_VERSION } from '@rl/ai/synthesis';
import type { CompareColumn, CompareTable, DocumentRecord } from '@rl/core';
import { cellOfSection, noteCells, rowLabel, splitCells } from './cells.js';
import { groupData, groupId, institutionCounts, overviewMarkdown } from './groups.js';
import { listTables, parseTable, readTable, removeTable, tableCsv, tableMarkdown, writeTable } from './table-store.js';

const ID = '0123456789abcdef';
const NOTE = `# T\nA · 2021\n\n## Problema\nIl problema. ([p. 2](lab://doc/${ID}?page=2))\n\n## Contributo\n—\n\n## Metodo\nIl metodo (p. 4) senza link.\n\n## Risultati\nRisultati ([p. 7](lab://doc/${ID}?page=7), [p. 9](lab://doc/${ID}?page=9))\n\n## Dati usati\nDataset X.\n\n## Limiti e prospettive\n—\n`;
const COLS: CompareColumn[] = [
  { id: 'problem', name: 'Problema', key: 'problem' },
  { id: 'method', name: 'Metodo', key: 'method' },
  { id: 'limits', name: 'Limiti', key: 'limits' },
  { id: 'c-sample', name: 'Campione', key: null },
];

describe('cells from the literature note', () => {
  it('reads the sections by heading, with their pages, and skips empty ones', () => {
    const c = noteCells(NOTE);
    expect(c.get('problem')).toEqual({ text: 'Il problema.', pages: [2] });
    expect(c.get('results')).toEqual({ text: 'Risultati', pages: [7, 9] });
    expect(c.get('data')?.text).toBe('Dataset X.');
    expect(c.has('contribution')).toBe(false);
    expect(c.has('limits')).toBe(false);
  });
  it('treats a dash as nothing', () => {
    expect(cellOfSection('—')).toBeNull();
    expect(cellOfSection('')).toBeNull();
  });
  it('labels a row with the surname and the year', () => {
    expect(rowLabel({ title: 'T', authors: ['Ada Writer', 'B C', 'D E'], year: 2021, path: 'a.pdf' })).toBe('Writer et al. 2021');
    expect(rowLabel({ title: 'Only title', authors: [], year: null, path: 'a.pdf' })).toBe('Only title');
  });
});

describe('which cells need Claude (reuse without sends)', () => {
  const note = noteCells(NOTE);
  it("reuses the cells of the notes, keeps the user's cells, and asks only for the rest", () => {
    const own = { text: 'mine', pages: [], source: 'user' as const, ai: false };
    const r = splitCells(
      [
        { id: 'a', enabled: true, note, noteAi: true },
        { id: 'b', enabled: true, note: null, noteAi: false },
        { id: 'c', enabled: false, note: null, noteAi: false },
      ],
      COLS,
      new Map([['b', { method: own }]]),
    );
    expect(r.count).toEqual({ total: 12, ready: 1, fromNotes: 2, notEnabled: 4, toWrite: 5 });
    expect(r.ready.get('a')!['problem']).toMatchObject({ source: 'note', ai: true, pages: [2] });
    expect(r.ready.get('b')!['method']).toBe(own);
    expect(r.ready.get('c')!['problem']).toMatchObject({ source: 'none', why: 'not-enabled', text: '' });
    // The custom column never reads a note; a paper of a folder that may not be sent is never in the list to send.
    expect(r.missing.get('c-sample')).toEqual(['a', 'b']);
    expect(r.missing.get('problem')).toEqual(['b']);
    expect(r.missing.has('method')).toBe(false);
  });
  it('sends nothing when every cell is in a note', () => {
    const r = splitCells([{ id: 'a', enabled: true, note, noteAi: false }], COLS.slice(0, 2), new Map());
    expect(r.missing.size).toBe(0);
    expect(r.count.toWrite).toBe(0);
  });
});

describe('the cell prompt', () => {
  it('is versioned, structured, and carries only the keys and the text given', () => {
    const sys = compareSystem('en', COLS[0]!);
    expect(sys).toContain(COMPARE_VERSION);
    expect(sys).toContain('OUTPUT FORMAT');
    const p = comparePrompt('Problem', [{ key: 'p1', title: 'T', text: '[page 1]\nbody' }]);
    expect(p).toContain('key: p1');
    expect(p).not.toContain(ID);
    expect(COMPARE_BLOCK).toBe(10);
  });
});

describe('the table file', () => {
  let dir = '';
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'rl-cmp-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));
  const table: CompareTable = {
    id: 'tbl1',
    projectId: 'proj1',
    title: 'Methods | compared',
    createdAt: '2026-11-19T10:00:00.000Z',
    updatedAt: '2026-11-19T10:00:00.000Z',
    columns: COLS.slice(0, 2),
    rows: [{ docId: ID, label: 'Writer 2021', cells: { problem: { text: 'p | q', pages: [2], source: 'claude', ai: true }, method: { text: '', pages: [], source: 'none', ai: false, why: 'not-found' } } }],
  };
  it('writes a Markdown table with the data in the front matter and reads it back', async () => {
    const md = tableMarkdown(table);
    expect(md).toContain('| Paper | Problema | Metodo |');
    expect(md).toContain('✦');
    expect(md).toContain(`lab://doc/${ID}?page=2`);
    expect(parseTable(md)).toEqual(table);
    await writeTable(dir, table);
    expect(await readTable(dir, 'proj1', 'tbl1')).toEqual(table);
    expect((await listTables(dir, 'proj1'))[0]).toMatchObject({ id: 'tbl1', docs: 1, columns: 2 });
    expect(await removeTable(dir, 'proj1', 'tbl1')).toBe(true);
    expect(await readTable(dir, 'proj1', 'tbl1')).toBeNull();
  });
  it('refuses a table id that is a path', async () => {
    await expect(readTable(dir, 'proj1', '../x')).rejects.toThrow();
  });
  it('writes a CSV that a spreadsheet cannot run as a formula', () => {
    const csv = tableCsv({ ...table, rows: [{ docId: ID, label: '=cmd', cells: { problem: { text: '+1,"x"', pages: [3], source: 'user', ai: false } } }] });
    expect(csv).toContain("'=cmd");
    expect(csv).toContain(`"'+1,""x"" (p. 3)"`);
  });
});

const rec = (id: string, authors: string[], tags: string[] = [], year = 2020): DocumentRecord => ({ id, title: `Title ${id}`, authors, year, tags, path: 'f/a.pdf' }) as unknown as DocumentRecord;

describe('group overview', () => {
  it('counts authors, recurring co-authors and tags, and flags ambiguous names', () => {
    const d = groupData([rec('a', ['Ada Lovelace', 'Bob Ray'], ['t1']), rec('b', ['Ada Lovelace', 'Bob Ray', 'C.']), rec('c', ['Ada Lovelace'], ['t1'])], (id) => `tag ${id}`);
    expect(d.authors[0]).toEqual({ name: 'Ada Lovelace', docs: 3 });
    expect(d.pairs).toEqual([{ a: 'Ada Lovelace', b: 'Bob Ray', docs: 2 }]);
    expect(d.tags[0]).toEqual({ label: 'tag t1', docs: 2 });
    expect(d.incomplete).toEqual(['C.']);
  });
  it('has the same id for the same set of papers in any order', () => {
    expect(groupId(['b', 'a'])).toBe(groupId(['a', 'b', 'a']));
    expect(groupId(['a'])).toMatch(/^[0-9a-f]{16}$/);
  });
  it('says so when the themes were not written, and links the works', () => {
    const docs = [rec('0123456789abcdef', ['Ada Lovelace'])];
    const md = overviewMarkdown({ docs, data: groupData(docs, (x) => x), written: null, keyDoc: new Map(), at: '2026-11-19T10:00:00.000Z', lang: 'en' });
    expect(md).toContain('Synthesis not written');
    expect(md).toContain('lab://doc/0123456789abcdef');
  });
  it('counts each institution once per work, most frequent first, and lists them in the overview', () => {
    const w = (...insts: string[][]) => ({ authorships: insts.map((i) => ({ institutions: i.map((display_name) => ({ display_name })) })) });
    const inst = institutionCounts([w(['Univ A', 'Lab B'], ['Univ A']), w(['univ a'], []), w(['Lab B']), { authorships: 'bad' }, null]);
    expect(inst).toEqual([
      { name: 'Lab B', docs: 2 },
      { name: 'Univ A', docs: 2 },
    ]);
    expect(institutionCounts([w(['Univ A']), w(['Univ A']), w(['Lab B'])])[0]).toEqual({ name: 'Univ A', docs: 2 });
    const docs = [rec('0123456789abcdef', ['Ada Lovelace'])];
    const md = overviewMarkdown({ docs, data: { ...groupData(docs, (x) => x), institutions: inst }, written: null, keyDoc: new Map(), at: '2026-11-19T10:00:00.000Z', lang: 'en' });
    expect(md).toContain('## Institutions (OpenAlex)');
    expect(md).toContain('- Univ A (2)');
    expect(overviewMarkdown({ docs, data: groupData(docs, (x) => x), written: null, keyDoc: new Map(), at: '2026-11-19T10:00:00.000Z', lang: 'en' })).not.toContain('Institutions');
  });
});
