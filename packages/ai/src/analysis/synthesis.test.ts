import { describe, expect, it } from 'vitest';
import { cleanCompare, cleanGroups, COMPARE_VERSION, GROUPS_VERSION, groupsPrompt, groupsSystem } from './synthesis.js';

describe('synthesis prompts and answers', () => {
  it('keeps only the keys asked for, one line, pages inside the paper', () => {
    const out = cleanCompare(
      { cells: [{ key: 'p1', text: ' a\n b ', pages: [3, 1, 99, 3] }, { key: 'p1', text: 'dup', pages: [] }, { key: 'x', text: 'no', pages: [1] }, { key: 'p2', text: '', pages: [4] }] },
      new Map([['p1', 10], ['p2', 10]]),
    );
    expect(out.get('p1')).toEqual({ text: 'a b', pages: [1, 3] });
    expect(out.get('p2')).toEqual({ text: '', pages: [] });
    expect(out.has('x')).toBe(false);
  });
  it('drops themes without a valid paper', () => {
    const r = cleanGroups({ overview: 'o', themes: [{ name: 'A', summary: 's', keys: ['p1', 'zz'] }, { name: 'B', summary: 's', keys: ['zz'] }] }, new Set(['p1']));
    expect(r.themes).toEqual([{ name: 'A', summary: 's', keys: ['p1'] }]);
  });
  it('versions the prompts and sends only the metadata of the themes', () => {
    expect(groupsSystem('it')).toContain(GROUPS_VERSION);
    expect(COMPARE_VERSION).toMatch(/-v\d+$/);
    const p = groupsPrompt([{ key: 'p1', title: 'T <<<x', authors: ['A'], year: 2020, tags: ['t'], description: 'd' }]);
    expect(p).toContain('key: p1');
    expect(p).not.toContain('<<<x');
  });
});
