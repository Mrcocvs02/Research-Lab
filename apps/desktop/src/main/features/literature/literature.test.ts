import { describe, expect, it } from 'vitest';
import { pagesText } from './index.js';
import { cleanLiterature, literatureSchema, literatureSystem, sectionMarkdown, LITERATURE_VERSION } from './prompt.js';
import { parseLiterature, serializeLiterature } from './store.js';

const ID = '0123456789abcdef';

describe('literature note file', () => {
  it('round-trips the draft of the AI', () => {
    const note = { body: '# T\n\n## Problem\nx', review: 'proposed' as const, ai: true, model: 'haiku-x', generatedAt: '2026-11-18T10:00:00.000Z', abstractOnly: false };
    expect(parseLiterature(serializeLiterature(ID, note, LITERATURE_VERSION))).toEqual(note);
  });

  it('keeps the poor note from the title and abstract apart: not AI, abstract only', () => {
    const note = { body: '# T', review: 'approved' as const, ai: false, model: null, generatedAt: null, abstractOnly: true };
    expect(parseLiterature(serializeLiterature(ID, note, LITERATURE_VERSION))).toEqual(note);
    expect(serializeLiterature(ID, note, LITERATURE_VERSION)).toContain('abstractOnly: true');
  });

  it('reads a note written by the analysis pipeline (its front matter has no abstractOnly) as a proposal', () => {
    const raw = `---\ndocId: ${ID}\nai: true\nreview: proposed\nversion: lit-note-v0.2\nmodel: m\ngeneratedAt: 2026-01-02T00:00:00.000Z\nmode: single\n---\nbody\n`;
    expect(parseLiterature(raw)).toMatchObject({ body: 'body', review: 'proposed', ai: true, model: 'm', abstractOnly: false });
  });

  it('has no note when the body is empty', () => {
    expect(parseLiterature('---\nai: true\n---\n\n')).toBeNull();
  });
});

describe('literature prompt and answer', () => {
  it('asks in the language of the library, with the paper marked as data', () => {
    const s = literatureSystem('it');
    expect(s).toContain(LITERATURE_VERSION);
    expect(s).toContain('Italian');
    expect(s).toContain('DATA');
  });

  it('keeps one entry per key in the fixed order, valid pages only, no empty text', () => {
    const raw = literatureSchema.parse({
      sections: [
        { key: 'method', text: '  M  ', pages: [4, 4, 2, 999] },
        { key: 'problem', text: 'P', pages: [1] },
        { key: 'problem', text: 'second problem is ignored', pages: [] },
        { key: 'limits', text: '   ', pages: [] },
      ],
    });
    expect(cleanLiterature(raw, 10)).toEqual([
      { key: 'problem', text: 'P', pages: [1] },
      { key: 'method', text: 'M', pages: [2, 4] },
    ]);
  });

  it('turns the pages into links to the reader, written by us and never by the model', () => {
    expect(sectionMarkdown({ key: 'method', text: 'Does x.', pages: [2, 4] }, ID)).toBe(`Does x. ([p. 2](lab://doc/${ID}?page=2), [p. 4](lab://doc/${ID}?page=4))`);
    expect(sectionMarkdown({ key: 'data', text: 'None.', pages: [] }, ID)).toBe('None.');
  });

  it('marks every page and shortens long pages so that the whole fits', () => {
    const text = pagesText(
      [
        { page: 1, text: 'a'.repeat(5000) },
        { page: 2, text: 'b' },
      ],
      1000,
    );
    expect(text).toContain('[page 1]');
    expect(text).toContain('[page 2]');
    expect(text.length).toBeLessThan(1200);
  });
});
