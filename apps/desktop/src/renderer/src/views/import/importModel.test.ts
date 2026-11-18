import { describe, expect, it } from 'vitest';
import { bibFileName, defaultChoices, reasonKey, type Analysis } from './importModel';

const analysis = (over: Partial<Analysis> = {}): Analysis => ({ previewId: 'p', source: 'bibtex', entries: 10, inLibrary: 2, withFile: 3, noFile: 5, tags: 4, notes: 0, collections: [], ...over });

describe('import choices', () => {
  it('offers what the file has: tags, notes, queued files, collections as projects', () => {
    expect(defaultChoices(analysis())).toEqual({ tags: true, notes: false, queueFiles: true, collections: 'ignore' });
    expect(defaultChoices(analysis({ tags: 0, notes: 2, withFile: 0, collections: [{ name: 'A', count: 1 }] }))).toEqual({ tags: false, notes: true, queueFiles: false, collections: 'projects' });
  });

  it('names the linked file from the project name, letters and digits only', () => {
    expect(bibFileName('Tesi: capitolo 2 / études')).toBe('Tesi-capitolo-2-etudes.bib');
    expect(bibFileName('???')).toBe('references.bib');
  });

  it('maps unknown reasons to "other"', () => {
    expect(reasonKey('no-file')).toBe('no-file');
    expect(reasonKey('weird')).toBe('other');
  });
});
