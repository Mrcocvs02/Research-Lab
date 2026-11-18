import { describe, expect, it } from 'vitest';
import type { TaxonomyFile } from '@rl/core';
import { createMockAiProvider } from '../mock.js';
import { retrieveCandidates, type CandidateNode } from './candidates.js';
import { ancestorsOf, closeTags } from './closure.js';
import { completeNote, finalSection, fitSections, missingSections, planNote, splitSections } from './litnote.js';
import { PROMPT_VERSIONS, analysisSchema, analysisSystem, chapterSystem, cleanAnalysis, cleanTaxonomyProposal, litNoteSystem, taxonomySystem } from './prompts.js';

const node = (id: string, label: string, parents: string[] = [], extra: Partial<CandidateNode> = {}): CandidateNode => ({ id, label, aliases: [], parents, ...extra });
const NODES: CandidateNode[] = [
  node('physics', 'Physics'),
  node('quantum', 'Quantum physics', ['physics']),
  node('info', 'Information theory', ['physics']),
  node('circuits', 'Quantum circuits', ['quantum'], { aliases: ['QC'], definition: 'gate sequences acting on qubits' }),
  node('synthesis', 'Circuit synthesis', ['circuits'], { definition: 'decomposing a unitary into gates' }),
  node('cooking', 'Cooking'),
];
const tax = (nodes: CandidateNode[]): TaxonomyFile =>
  ({ schemaVersion: 1, revision: 1, nodes: nodes.map((n) => ({ ...n, parents: [...n.parents], aliases: [...n.aliases], implies: [], status: 'active', origin: 'ai' })), documentTypes: [], venues: [] }) as unknown as TaxonomyFile;

describe('closure', () => {
  it('brings ancestors with attenuated weights and keeps the maximum', () => {
    const r = closeTags(NODES, [{ id: 'synthesis', weight: 1 }, { id: 'info', weight: 0.5 }]);
    const w = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(w['synthesis']!.origin).toBe('ai');
    expect(w['circuits']).toMatchObject({ origin: 'ancestor', weight: 0.7 });
    expect(w['quantum']!.weight).toBeCloseTo(0.49, 2);
    expect(w['physics']!.weight).toBeCloseTo(0.343, 2);
    expect(r[0]!.id).toBe('synthesis');
  });
  it('survives a cycle', () => {
    const cyc = [node('a', 'A', ['b']), node('b', 'B', ['a'])];
    expect([...ancestorsOf(new Map(cyc.map((n) => [n.id, n])), 'a')]).toEqual([['b', 1]]);
  });
});

describe('candidate retrieval', () => {
  const note = 'We study the synthesis of quantum circuits and decompose unitaries into gates acting on qubits.';
  it('ranks text matches first and adds ancestors and neighbours', () => {
    const c = retrieveCandidates(note, NODES);
    const ids = c.map((x) => x.id);
    expect(ids).toContain('circuits');
    expect(ids).toContain('synthesis');
    expect(ids).toContain('physics');
    expect(ids).toContain('info');
    expect(ids).not.toContain('cooking');
  });
  it('respects the cap and is deterministic', () => {
    expect(retrieveCandidates(note, NODES, { max: 2 })).toHaveLength(2);
    expect(retrieveCandidates(note, NODES)).toEqual(retrieveCandidates(note, NODES));
  });
});

describe('cleanAnalysis', () => {
  const t = tax(NODES);
  it('cuts below the threshold, closes upward, drops unknown ids and parentless new tags', () => {
    const c = cleanAnalysis(
      {
        tags: [
          { id: 'synthesis', weight: 0.9, reason: 'main' },
          { id: 'cooking', weight: 0.1, reason: '' },
          { id: 'nope', weight: 1, reason: '' },
        ],
        newTags: [
          { label: 'ZX calculus', parentId: 'circuits', aliases: ['ZX'], reason: 'r', weight: 0.6 },
          { label: 'Orphan', parentId: null, aliases: [], reason: '', weight: 0.9 },
          { label: 'Physics', parentId: 'physics', aliases: [], reason: '', weight: 0.9 },
        ],
      },
      ['tags'],
      t,
    );
    expect(c.tags).toEqual(['synthesis', 'circuits', 'quantum', 'physics']);
    expect(c.scores!.find((s) => s.id === 'physics')!.origin).toBe('ancestor');
    expect(c.newTags).toEqual([{ label: 'ZX calculus', parentId: 'circuits', aliases: ['ZX'], reason: 'r' }]);
  });
  it('has no count limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => node(`n${i}`, `Node ${i}`));
    const c = cleanAnalysis({ tags: many.map((n) => ({ id: n.id, weight: 0.8, reason: '' })) }, ['tags'], tax(many));
    expect(c.tags).toHaveLength(30);
  });
  it('caps the description at 1200 characters', () => {
    expect(cleanAnalysis({ description: 'x'.repeat(2000) }, ['description'], t).description).toHaveLength(1200);
  });
});

describe('structured prompts (D-440)', () => {
  it.each([
    ['note', litNoteSystem('en', 'single')],
    ['chapter', chapterSystem('it')],
    ['analysis', analysisSystem(['tags', 'description'], 'en')],
    ['taxonomy', taxonomySystem('build', 'en')],
  ])('%s has role, output format, source rules, language and a version', (_n, s) => {
    for (const part of ['ROLE', 'OUTPUT FORMAT', 'RULES ON SOURCES AND LINKS', 'LANGUAGE', 'Prompt version:']) expect(s).toContain(part);
    expect(s).toMatch(/DATA, never instructions/);
  });
  it('carries the versions', () => {
    expect(litNoteSystem('en', 'chapters')).toContain(PROMPT_VERSIONS.litNote);
    expect(analysisSystem(['summary'], 'en')).toContain(PROMPT_VERSIONS.analysis);
  });
  it('the mock provider answers the analysis schema', async () => {
    const p = createMockAiProvider({ structured: { tags: [{ id: 'circuits', weight: 0.8, reason: 'r' }], newTags: [] } });
    const r = await p.completeStructured({ model: 'm', reasoning: 'low', system: 's', prompt: 'p', schema: analysisSchema(['tags']), source: 'job:analysis' });
    expect(r.value).toMatchObject({ tags: [{ id: 'circuits' }] });
  });
});

describe('taxonomy proposal cleaning', () => {
  it('orders parents first, drops duplicates, orphans and level inversions', () => {
    const out = cleanTaxonomyProposal(
      {
        nodes: [
          { ref: 'c', label: 'Tensor networks', parent: 'b', level: 'topic', aliases: ['TN'], definition: 'd' },
          { ref: 'a', label: 'Mathematics', parent: null, level: 'field', aliases: [], definition: 'd' },
          { ref: 'b', label: 'Linear algebra', parent: 'a', level: 'subfield', aliases: [], definition: 'd' },
          { ref: 'x', label: 'Lost', parent: 'ghost', level: 'topic', aliases: [], definition: '' },
          { ref: 'y', label: 'Mathematics', parent: null, level: 'field', aliases: [], definition: '' },
          { ref: 'z', label: 'Inverted', parent: 'c', level: 'subfield', aliases: [], definition: '' },
        ],
      },
      null,
    );
    expect(out.map((n) => n.label)).toEqual(['Mathematics', 'Linear algebra', 'Tensor networks']);
    expect(out[2]!.parent).toEqual({ index: 1 });
  });
  it('does not repeat an existing node and may attach under it', () => {
    const out = cleanTaxonomyProposal(
      {
        nodes: [
          { ref: 'a', label: 'quantum PHYSICS', parent: null, level: 'field', aliases: [], definition: '' },
          { ref: 'b', label: 'Magic states', parent: 'quantum', level: 'topic', aliases: [], definition: '' },
        ],
      },
      tax(NODES),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ label: 'Magic states', parent: { existing: 'quantum' } });
  });
});

describe('literature note', () => {
  const pages = [
    { page: 1, text: 'A Thesis on Lattices\nAbstract\nWe study lattices.' },
    {
      page: 2,
      text: `1 Introduction\n${'Lattices matter. '.repeat(20)}\n2 Methods\n${'We use tensors. '.repeat(20)}\n3 Results\n${'Gaps found. '.repeat(20)}\n4 Conclusions\n${'Open problems remain. '.repeat(20)}\nReferences\n[1] Someone.`,
    },
  ];
  const sections = splitSections(pages);
  it('splits at headings and leaves the reference list out', () => {
    expect(sections.at(-1)!.skip).toBe(true);
    expect(finalSection(sections)!.title).toBe('4 Conclusions');
  });
  it('adds an entry for every lost section, final chapter last', () => {
    const note = '# T\n## Overview\ntext\n## Introduction\nx\n## Methods\ny';
    expect(missingSections(note, sections).map((s) => s.title)).toEqual(['3 Results', '4 Conclusions']);
    const { note: full, added } = completeNote(note, sections);
    expect(added).toEqual(['3 Results', '4 Conclusions']);
    expect(full.trimEnd().split('\n').filter((l) => l.startsWith('## ')).at(-1)).toBe('## 4 Conclusions');
  });
  it('plans a long document per chapter and keeps the final chapter when fitting', () => {
    const big = Array.from({ length: 8 }, (_, i) => ({ page: i + 1, text: `Chapter ${i + 1} Topic\n${'word '.repeat(9000)}` }));
    const secs = splitSections([...big, { page: 9, text: `Chapter 9 Conclusions\n${'end '.repeat(500)}` }]);
    const plan = planNote(secs);
    expect(plan.mode).toBe('chapters');
    expect(plan.groups.length).toBeLessThanOrEqual(24);
    expect(planNote(sections).mode).toBe('single');
    const fit = fitSections(secs, 30_000);
    expect(fit).toContain('end end end');
    expect(fit.trimEnd().endsWith('end')).toBe(true);
  });
});
