import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { documentRecordSchema, taxonomyFileSchema, type DocumentRecord } from '@rl/core';
import { createLibraryStore, type FileLibraryStore } from './store.js';
import { createOrganizer, type Organizer } from './organize/organizer.js';
import { hex, removeDir, tempDir } from './test-utils.js';

const NOW = '2026-01-02T03:04:05.000Z';
const found = { doi: 'https://doi.org/10.1/Pub', venue: 'Journal Y', venueRef: '12(3):45-67', year: 2025, source: 'openalex' };

let root: string;
let store: FileLibraryStore;
let org: Organizer;
const doc = (): DocumentRecord => documentRecordSchema.parse({ id: hex(1), hash: 'a'.repeat(64), path: 'docs/a.pdf', size: 1, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, year: 2024, arxivId: '2401.01234', publication: { status: 'preprint' } });

beforeEach(async () => {
  root = await tempDir();
  store = createLibraryStore({ rootPath: root, deviceId: 'dev-1' });
  org = createOrganizer({ store, deviceId: 'dev-1', cacheTtlMs: 0 });
  await store.init();
  await store.writeTaxonomy(taxonomyFileSchema.parse({ nodes: [] }));
  await store.documents.put(doc());
});
afterEach(() => removeDir(root));

describe('applyPublished', () => {
  it('writes the published fields as one change that undo restores, and refuses a stale revision', async () => {
    const before = (await store.documents.get(hex(1)))!;
    await expect(org.applyPublished(hex(1), found, before.revision + 5)).rejects.toMatchObject({ code: 'CONFLICT' });
    const r = await org.applyPublished(hex(1), found, before.revision);
    expect(r.record).toMatchObject({ doi: '10.1/Pub', year: 2025, ref: { venue: 'Journal Y', venueRef: '12(3):45-67' }, publication: { status: 'published', source: 'openalex', checkedAt: r.checkedAt } });
    expect(r.reindex).toEqual([hex(1)]);
    await expect(org.applyPublished(hex(1), found, before.revision)).rejects.toMatchObject({ code: 'CONFLICT' });
    const u = await org.undo(r.changeId);
    expect(u.target).toBe(r.changeId);
    const back = (await store.documents.get(hex(1)))!;
    expect(back).toMatchObject({ doi: null, year: 2024, publication: { status: 'preprint' }, arxivId: '2401.01234' });
    expect(back.ref.venue).toBeUndefined();
  });
});
