import { describe, expect, it } from 'vitest';
import { looksLikeIdentifier } from '../../lib/addRequest';
import { guessKind } from './model';

describe('guessKind', () => {
  it('guesses the kind of a link from its address', () => {
    expect(guessKind('https://github.com/org/repo')).toBe('code');
    expect(guessKind('https://zenodo.org/records/1')).toBe('data');
    expect(guessKind('https://example.org/work/analysis.ipynb')).toBe('notebook');
    expect(guessKind('https://colab.research.google.com/drive/x')).toBe('notebook');
    expect(guessKind('https://example.org/page')).toBe('web');
    expect(guessKind('not an address')).toBe('web');
  });
});

describe('looksLikeIdentifier', () => {
  it.each(['10.1000/xyz123', 'doi:10.1000/xyz123', 'https://doi.org/10.1000/xyz123', '2401.01234', 'arXiv:2401.01234v2', 'https://arxiv.org/abs/2401.01234', 'hep-th/9901001'])('accepts %s', (t) => {
    expect(looksLikeIdentifier(t)).toBe(true);
  });
  it.each(['', 'graph neural networks', '2024', 'https://example.org/page', 'http://localhost/10.1000/x y'])('refuses %s', (t) => {
    expect(looksLikeIdentifier(t)).toBe(false);
  });
});
