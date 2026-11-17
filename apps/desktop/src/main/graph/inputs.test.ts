import { describe, expect, it } from 'vitest';
import type { DocumentRecord, LibraryStore } from '@rl/core';
import { MAX_GRAPH_DOCS, loadGraphDocs } from './inputs.js';

const record = (i: number): DocumentRecord =>
  ({ id: i.toString(16).padStart(16, '0'), hash: 'h'.repeat(64), path: `f/p${i}.pdf`, title: `Title number ${i} about kelp forests`, tags: [], ai: {}, missing: false, revision: 1 }) as unknown as DocumentRecord;

const store = (records: DocumentRecord[], citations: unknown[] = []) =>
  ({
    documents: { list: async () => records },
    citations: { list: async () => citations },
    readTaxonomy: async () => null,
  }) as unknown as Pick<LibraryStore, 'documents' | 'citations' | 'readTaxonomy'>;

describe('loadGraphDocs', () => {
  it('counts the words of each document as it is read and keeps no text', async () => {
    const docs = await loadGraphDocs(store([record(1), record(2)]));
    expect(docs).toHaveLength(2);
    for (const d of docs) {
      expect(d.title).toBe('');
      expect(d.text).toBe('');
      expect(d.packed?.t.length).toBeGreaterThan(0);
      expect(d.dict).toBe(docs[0]!.dict);
    }
    expect(docs[0]!.dict!.terms).toContain('kelp');
  });

  it('refuses a library with more documents than the graph handles, with a reason the interface can show', async () => {
    const many = Array.from({ length: MAX_GRAPH_DOCS + 1 }, (_, i) => ({ ...record(i), title: '' }));
    await expect(loadGraphDocs(store(many))).rejects.toMatchObject({ code: 'INVALID_REQUEST', details: { reason: 'too-large', limit: MAX_GRAPH_DOCS } });
  });

  it('cuts a huge citation list to the cap and counts the documents it did that to', async () => {
    const link = (i: number) => ({ doi: `10.5/${String(i).padStart(5, '0')}`, authors: [], matchedDocId: null, source: 'manual', checkedAt: '2026-01-01T00:00:00.000Z' });
    const file = { docId: record(1).id, references: Array.from({ length: 500 }, (_, i) => link(i)), citedBy: [] };
    const stats = { trimmedCitations: 0 };
    const [d] = await loadGraphDocs(store([record(1), record(2)], [file]), { stats });
    expect(d!.refs).toHaveLength(200);
    expect(stats.trimmedCitations).toBe(1);
  });
});
