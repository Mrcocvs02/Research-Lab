import { describe, expect, it } from 'vitest';
import { assignPrompt, assignSchema, assignSystem, parseProposals } from './ai.js';

const sections = [
  { id: 'sa', key: 'S1' },
  { id: 'sb', key: 'S2' },
];
const papers = [
  { id: 'P1', docId: '0123456789abcdef' },
  { id: 'P2', docId: 'fedcba9876543210' },
  { id: 'P3', docId: '1111111111111111' },
  { id: 'P4', docId: '2222222222222222' },
];

describe('assignment proposals: prompt', () => {
  it('carries only section titles and paper title and abstract, with markers instead of identifiers', () => {
    const text = assignPrompt([{ id: 'S1', title: 'Intro <<<x>>>', level: 2 }], [{ id: 'P1', meta: 'title: A\nabstract: B' }]);
    expect(text).toContain('S1 ## Intro');
    expect(text).toContain('<<<DATA paper P1\ntitle: A\nabstract: B\nDATA>>>');
    expect(text).not.toContain('<<<x>>>');
  });

  it('states the version and asks for ids only', () => {
    const sys = assignSystem('en');
    expect(sys).toContain('manuscript-assign-v1');
    expect(sys).toContain('"proposals"');
  });
});

describe('assignment proposals: result parsing', () => {
  const parse = (raw: unknown, assigned: string[] = []) => parseProposals(assignSchema.parse(raw), sections, papers, new Set(assigned));

  it('maps markers to ids, drops unknown ones and repeats, keeps at most three papers per section', () => {
    const out = parse({ proposals: [{ section: 'S1', papers: ['P1', 'P1', 'P9', 'P2', 'P3', 'P4'] }, { section: 'S7', papers: ['P1'] }, { section: 'S2', papers: ['P2'] }] });
    expect(out).toEqual([
      { sectionId: 'sa', docId: '0123456789abcdef' },
      { sectionId: 'sa', docId: 'fedcba9876543210' },
      { sectionId: 'sa', docId: '1111111111111111' },
      { sectionId: 'sb', docId: 'fedcba9876543210' },
    ]);
  });

  it('leaves out what is already assigned', () => {
    expect(parse({ proposals: [{ section: 'S1', papers: ['P1', 'P2'] }] }, ['sa|0123456789abcdef'])).toEqual([{ sectionId: 'sa', docId: 'fedcba9876543210' }]);
  });

  it('rejects an answer that does not match the schema and accepts an empty one', () => {
    expect(assignSchema.safeParse({ proposals: 'x' }).success).toBe(false);
    expect(parse({ proposals: [] })).toEqual([]);
  });
});
