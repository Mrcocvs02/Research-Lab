import { describe, expect, it } from 'vitest';
import type { CitationLink } from '@rl/core';
import { libraryCocitation, rankReferences } from './ordering.js';

const link = (title: string, last: string, year: number, doi: string, matched: string | null = null): CitationLink => ({ title, authors: [`Ann ${last}`], year, doi, matchedDocId: matched as never, source: 'openalex', checkedAt: '2026-01-01T00:00:00.000Z' });

describe('rankReferences', () => {
  const refs = [link('Unrelated survey of cooking', 'Zed', 2001, '10.1/zed'), link('Tensor method for lattices', 'Smith', 2020, '10.1/smith'), link('Gap proof', 'Jones', 2018, '10.1/jones')];
  const sections = [
    { title: 'Introduction', text: 'Early work (Jones, 2018) exists.' },
    { title: 'Methods', text: 'We follow Smith (2020) and Smith et al., 2020 closely.' },
  ];
  it('puts the most mentioned work first and keeps the original order on ties', () => {
    const r = rankReferences({ refs, sections, libraryCounts: new Map() });
    expect(r.map((x) => x.link.doi)).toEqual(['10.1/smith', '10.1/jones', '10.1/zed']);
    expect(r[0]!.signals.mentions).toBe(2);
    expect(rankReferences({ refs: [refs[0]!, refs[0]!], sections: [], libraryCounts: new Map() }).map((x) => x.relevance)).toEqual([0, 0]);
  });
  it('uses co-citation with the library and similarity with the note', () => {
    const counts = libraryCocitation([[refs[2]!], [refs[2]!], [refs[0]!]]);
    const r = rankReferences({ refs, sections: [], libraryCounts: counts, noteText: 'tensor lattices' });
    expect(r[0]!.link.doi).toBe('10.1/jones');
    expect(r.find((x) => x.link.doi === '10.1/smith')!.signals.similarity).toBeGreaterThan(0.5);
  });
  it('relevance stays within 0-1', () => {
    for (const x of rankReferences({ refs, sections, libraryCounts: libraryCocitation([[refs[1]!]]), noteText: 'tensor method lattices' })) expect(x.relevance).toBeLessThanOrEqual(1);
  });
});
