import { describe, expect, it } from 'vitest';
import type { Claim, Manuscript } from '@rl/core';
import { buildCells, buildColumns, buildRows, cellOf, onlyGaps, orphans, paperLabel, summarize, textToSections, windowOf, type Paper } from './manuscriptModel';

const A = 'a'.repeat(16);
const B = 'b'.repeat(16);
const C = 'c'.repeat(16);
const E = 'e'.repeat(16);
const at = '2026-01-01T00:00:00.000Z';
const sec = (id: string, level: number, order: number, gone?: true) => ({ id, title: `T ${id}`, level, order, ...(gone ? { gone } : {}) });
const doc = (sectionId: string, docId: string) => ({ sectionId, ref: { kind: 'doc' as const, docId }, origin: 'user' as const, at });
const ann = (sectionId: string, docId: string) => ({ sectionId, ref: { kind: 'ann' as const, docId, annId: 'x1', page: 3 }, origin: 'user' as const, at });
const ms = (assignments: Manuscript['assignments'], sections = [sec('s1', 1, 0), sec('s11', 2, 1), sec('s12', 2, 2), sec('s2', 1, 3)]): Manuscript => ({ schemaVersion: 1, source: { kind: 'app' }, sections, assignments });
const paper = (docId: string, authors: string[], year: number | null): Paper => ({ docId, title: `Title ${docId.slice(0, 1)}`, authors, year });
const none = new Map<string, Claim>();

describe('gaps', () => {
  it('is a gap only when neither the section nor its subsections have an entry', () => {
    const rows = buildRows(ms([doc('s12', A)]));
    expect(rows.map((r) => [r.section.id, r.gap])).toEqual([['s1', false], ['s11', true], ['s12', false], ['s2', true]]);
    expect(rows[0]!.subtree.doc).toBe(1);
    expect(rows[0]!.own.total).toBe(0);
  });

  it('counts each kind and leaves vanished sections out of the rows', () => {
    const m = ms([doc('s1', A), ann('s1', B), doc('s9', C)], [sec('s1', 1, 0), sec('s9', 1, 1, true)]);
    const rows = buildRows(m);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.own).toMatchObject({ doc: 1, ann: 1, total: 2 });
    expect(orphans(m).map((a) => a.sectionId)).toEqual(['s9']);
  });

  it('summarises gaps and unused papers', () => {
    const m = ms([doc('s12', A)]);
    const cols = buildColumns(m, [paper(A, ['X'], 2020), paper(E, ['Y'], 2017)], none);
    expect(summarize(buildRows(m), cols)).toEqual({ gaps: 2, unused: 1 });
  });
});

describe('columns', () => {
  const papers = [paper(A, ['Rossi, M.'], 2021), paper(B, ['Anna Bianchi'], 2019), paper(C, ['Verdi'], 2018), paper(E, ['Neri'], 2017)];

  it('orders by the first section where a paper appears, the unused last', () => {
    const m = ms([doc('s2', A), doc('s1', C), ann('s12', B)]);
    const cols = buildColumns(m, papers, none);
    expect(cols.map((c) => c.docId)).toEqual([C, B, A, E]);
    expect(cols.map((c) => c.unused)).toEqual([false, false, false, true]);
    expect(cols[0]!.label).toBe('Verdi 2018');
    expect(cols[1]!.label).toBe('Bianchi 2019');
    expect(cols[2]!.label).toBe('Rossi 2021');
  });

  it('adds papers reached only by assignments and suffixes equal labels with a, b', () => {
    const m = ms([doc('s1', A), doc('s1', B), doc('s1', 'f'.repeat(16))]);
    const twins = [paper(A, ['Rossi'], 2020), paper(B, ['Rossi'], 2020)];
    const cols = buildColumns(m, twins, none);
    expect(cols.map((c) => c.label)).toEqual(['Rossi 2020a', 'Rossi 2020b', `${'f'.repeat(16).slice(0, 16)}`.slice(0, 16)]);
    expect(cols).toHaveLength(3);
  });

  it('reaches the papers of the evidence of a claim', () => {
    const claim: Claim = { id: 'c1', questionId: null, text: 't', evidence: [{ docId: B, page: 1, stance: 'supports', excerpt: '' }, { docId: C, page: 2, stance: 'supports', excerpt: '' }] };
    const m = ms([{ sectionId: 's1', ref: { kind: 'claim', claimId: 'c1' }, origin: 'user', at }]);
    const cols = buildColumns(m, papers, new Map([['c1', claim]]));
    expect(cols.filter((c) => !c.unused).map((c) => c.docId)).toEqual([B, C]);
  });

  it('keeps only the gap rows and the unused columns for "Solo i buchi"', () => {
    const m = ms([doc('s12', A)]);
    const g = onlyGaps(buildRows(m), buildColumns(m, papers, none));
    expect(g.rows.map((r) => r.section.id)).toEqual(['s11', 's2']);
    expect(g.cols.map((c) => c.docId)).toEqual([B, C, E]);
  });

  it('labels a paper without authors by its title', () => {
    expect(paperLabel({ docId: A, title: 'A very long title indeed', authors: [], year: 2000 })).toBe('A very long titl 2000');
  });
});

describe('cells', () => {
  it('tells direct (with the other entries), indirect and empty', () => {
    const m = ms([doc('s1', A), ann('s1', A), ann('s1', A), ann('s12', B), doc('s12', C)]);
    const cells = buildCells(m, none);
    expect(cellOf(cells, 's1', A)).toMatchObject({ state: 'direct', n: 2 });
    expect(cellOf(cells, 's12', B)).toMatchObject({ state: 'indirect', n: 1 });
    expect(cellOf(cells, 's12', C)).toMatchObject({ state: 'direct', n: 0 });
    expect(cellOf(cells, 's2', A).state).toBe('empty');
  });

  it('counts a claim for every paper of its evidence', () => {
    const claim: Claim = { id: 'c1', questionId: null, text: 't', evidence: [{ docId: A, page: 1, stance: 'supports', excerpt: '' }, { docId: B, page: 1, stance: 'contradicts', excerpt: '' }] };
    const cells = buildCells(ms([{ sectionId: 's2', ref: { kind: 'claim', claimId: 'c1' }, origin: 'user', at }]), new Map([['c1', claim]]));
    expect(cellOf(cells, 's2', A).state).toBe('indirect');
    expect(cellOf(cells, 's2', B).state).toBe('indirect');
  });
});

describe('window and editor text', () => {
  it('draws only the visible range with some margin', () => {
    expect(windowOf(500, 28, 0, 280, 2)).toEqual([0, 12]);
    expect(windowOf(500, 28, 2800, 280, 2)).toEqual([98, 112]);
    expect(windowOf(10, 28, 100000, 280, 2)).toEqual([10, 10]);
  });

  it('keeps the id of a reworded line and of an unchanged one', () => {
    const prev = [{ id: 'a1', title: 'Intro', level: 1 }, { id: 'a2', title: 'Method', level: 1 }];
    const out = textToSections('# Intro\n## New part\n# Methods and more\nplain', prev);
    expect(out.map((s) => [s.id, s.title, s.level])).toEqual([['a1', 'Intro', 1], ['a2', 'New part', 2], [undefined, 'Methods and more', 1], [undefined, 'plain', 1]]);
  });
});
