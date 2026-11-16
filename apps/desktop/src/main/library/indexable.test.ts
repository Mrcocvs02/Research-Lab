import { describe, expect, it } from 'vitest';
import { documentRecordSchema, taxonomyFileSchema, type LibraryStore } from '@rl/core';
import { buildIndexable, indexStamp, makeTaxonomyLookup } from './indexable.js';

const NOW = '2026-01-02T03:04:05.000Z';
const node = (id: string, over: Record<string, unknown> = {}) => ({ id, label: id.toUpperCase(), parents: [], aliases: [], implies: [], status: 'active', origin: 'user', ...over });
const rec = (tags: string[]) => documentRecordSchema.parse({ id: '0000000000000001', hash: 'a'.repeat(64), path: 'a.pdf', size: 1, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, tags });
const src = { notes: { listForDocument: async () => [] }, annotations: { get: async () => null } } as unknown as Pick<LibraryStore, 'notes' | 'annotations'>;

describe('index entry of a document', () => {
  it('keeps the direct tags apart from the implied ones', async () => {
    const lookup = makeTaxonomyLookup(taxonomyFileSchema.parse({ nodes: [node('nn', { implies: ['ml'] }), node('ml')] }));
    const doc = await buildIndexable(src, lookup, rec(['nn']));
    expect(doc.record.tags).toEqual(['nn', 'ml']);
    expect(doc.directTags).toEqual(['nn']);
  });

  it('the stamp changes with the taxonomy parts the document depends on, and only with those', () => {
    const base = [node('a'), node('b', { parents: ['a'] }), node('other')];
    const stamp = (nodes: unknown[], tags = ['b']) => {
      const l = makeTaxonomyLookup(taxonomyFileSchema.parse({ nodes }));
      return indexStamp(rec(tags), l);
    };
    const s = stamp(base);
    expect(stamp(base)).toBe(s);
    expect(stamp([node('a', { label: 'Renamed' }), ...base.slice(1)])).not.toBe(s); // an ancestor's words
    expect(stamp([base[0], node('b', { parents: ['a'], aliases: ['bee'] }), base[2]])).not.toBe(s);
    expect(stamp([base[0], base[1], node('other', { label: 'Changed' })])).toBe(s); // unrelated node
  });
});
