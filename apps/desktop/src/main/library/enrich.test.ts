import { describe, expect, it } from 'vitest';
import { documentRecordSchema, type DocumentRecord } from '@rl/core';
import { buildIndexable, makeTaxonomyLookup } from './indexable.js';
import { enrichFromExtraction, isExtractedValue } from './enrich.js';

const NOW = '2026-01-01T00:00:00.000Z';
const rec = (over: Partial<DocumentRecord> = {}): DocumentRecord =>
  documentRecordSchema.parse({
    schemaVersion: 1,
    id: 'aaaaaaaaaaaaaaaa',
    hash: 'a'.repeat(64),
    path: 'folder/some_file_name.pdf',
    size: 1,
    mtimeMs: 1,
    addedAt: NOW,
    updatedAt: NOW,
    ...over,
  });
const meta = { title: 'A Study of Things', authors: ['Ada Lovelace'], year: 1843, doi: '10.1000/xyz', arxivId: '1234.5678', pageCount: 3 };

describe('enrichFromExtraction (defect 7)', () => {
  it('fills the empty fields, records them as extracted, and never writes the file name as a title', () => {
    const out = enrichFromExtraction(rec(), meta, () => NOW)!;
    expect(out).toMatchObject({ title: 'A Study of Things', authors: ['Ada Lovelace'], year: 1843, doi: '10.1000/xyz', arxivId: '1234.5678' });
    expect(out.extracted).toEqual({ title: 'A Study of Things', authors: ['Ada Lovelace'], year: 1843, doi: '10.1000/xyz', arxivId: '1234.5678' });
    expect(isExtractedValue(out, 'title')).toBe(true);
    // No title found: the title stays empty (the interface shows the file name).
    expect(enrichFromExtraction(rec(), { pageCount: 1 }, () => NOW)).toBeNull();
    expect(enrichFromExtraction(rec(), { authors: ['X'], pageCount: 1 }, () => NOW)!.title).toBeNull();
  });

  it('never overwrites a value of the user or an import, and does not mark it as extracted', () => {
    const out = enrichFromExtraction(rec({ title: 'My own title', year: 2001 }), meta, () => NOW)!;
    expect(out.title).toBe('My own title');
    expect(out.year).toBe(2001);
    expect(out.extracted).toEqual({ authors: ['Ada Lovelace'], doi: '10.1000/xyz', arxivId: '1234.5678' });
    expect(isExtractedValue(out, 'title')).toBe(false);
  });

  it('does not bring back a value the user emptied, and tells an edited value from an extracted one', () => {
    const first = enrichFromExtraction(rec(), meta, () => NOW)!;
    const cleared = { ...first, title: null };
    expect(enrichFromExtraction(cleared, meta, () => NOW)).toBeNull(); // the user's empty title stays empty
    const edited = { ...first, title: 'Corrected title' };
    expect(isExtractedValue(edited, 'title')).toBe(false);
    expect(enrichFromExtraction(edited, { ...meta, title: 'Another guess' }, () => NOW)?.title ?? 'Corrected title').toBe('Corrected title');
    // A field that still holds the guess follows the file when the file changes.
    const follow = enrichFromExtraction(first, { ...meta, title: 'Revised Title' }, () => NOW)!;
    expect(follow.title).toBe('Revised Title');
    expect(follow.extracted?.title).toBe('Revised Title');
    // Nothing new: no write.
    expect(enrichFromExtraction(first, meta, () => NOW)).toBeNull();
  });
});

describe('buildIndexable abstract (defect 7)', () => {
  const src = { notes: { listForDocument: async () => [] }, annotations: { get: async () => null } } as never;
  const tax = makeTaxonomyLookup(null);
  const ai = (status: 'proposed' | 'rejected', value: string) => ({ value, meta: { model: 'm', provider: 'legacy-import', date: NOW, source: 'test' }, review: { status } }) as never;

  it('is an explicit empty string when nothing usable is known after an extraction', async () => {
    expect((await buildIndexable(src, tax, rec(), { abstract: undefined })).abstract).toBe('');
    expect((await buildIndexable(src, tax, rec(), { abstract: 'Found in the text' })).abstract).toBe('Found in the text');
  });

  it('a rejected AI summary is cleared from the index; without any AI text the index keeps its abstract', async () => {
    const rejected = rec({ ai: { summary: ai('rejected', 'machine summary') } as never });
    expect((await buildIndexable(src, tax, rejected)).abstract).toBe('');
    expect((await buildIndexable(src, tax, rec())).abstract).toBeUndefined();
    const accepted = rec({ ai: { summary: ai('proposed', 'machine summary') } as never });
    expect((await buildIndexable(src, tax, accepted, { abstract: 'from text' })).abstract).toBe('machine summary');
  });
});
