import { describe, expect, it } from 'vitest';
import { authorsFromFirstPage, type TextLine } from './extract/heuristics.js';

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
