import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockAiProvider } from '@rl/ai';
import { createMemoryLogger, documentRecordSchema, taxonomyFileSchema } from '@rl/core';
import { canonical, createLibraryStore, createOrganizer, type FileLibraryStore } from '@rl/data';
import { reviewTags, type Proposal } from '@rl/data/tag-vocabulary';
import type { MainServices } from '../../ipc/handlers/services.js';
import { aiSchema, decide } from './ai.js';
import { acceptableIds } from './auto.js';
import { applyReview, autoAccept, getReview, runApply, setAuto } from './index.js';
import { load } from './state.js';

const NOW = '2026-01-02T03:04:05.000Z';
const hex = (n: number) => n.toString(16).padStart(16, '0');
const doc = (n: number, tags: string[]) => documentRecordSchema.parse({ id: hex(n), hash: 'a'.repeat(64), path: `papers/f${n}.pdf`, size: 10, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, tags });
const node = (id: string, label: string, over: Record<string, unknown> = {}) => ({ id, label, parents: [], aliases: [], implies: [], status: 'active', origin: 'user', ...over });
const prop = (id: string, tags: string[], over: Partial<Proposal> = {}): Proposal => ({ id, kind: 'merge', tags, keep: tags[0], confidence: 'sure', reason: 'form', evidence: { papers: {}, shared: 0, jaccard: 0 }, ...over }) as Proposal;

describe('acceptable proposals (D-512)', () => {
  const nodes = [
    node('a', 'A'), node('b', 'B'), node('c', 'C'), node('d', 'D'),
    node('fam1', 'F1', { family: 'many' }), node('fam2', 'F2', { family: 'one' }), node('kw', 'KW', { family: 'keywords' }),
    node('x1', 'X1', { parents: ['fam1'] }), node('x2', 'X2', { parents: ['fam2'] }), node('k1', 'K1', { parents: ['kw'] }),
    node('mac', 'Macro', { group: 'macro' }),
  ] as never;
  const list = [
    prop('sure-merge', ['a', 'b']),
    prop('likely-merge', ['c', 'd'], { confidence: 'likely' }),
    prop('maybe-merge', ['a', 'c'], { confidence: 'maybe' }),
    prop('sure-name', ['a'], { kind: 'name', tags: ['a'], label: 'A' }),
    prop('likely-name', ['c'], { kind: 'name', tags: ['c'], label: 'C', confidence: 'likely' }),
    prop('likely-parent', ['a', 'c'], { kind: 'parent', confidence: 'likely' }),
    prop('cross-family', ['x1', 'x2'], { confidence: 'likely' }),
    prop('macro-keyword', ['mac', 'k1'], { confidence: 'likely' }),
    prop('macro-twins-keywords', ['mac', 'd'], { kind: 'twins', confidence: 'likely', action: 'keywords' }),
    prop('distinct-pair', ['c', 'b'], { confidence: 'likely' }),
  ];
  const distinct = [{ a: 'b', b: 'c' }];

  it('"all" takes sure and likely, never maybe, and none of the guarded ones', () => {
    expect(acceptableIds(list, nodes, distinct, 'all').sort()).toEqual(['likely-merge', 'likely-name', 'likely-parent', 'sure-merge', 'sure-name']);
  });
  it('"sure" takes only the sure merges and names', () => {
    expect(acceptableIds(list, nodes, distinct, 'sure').sort()).toEqual(['sure-merge', 'sure-name']);
  });
  it('overlapping proposals are not both taken: a tag removed by one merge is not touched by another', () => {
    const o = [prop('m1', ['a', 'b']), prop('m2', ['b', 'c'], { confidence: 'likely' }), prop('n1', ['b'], { kind: 'name', tags: ['b'], label: 'B' })];
    expect(acceptableIds(o, nodes, undefined, 'all')).toEqual(['m1']);
  });
  it('guardrails hold for sure proposals too', () => {
    const sure = [prop('s1', ['x1', 'x2']), prop('s2', ['b', 'c']), prop('s3', ['mac', 'k1'])];
    expect(acceptableIds(sure, nodes, distinct, 'sure')).toEqual([]);
  });
});

describe('accept all and automatic acceptance (D-512)', () => {
  let root: string;
  let store: FileLibraryStore;
  let s: MainServices;
  const snapshot = async () => {
    const { revision: _r, ...tax } = await store.readTaxonomy();
    const docs = (await store.documents.list()).map((d) => ({ id: d.id, tags: d.tags, tagOrigin: d.tagOrigin ?? null })).sort((a, b) => (a.id < b.id ? -1 : 1));
    return canonical({ tax, docs });
  };
  const nodesNow = async () => (await store.readTaxonomy()).nodes.filter((n) => n.status === 'active').map((n) => n.id);

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'rl-tagauto-'));
    store = createLibraryStore({ rootPath: root, deviceId: 'dev-1' });
    await store.init();
    await store.writeTaxonomy(taxonomyFileSchema.parse({ nodes: [node('concetto', 'concetto'), node('concetti', 'concetti'), node('other', 'other')] }));
    await store.documents.put(doc(1, ['concetto', 'other']));
    await store.documents.put(doc(2, ['concetti']));
    await store.documents.put(doc(3, ['concetto', 'concetti']));
    const organizer = createOrganizer({ store, deviceId: 'dev-1', cacheTtlMs: 0 });
    const rt = { store, organizer, reindexDocuments: async () => {} };
    s = { log: createMemoryLogger(), emit: () => {}, runtime: { require: async () => rt } } as unknown as MainServices;
  });
  afterEach(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

  it('the list offers acceptable proposals; Accept all is one change and one undo restores the library byte for byte', async () => {
    const before = await snapshot();
    const view = await getReview(s, {});
    expect(view.acceptable.length).toBeGreaterThan(0);
    const items = view.proposals.filter((p) => view.acceptable.includes(p.id)).map((p) => ({ id: p.id, ...(p.keep ? { keep: p.keep } : {}), ...(p.label ? { label: p.label } : {}) }));
    const r = await applyReview(s, { items, expectedRevision: view.revision });
    expect(r.changeId).not.toBe('');
    expect(await snapshot()).not.toBe(before);
    const rt = await s.runtime.require();
    await rt.organizer.undo(r.changeId);
    expect(JSON.parse(await snapshot())).toEqual(JSON.parse(before));
  });

  it('off (default) does nothing', async () => {
    const before = await snapshot();
    expect((await getReview(s, {})).auto).toEqual({ mode: 'off', last: null, haiku: null });
    expect(await autoAccept(s)).toBe(0);
    expect(await snapshot()).toBe(before);
  });

  for (const mode of ['sure', 'all'] as const) {
    it(`"${mode}" applies the new proposals as one logged change, tells how many, undoes cleanly and does not come back`, async () => {
      const before = await snapshot();
      await setAuto(s, { mode });
      const n = await autoAccept(s);
      expect(n).toBeGreaterThan(0);
      expect(await nodesNow()).toHaveLength(2);
      const view = await getReview(s, {});
      expect(view.auto.mode).toBe(mode);
      expect(view.auto.last).toMatchObject({ n, sure: expect.any(Number), likely: expect.any(Number) });
      const rt = await s.runtime.require();
      await rt.organizer.undo(view.auto.last?.changeId as string);
      expect(JSON.parse(await snapshot())).toEqual(JSON.parse(before));
      // the undone proposals are not taken again behind the user's back
      expect(await autoAccept(s)).toBe(0);
      expect(JSON.parse(await snapshot())).toEqual(JSON.parse(before));
      expect((await setAuto(s, { dismiss: true })).last).toBeNull();
    });
  }
});

describe('Haiku decides (D-512), with the mock AI', () => {
  let root: string;
  let store: FileLibraryStore;
  let s: MainServices;
  const snapshot = async () => {
    const { revision: _r, ...tax } = await store.readTaxonomy();
    const docs = (await store.documents.list()).map((d) => ({ id: d.id, tags: d.tags, tagOrigin: d.tagOrigin ?? null })).sort((a, b) => (a.id < b.id ? -1 : 1));
    return canonical({ tax, docs });
  };
  /** The pairs Haiku would be asked about. */
  async function pairs() {
    const { loaded } = await load(s);
    const review = reviewTags(loaded.input);
    const fresh = review.proposals.filter((p) => p.kind === 'merge' && p.tags.length === 2);
    const labels = new Map(loaded.tax.nodes.map((n) => [n.id, n.label]));
    const p = { fresh, input: loaded.input, review, labels } as unknown as Parameters<typeof decide>[0];
    return { p, fresh, loaded };
  }
  /** What the mock AI answers, parsed with the schema of the real request. */
  const ask = async (answers: unknown[]) => {
    const mock = createMockAiProvider({ structured: { answers } });
    return (await mock.completeStructured({ model: 'claude-haiku-5-5', reasoning: 'off' as never, system: '', prompt: '', schema: aiSchema, source: 'tag-review' })).value.answers;
  };
  const withInput = (p: Parameters<typeof decide>[0], over: Record<string, unknown>) => ({ ...p, input: { ...(p as unknown as { input: object }).input, ...over } }) as unknown as Parameters<typeof decide>[0];

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'rl-taghaiku-'));
    store = createLibraryStore({ rootPath: root, deviceId: 'dev-1' });
    await store.init();
    await store.writeTaxonomy(taxonomyFileSchema.parse({ nodes: [node('concetto', 'concetto'), node('concetti', 'concetti'), node('other', 'other')] }));
    await store.documents.put(doc(1, ['concetto', 'other']));
    await store.documents.put(doc(2, ['concetti']));
    const organizer = createOrganizer({ store, deviceId: 'dev-1', cacheTtlMs: 0 });
    const rt = { store, organizer, reindexDocuments: async () => {} };
    s = { log: createMemoryLogger(), emit: () => {}, runtime: { require: async () => rt } } as unknown as MainServices;
  });
  afterEach(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

  it('a confident "same" merges into the name Haiku keeps, as one change that undoes byte for byte', async () => {
    const before = await snapshot();
    const { p, fresh, loaded } = await pairs();
    expect(fresh.length).toBeGreaterThan(0);
    const answers = await ask([{ n: 1, verdict: 'same', note: 'plural of the same word', keep: 'B', confidence: 'high' }]);
    const d = await decide(p, answers, new Set());
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ kind: 'merge', note: 'plural of the same word' });
    const keep = (fresh[0] as { tags: string[] }).tags[1] as string;
    const r = await runApply(s, d.ops, d.docEdits, 'Haiku decisions on the vocabulary (1)', loaded.tax.revision);
    const nodes = (await store.readTaxonomy()).nodes.filter((n) => n.status === 'active').map((n) => n.id);
    expect(nodes).toContain(keep);
    expect(nodes).toHaveLength(2);
    await (await s.runtime.require()).organizer.undo(r.changeId);
    expect(JSON.parse(await snapshot())).toEqual(JSON.parse(before));
  });

  it('low confidence, missing confidence and "related" stay for the user', async () => {
    const { p } = await pairs();
    for (const a of [{ n: 1, verdict: 'same', note: 'x', keep: 'A', confidence: 'low' }, { n: 1, verdict: 'same', note: 'x', keep: 'A' }, { n: 1, verdict: 'related', note: 'x', confidence: 'high' }]) {
      expect((await decide(p, await ask([a]), new Set())).ops).toEqual([]);
    }
  });

  it('"different" marks the pair distinct and "broader" moves one under the other', async () => {
    const { p, fresh } = await pairs();
    const [x, y] = (fresh[0] as { tags: string[] }).tags as [string, string];
    expect((await decide(p, await ask([{ n: 1, verdict: 'different', note: 'n', confidence: 'high' }]), new Set())).ops).toEqual([{ op: 'markDistinct', a: x, b: y }]);
    expect((await decide(p, await ask([{ n: 1, verdict: 'broader', note: 'n', confidence: 'high' }]), new Set())).ops).toEqual([{ op: 'move', id: y, parents: [x] }]);
  });

  it('guardrails hold against a confident Haiku: distinct pairs, other families, a macro-area under keywords, tags already taken', async () => {
    const { p, fresh } = await pairs();
    const [x, y] = (fresh[0] as { tags: string[] }).tags as [string, string];
    const same = await ask([{ n: 1, verdict: 'same', note: 'n', keep: 'A', confidence: 'high' }]);
    const nodes = (p as unknown as { input: { nodes: Array<Record<string, unknown>> } }).input.nodes;
    expect((await decide(withInput(p, { distinct: [{ a: x, b: y }] }), same, new Set())).ops).toEqual([]);
    const fam = nodes.map((n) => (n['id'] === x ? { ...n, family: 'many' } : n['id'] === y ? { ...n, family: 'one' } : n));
    expect((await decide(withInput(p, { nodes: fam }), same, new Set())).ops).toEqual([]);
    // a macro-area is never put under keywords
    const kw = nodes.map((n) => (n['id'] === 'other' ? { ...n, family: 'keywords' } : n['id'] === x ? { ...n, group: 'macro' } : n));
    const under = await ask([{ n: 1, verdict: 'narrower', note: 'n', confidence: 'high' }]);
    const q = { ...withInput(p, { nodes: kw }), fresh: [{ ...(fresh[0] as object), tags: [x, 'other'] }] } as unknown as Parameters<typeof decide>[0];
    expect((await decide(q, under, new Set())).ops).toEqual([]);
    expect((await decide(p, same, new Set([x]))).ops).toEqual([]);
  });

  it('the automatic mode "sure + Haiku" is a mode of its own, is saved, and takes only the sure ones by itself', async () => {
    expect((await setAuto(s, { mode: 'sureHaiku' })).mode).toBe('sureHaiku');
    expect((await getReview(s, {})).auto.mode).toBe('sureHaiku');
    const nodes = [node('a', 'A'), node('b', 'B'), node('c', 'C'), node('d', 'D')] as never;
    expect(acceptableIds([prop('m', ['a', 'b']), prop('l', ['c', 'd'], { confidence: 'likely' })], nodes, undefined, 'sureHaiku')).toEqual(['m']);
  });
});
