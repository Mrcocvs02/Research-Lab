import { describe, expect, it } from 'vitest';
import { abstractFromText, authorsFromFirstPage, type TextLine } from './extract/heuristics.js';
import { fixAccents } from './extract/pdf.js';

const page = (...t: string[]): TextLine[] => t.map((text, i) => ({ text, size: i === 0 ? 20 : 11 }));

describe('authorsFromFirstPage on thesis title pages', () => {
  it('takes the candidate, not the supervisor (en)', () => {
    const lines = page('A Study of Synthetic Lattices', 'Supervisor: Prof. Alice Example', 'Co-supervisor: Dr. Bob Sample', 'Defended by', 'Carla Tester', 'Example University');
    expect(authorsFromFirstPage(lines, 0)).toEqual(['Carla Tester']);
  });
  it('takes the candidate, not the supervisor (it)', () => {
    const lines = page('Uno studio su reticoli sintetici', 'Relatore', 'Chiar.mo Prof. Mario Esempio', 'Correlatore: Dott. Luca Prova', 'Presentata da: Giulia Campione', 'Anno 2020');
    expect(authorsFromFirstPage(lines, 0)).toEqual(['Giulia Campione']);
    const two = page('Titolo di prova', 'Relatore: Prof. Mario Esempio', 'Candidato', 'Paolo Verifica');
    expect(authorsFromFirstPage(two, 0)).toEqual(['Paolo Verifica']);
  });
  it('without a candidate marker skips role lines and still reads plain author blocks', () => {
    expect(authorsFromFirstPage(page('T', 'Advisor: Prof. Alice Example', 'Dana Writer'), 0)).toEqual(['Dana Writer']);
    expect(authorsFromFirstPage(page('Paper', 'Ann Alpha, Ben Beta and Cy Gamma', 'Some Department'), 0)).toEqual(['Ann Alpha', 'Ben Beta', 'Cy Gamma']);
  });
});

describe('fixAccents', () => {
  it('composes spacing accents that precede a letter', () => {
    expect(fixAccents('M¨unchen, Universit´e, ¨Uber, Pi`u, ˜no')).toBe('München, Université, Über, Più, ño');
    expect(fixAccents('´Etude on caf´e')).toBe('Étude on café');
  });
  it('leaves quotes and impossible compositions alone', () => {
    expect(fixAccents("`quoted' and a^b and x¨z 3^2")).toBe("`quoted' and a^b and x¨z 3^2");
    expect(fixAccents('plain text')).toBe('plain text');
  });
});

describe('abstractFromText without an Abstract heading', () => {
  const body = [
    'We study a synthetic lattice model of interacting particles and show that its ground state',
    'is separated from the first excited state by a finite gap in the thermodynamic limit. Our',
    'numerical results agree with a simple mean-field argument across all parameter regimes tested.',
  ];
  it('takes the paragraph between the affiliations and the Introduction', () => {
    const text = ['Gaps in a Synthetic Lattice', 'Ann Alpha and Ben Beta', 'Department of Physics, Example University, Sampleton', 'ann@example.org', '(Dated: May 1, 2020)', ...body, 'I. INTRODUCTION', 'Lattice models are useful.'].join('\n');
    const a = abstractFromText(text)!;
    expect(a.startsWith('We study a synthetic lattice')).toBe(true);
    expect(a).toContain('mean-field argument');
    expect(a).not.toMatch(/Department|Example University|Dated|INTRODUCTION/);
  });
  it('returns nothing when only affiliations or short lines precede the Introduction', () => {
    expect(abstractFromText(['Title', 'Department of Physics, Example University, Sampleton, Country', '1 Introduction', 'text'].join('\n'))).toBeUndefined();
    expect(abstractFromText('no structure here at all')).toBeUndefined();
  });
  it('keeps the labelled abstract when there is a heading', () => {
    const labelled = ['Abstract', ...body, 'Introduction', 'x'].join('\n');
    expect(abstractFromText(labelled)).toContain('synthetic lattice');
  });
});

describe('abstractFromText on a thesis', () => {
  const para = [
    'This thesis studies synthetic lattice models of interacting particles and proves that the ground state is gapped.',
    'Introduction of a new numerical scheme allows us to reach sizes far beyond previous work, and the results',
    'agree with a mean-field argument. The final part discusses open problems and perspectives for later work.',
  ];
  it('keeps the whole abstract when a wrapped line starts with "Introduction"', () => {
    const a = abstractFromText(['Abstract', ...para, 'Keywords: lattice', 'Contents'].join('\n'))!;
    expect(a).toContain('open problems and perspectives');
    expect(a).not.toContain('Keywords');
  });
  it('stops at a short "Contents" heading but not at a numbered chapter inside the abstract', () => {
    const a = abstractFromText(['Riassunto', ...para, 'Indice', '1 Introduzione'].join('\n'))!;
    expect(a).toContain('perspectives');
    expect(a).not.toContain('Introduzione');
  });
  it('is longer than a paper abstract limit allows', () => {
    const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} about the synthetic lattice model and its properties.`).join('\n');
    expect(abstractFromText(['Abstract', long, 'Keywords: x'].join('\n'))!.length).toBeGreaterThan(3000);
  });
});
