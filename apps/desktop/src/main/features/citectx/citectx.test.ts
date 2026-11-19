import { describe, expect, it } from 'vitest';
import { bodyPages, bracketHas, mentionSentences } from './parse.js';

const pages = [
  { page: 1, text: 'Intro. We build on the estimator of Rossi et al. (2019), which is stable. Other work [3, 12] also uses it. Nothing here.' },
  { page: 2, text: 'Results follow [10-14] and agree.\nReferences\n[12] Rossi, M. 2019. A stable estimator.' },
];

describe('citation context', () => {
  it('knows which brackets name an entry', () => {
    expect(bracketHas('3, 12', 12)).toBe(true);
    expect(bracketHas('10-14', 12)).toBe(true);
    expect(bracketHas('10–14', 15)).toBe(false);
    expect(bracketHas('see 12', 12)).toBe(false);
  });
  it('leaves the bibliography out', () => {
    expect(bodyPages(pages)[1]!.text).not.toContain('Rossi, M.');
  });
  it('finds a numbered mention with its page', () => {
    expect(mentionSentences(pages, { n: 12, surname: null, year: null })).toEqual([
      { page: 1, text: 'Other work [3, 12] also uses it.' },
      { page: 2, text: 'Results follow [10-14] and agree.' },
    ]);
  });
  it('finds an author-year mention', () => {
    const r = mentionSentences(pages, { n: null, surname: 'Rossi', year: 2019 });
    expect(r).toHaveLength(1);
    expect(r[0]!.page).toBe(1);
  });
});
