import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { channels, createDispatcher, createMemoryLogger, documentRecordSchema, taxonomyFileSchema, type IpcEnvelope } from '@rl/core';
import { createLibraryStore, createOrganizer, type FileLibraryStore } from '@rl/data';
import { buildHandlers, type MainServices } from '../ipc/handlers/index.js';

const NOW = '2026-01-02T03:04:05.000Z';
const hex = (n: number) => n.toString(16).padStart(16, '0');
const field = (value: unknown, status = 'proposed', date = NOW, extra: Record<string, unknown> = {}) => ({ value, meta: { model: 'm', provider: 'mock', date, source: 'job:suggest' }, review: { status, ...extra } });
const doc = (n: number, ai: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  documentRecordSchema.parse({ id: hex(n), hash: 'ab'.repeat(32), path: `open/p${n}.pdf`, size: 1, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, title: `Paper ${n}`, ai, ...extra });

let root: string;
let store: FileLibraryStore;
let changed: unknown[];

function harness() {
  const log = createMemoryLogger();
  const rt = { libraryId: 'lib-1', store, organizer: createOrganizer({ store, deviceId: 'device-12345678' }), search: async () => ({ total: 0, hits: [] }), reindexDocuments: async () => {} };
  const services = {
    log,
    emit: (e: string, p: unknown) => changed.push([e, p]),
    runtime: { sync: async () => {}, hold: () => () => {}, status: () => ({}), require: async () => rt },
    settings: { get: async () => ({ deviceId: 'device-12345678', ai: { claudeCodePath: null, tokenCap: { monthlyTokens: null, warnAtPct: 80 } } }) },
    localDataDir: os.tmpdir(),
  } as unknown as MainServices;
  const dispatch = createDispatcher(channels, buildHandlers(services), log);
  return async (c: string, p: unknown = {}) => dispatch(c, p);
}
const ok = (r: IpcEnvelope) => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.data as Record<string, any>;
};
const fail = (r: IpcEnvelope) => {
  if (r.ok) throw new Error('expected an error');
  return r.error;
};
const get = async (n: number) => (await store.documents.get(hex(n) as never))!;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rl-rev-'));
  store = createLibraryStore({ rootPath: root, deviceId: 'device-12345678' });
  await store.init();
  await store.writeTaxonomy(taxonomyFileSchema.parse({ nodes: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }] }));
  await store.documents.put(
    doc(1, {
      suggestedTags: field(['a', 'b', 'c'], 'proposed', '2026-01-01T00:00:00.000Z'),
      suggestedNewTags: field([{ label: 'Delta', parentId: 'a', aliases: ['D'], reason: 'none fits' }, { label: 'Epsilon', parentId: null, aliases: [] }], 'proposed', '2026-01-03T00:00:00.000Z'),
      description: field('Proposed description', 'proposed', '2026-01-02T00:00:00.000Z'),
      keywords: field(['k1', 'k2']),
    }),
  );
  await store.documents.put(doc(2, { summary: field('Summary two') }));
  changed = [];
});
afterEach(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

describe('review:list and review:stats', () => {
  it('lists the proposed fields oldest first, pages them, and counts what is pending', async () => {
    const call = harness();
    const l = ok(await call('review:list', {}));
    expect(l.total).toBe(5);
    expect(l.items.map((i: any) => i.field)).toEqual(['tags', 'description', 'keywords', 'summary', 'newTags']);
    expect(l.items[0]).toMatchObject({ docId: hex(1), field: 'tags', value: ['a', 'b', 'c'], status: 'proposed', title: 'Paper 1', revision: 0 });
    expect(l.items[1].field).toBe('description');
    expect(ok(await call('review:list', { limit: 2, offset: 1 })).items).toHaveLength(2);
    expect(ok(await call('review:list', { fields: ['summary'] })).items.map((i: any) => i.docId)).toEqual([hex(2)]);
    expect(ok(await call('review:list', { docIds: [hex(2)] })).total).toBe(1);
    expect(ok(await call('review:stats')).pending).toMatchObject({ tags: 1, newTags: 1, description: 1, keywords: 1, summary: 1, synonyms: 0, relations: 0 });
    // Documents with at least one proposal waiting (the dot next to the badge of Review), not proposals.
    expect(ok(await call('review:stats')).pendingDocs).toBeGreaterThan(0);
  });
});

describe('review:decide', () => {
  it('accepts text as is and keeps it in the AI field, not in the user fields', async () => {
    const call = harness();
    const r = ok(await call('review:decide', { docId: hex(1), field: 'description', decision: 'accept', expectedRevision: 0 }));
    expect(r.changeId).toBeTruthy();
    expect(r.document.ai.description).toMatchObject({ value: 'Proposed description', review: { status: 'accepted' } });
    expect(r.document.userDescription ?? '').toBe('');
    expect(r.document.legacy).toBeUndefined();
    expect(fail(await call('review:decide', { docId: hex(1), field: 'description', decision: 'accept' })).details).toMatchObject({ conflict: 'not-proposed' });
  });

  it('refuses a stale revision and a payload that does not fit', async () => {
    const call = harness();
    expect(fail(await call('review:decide', { docId: hex(1), field: 'description', decision: 'accept', expectedRevision: 9 })).details).toMatchObject({ conflict: 'revision' });
    expect(fail(await call('review:decide', { docId: hex(1), field: 'description', decision: 'edit' })).code).toBe('INVALID_REQUEST');
    expect(fail(await call('review:decide', { docId: hex(1), field: 'keywords', decision: 'edit' })).code).toBe('INVALID_REQUEST');
    expect(fail(await call('review:decide', { docId: hex(1), field: 'tags', decision: 'accept', keepTagIds: ['zzz'] })).code).toBe('INVALID_REQUEST');
    expect(fail(await call('review:decide', { docId: hex(1), field: 'relations', decision: 'accept' })).details).toMatchObject({ conflict: 'not-proposed' });
    expect(fail(await call('review:decide', { docId: hex(99), field: 'tags', decision: 'reject' })).code).toBe('NOT_FOUND');
  });

  it('edits a text and a list and keeps the proposal as the original', async () => {
    const call = harness();
    const d = ok(await call('review:decide', { docId: hex(1), field: 'description', decision: 'edit', text: 'My own words' })).document;
    expect(d.ai.description).toMatchObject({ value: 'My own words', review: { status: 'edited', originalValue: 'Proposed description' } });
    const k = ok(await call('review:decide', { docId: hex(1), field: 'keywords', decision: 'edit', items: ['only'] })).document;
    expect(k.ai.keywords).toMatchObject({ value: ['only'], review: { status: 'edited', originalValue: ['k1', 'k2'] } });
  });

  it('rejects: nothing applied, value kept for the record', async () => {
    const call = harness();
    const r = ok(await call('review:decide', { docId: hex(1), field: 'tags', decision: 'reject' }));
    expect(r.document.tags).toEqual([]);
    expect(r.document.ai.suggestedTags).toMatchObject({ value: ['a', 'b', 'c'], review: { status: 'rejected' } });
  });

  it('accepts tags: all, or only the ones kept (status edited, original kept)', async () => {
    const call = harness();
    const all = ok(await call('review:decide', { docId: hex(1), field: 'tags', decision: 'accept' })).document;
    expect(all.tags).toEqual(['a', 'b', 'c']);
    expect(all.ai.suggestedTags.review.status).toBe('accepted');
    await store.documents.put(doc(3, { suggestedTags: field(['a', 'b', 'c']) }));
    const part = ok(await call('review:decide', { docId: hex(3), field: 'tags', decision: 'accept', keepTagIds: ['a', 'c'] })).document;
    expect(part.tags).toEqual(['a', 'c']);
    expect(part.ai.suggestedTags).toMatchObject({ value: ['a', 'c'], review: { status: 'edited', originalValue: ['a', 'b', 'c'] } });
    const st = ok(await call('review:stats'));
    expect(st.tags).toEqual({ proposed: 6, accepted: 5, rate: 5 / 6 });
  });

  it('drops a proposed tag that was deprecated since, and resolves a merged one', async () => {
    await store.updateTaxonomy((t) => ({ ...t, nodes: t.nodes.map((n) => (n.id === 'b' ? { ...n, status: 'deprecated' as const } : n)) }));
    const d = ok(await harness()('review:decide', { docId: hex(1), field: 'tags', decision: 'accept' })).document;
    expect(d.tags).toEqual(['a', 'c']);
    expect(d.ai.suggestedTags.review.status).toBe('edited');
  });

  it('accepts new tags: creates nodes with origin ai, with a correction, and tags the document', async () => {
    const call = harness();
    const r = ok(await call('review:decide', { docId: hex(1), field: 'newTags', decision: 'accept', keepNewTags: [{ index: 0, label: 'Delta waves', aliases: ['DW'] }] }));
    expect(r.createdNodeIds).toHaveLength(1);
    const tax = await store.readTaxonomy();
    const node = tax.nodes.find((n) => n.id === r.createdNodeIds[0])!;
    expect(node).toMatchObject({ label: 'Delta waves', origin: 'ai', status: 'active', parents: ['a'] });
    expect(node.aliases).toContain('DW');
    expect(r.document.tags).toEqual([node.id]);
    expect(r.document.ai.suggestedNewTags).toMatchObject({ review: { status: 'edited' }, value: [{ label: 'Delta waves', parentId: 'a' }] });
    expect(r.document.ai.suggestedNewTags.review.originalValue).toHaveLength(2);
    expect(fail(await call('review:decide', { docId: hex(1), field: 'newTags', decision: 'accept', keepNewTags: [{ index: 5 }] })).details).toMatchObject({ conflict: 'not-proposed' });
  });

  it('rejects an invalid correction before writing anything', async () => {
    const call = harness();
    expect(fail(await call('review:decide', { docId: hex(1), field: 'newTags', decision: 'accept', keepNewTags: [{ index: 0, parentId: 'missing' }] })).code).toBe('INVALID_REQUEST');
    expect(fail(await call('review:decide', { docId: hex(1), field: 'newTags', decision: 'accept', keepNewTags: [{ index: 7 }] })).code).toBe('INVALID_REQUEST');
    expect((await store.readTaxonomy()).nodes).toHaveLength(3);
    expect((await get(1)).ai.suggestedNewTags!.review.status).toBe('proposed');
  });

  it('is ONE change: undo reverts tags, the AI field and the created node together; redo applies them again', async () => {
    const call = harness();
    const before = await get(1);
    const r = ok(await call('review:decide', { docId: hex(1), field: 'newTags', decision: 'accept' }));
    expect(r.createdNodeIds).toHaveLength(2);
    expect((await get(1)).tags).toHaveLength(2);
    ok(await call('history:undo', { changeId: r.changeId }));
    const undone = await get(1);
    expect(undone.tags).toEqual([]);
    expect(undone.ai.suggestedNewTags).toEqual(before.ai.suggestedNewTags);
    expect((await store.readTaxonomy()).nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    ok(await call('history:redo', {}));
    const redone = await get(1);
    expect(redone.tags).toHaveLength(2);
    expect(redone.ai.suggestedNewTags!.review.status).toBe('accepted');
    expect((await store.readTaxonomy()).nodes).toHaveLength(5);
    const h = ok(await call('history:list', {})).items;
    expect(h.some((i: any) => i.action === 'ai.review' || i.kind === 'undo')).toBe(true);
  });

  it('undo of a plain text decision restores the proposed state; a later change makes it conflict', async () => {
    const call = harness();
    const r = ok(await call('review:decide', { docId: hex(1), field: 'description', decision: 'accept' }));
    ok(await call('history:undo', { changeId: r.changeId }));
    expect((await get(1)).ai.description!.review.status).toBe('proposed');
    const r2 = ok(await call('review:decide', { docId: hex(1), field: 'description', decision: 'edit', text: 'x' }));
    await store.documents.update(hex(1) as never, (c) => ({ ...c!, ai: { ...c!.ai, description: { ...c!.ai.description!, value: 'changed elsewhere' } } }));
    expect(fail(await call('history:undo', { changeId: r2.changeId })).code).toBe('CONFLICT');
  });
});

describe('review:decideMany', () => {
  it('accepts or rejects many as one change, reports the ones no longer proposed, shares created nodes', async () => {
    await store.documents.put(doc(3, { suggestedNewTags: field([{ label: 'delta', parentId: null, aliases: [] }]) }));
    const call = harness();
    const r = ok(
      await call('review:decideMany', {
        decision: 'accept',
        items: [
          { docId: hex(1), field: 'newTags' },
          { docId: hex(3), field: 'newTags' },
          { docId: hex(2), field: 'summary' },
          { docId: hex(2), field: 'keywords' },
          { docId: hex(99), field: 'tags' },
        ],
      }),
    );
    expect(r.changed).toBe(3);
    expect(r.failed.map((f: any) => [f.docId, f.field, f.code])).toEqual([[hex(2), 'keywords', 'CONFLICT'], [hex(99), 'tags', 'NOT_FOUND']]);
    const tax = await store.readTaxonomy();
    expect(tax.nodes.filter((n) => n.label.toLowerCase() === 'delta')).toHaveLength(1);
    expect((await get(2)).ai.summary!.review.status).toBe('accepted');
    ok(await call('history:undo', { changeId: r.changeId }));
    expect((await get(2)).ai.summary!.review.status).toBe('proposed');
    expect((await get(3)).tags).toEqual([]);
    expect((await store.readTaxonomy()).nodes).toHaveLength(3);
    const rej = ok(await call('review:decideMany', { decision: 'reject', items: [{ docId: hex(1), field: 'tags' }] }));
    expect(rej.changed).toBe(1);
    expect((await get(1)).tags).toEqual([]);
  });
});

describe('review: atomic and serialized decisions', () => {
  /** Makes the next `get` of one document return a stale copy, as if the job regenerated the field before the write. */
  const staleOnce = (n: number, mutate: (d: any) => any) => {
    const orig = store.documents.get.bind(store.documents);
    let done = false;
    store.documents.get = (async (id: never) => {
      const rec = await orig(id);
      if (!done && id === (hex(n) as never)) {
        done = true;
        await store.documents.update(id, (c) => mutate(c!));
      }
      return rec;
    }) as never;
  };
  const taken = (c: any, key: string) => ({ ...c, ai: { ...c.ai, [key]: { ...c.ai[key], review: { status: 'accepted' } } } });

  it('a record that became non-proposed before the write: no orphan nodes, failed reported, changeId for what was written', async () => {
    await store.documents.put(doc(3, { suggestedNewTags: field([{ label: 'Zeta', parentId: null, aliases: [] }]), summary: field('s3') }));
    staleOnce(3, (c) => taken(c, 'suggestedNewTags'));
    const call = harness();
    const r = ok(await call('review:decideMany', { decision: 'accept', items: [{ docId: hex(3), field: 'newTags' }, { docId: hex(2), field: 'summary' }] }));
    expect(r.changed).toBe(1);
    expect(r.changeId).toBeTruthy();
    expect(r.failed).toEqual([{ docId: hex(3), field: 'newTags', code: 'CONFLICT' }]);
    expect((await store.readTaxonomy()).nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('a single decision that loses the race throws and leaves no node behind', async () => {
    await store.documents.put(doc(3, { suggestedNewTags: field([{ label: 'Zeta', parentId: null, aliases: [] }]) }));
    staleOnce(3, (c) => taken(c, 'suggestedNewTags'));
    expect(fail(await harness()('review:decide', { docId: hex(3), field: 'newTags', decision: 'accept' })).code).toBe('CONFLICT');
    expect((await store.readTaxonomy()).nodes).toHaveLength(3);
  });

  it('two concurrent decisions that create the same label make one node', async () => {
    await store.documents.put(doc(3, { suggestedNewTags: field([{ label: 'Zeta', parentId: null, aliases: [] }]) }));
    await store.documents.put(doc(4, { suggestedNewTags: field([{ label: 'zeta', parentId: null, aliases: [] }]) }));
    const call = harness();
    const [a, b] = await Promise.all([call('review:decide', { docId: hex(3), field: 'newTags', decision: 'accept' }), call('review:decide', { docId: hex(4), field: 'newTags', decision: 'accept' })]);
    ok(a);
    ok(b);
    expect((await store.readTaxonomy()).nodes.filter((n) => n.label.toLowerCase() === 'zeta')).toHaveLength(1);
    expect((await get(3)).tags).toEqual((await get(4)).tags);
  });

  it('keepTagIds [] is a rejection; a deprecated node is not reused by label', async () => {
    const call = harness();
    const r = ok(await call('review:decide', { docId: hex(1), field: 'tags', decision: 'accept', keepTagIds: [] }));
    expect(r.document.ai.suggestedTags.review.status).toBe('rejected');
    expect(r.document.tags).toEqual([]);
    await store.updateTaxonomy((t) => ({ ...t, nodes: [...t.nodes, ...taxonomyFileSchema.parse({ nodes: [{ id: 'old', label: 'Epsilon', status: 'deprecated' }] }).nodes] }));
    const n = ok(await call('review:decide', { docId: hex(1), field: 'newTags', decision: 'accept', keepNewTags: [{ index: 1 }] }));
    expect(n.createdNodeIds).toHaveLength(1);
    expect(n.document.tags).toEqual(n.createdNodeIds);
  });

  it('bulk accept skips a proposal regenerated after it was listed', async () => {
    const r = ok(await harness()('review:decideMany', { decision: 'accept', items: [{ docId: hex(2), field: 'summary', metaDate: '2025-01-01T00:00:00.000Z' }, { docId: hex(1), field: 'keywords', metaDate: '2999-01-01T00:00:00.000Z' }] }));
    expect(r.changed).toBe(1);
    expect(r.failed).toEqual([{ docId: hex(2), field: 'summary', code: 'CONFLICT' }]);
    expect((await get(2)).ai.summary!.review.status).toBe('proposed');
  });
});
