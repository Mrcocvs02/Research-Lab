import { describe, expect, it } from 'vitest';
import { BUILTIN_ID, builtinTemplate, figuresBlock, fillTemplate, highlightsBlock, parseTemplate, serializeTemplate, slugOf } from './index.js';

describe('note templates', () => {
  it('fills placeholders, drops unknown and empty ones and collapses the blank lines they leave', () => {
    const body = '# {{titolo}}\n{{autori}} · {{anno}}\n\n{{nulla}}\n\n\n\n{{evidenziazioni}}\n';
    expect(fillTemplate(body, { titolo: 'A paper', autori: 'One, Two', anno: '2020', evidenziazioni: '> q' })).toBe('# A paper\nOne, Two · 2020\n\n> q\n');
    expect(fillTemplate('{{titolo}}', {})).toBe('');
  });

  it('does not expand a placeholder that a value happens to contain', () => {
    expect(fillTemplate('{{titolo}}', { titolo: '{{autori}}', autori: 'x' })).toBe('{{autori}}');
  });

  it('makes a file name from a name', () => {
    expect(slugOf('Nota di Lettura')).toBe('nota-di-lettura');
    expect(slugOf('Più è meglio!')).toBe('piu-e-meglio');
    expect(slugOf('???')).toBe('template');
    expect(slugOf('x'.repeat(200)).length).toBeLessThanOrEqual(56);
  });

  it('keeps the name in a front matter and gives the body back as it was', () => {
    const raw = serializeTemplate('My model', '# {{titolo}}\n');
    expect(parseTemplate('my-model', raw)).toEqual({ id: 'my-model', name: 'My model', body: '# {{titolo}}\n', builtin: false });
    expect(parseTemplate('plain', 'no front matter').name).toBe('plain');
  });

  it('offers the built-in literature template in both languages, with the seven sections', () => {
    for (const lang of ['it', 'en'] as const) {
      const t = builtinTemplate(lang);
      expect(t.id).toBe(BUILTIN_ID);
      expect(t.builtin).toBe(true);
      expect((t.body.match(/^## /gm) ?? []).length).toBe(7);
      for (const key of ['problema', 'contributo', 'metodo', 'risultati', 'dati', 'figure', 'limiti', 'evidenziazioni']) expect(t.body).toContain(`{{${key}}}`);
    }
  });

  it('writes the highlights of the user as quotes with a page link, the crops as a list', () => {
    const id = '0123456789abcdef';
    const anns = [
      { kind: 'highlight', page: 3, text: '  second\n quote ' },
      { kind: 'highlight', page: 1, text: 'first' },
      { kind: 'underline', page: 2, text: '' },
      { kind: 'area', page: 4, text: '', crop: { type: 'figure', caption: 'Fig. 1' } },
    ];
    expect(highlightsBlock(id, anns)).toBe(`> «first» ([p. 1](lab://doc/${id}?page=1))\n> «second quote» ([p. 3](lab://doc/${id}?page=3))`);
    expect(figuresBlock(id, anns)).toBe(`- [p. 4](lab://doc/${id}?page=4) Fig. 1`);
  });
});
