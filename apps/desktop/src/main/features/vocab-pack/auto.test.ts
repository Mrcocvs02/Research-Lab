import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryLogger, documentRecordSchema, taxonomyFileSchema } from '@rl/core';
import { canonical, createLibraryStore, createOrganizer, type FileLibraryStore } from '@rl/data';
import type { MainServices } from '../../ipc/handlers/services.js';
import { autoApply } from './auto.js';
import { disable, enable, list, preview } from './index.js';
import { releasePack } from './packs.js';
import { readState } from './state.js';

/** The field vocabulary applied by itself (D-565) on a synthetic library with the synthetic `test-pack` only. */
const NOW = '2026-01-02T03:04:05.000Z';
const hex = (n: number) => n.toString(16).padStart(16, '0');
const doc = (n: number, tags: string[]) => documentRecordSchema.parse({ id: hex(n), hash: 'a'.repeat(64), path: `papers/f${n}.pdf`, size: 10, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, tags });
const node = (id: string, label: string, over: Record<string, unknown> = {}) => ({ id, label, parents: [], aliases: [], implies: [], status: 'active', origin: 'user', ...over });

/** Tags the test pack knows (sure), a typo it only half knows, and tags it does not know. */
const KNOWN: Array<[string, string, string[]]> = [
  ['alpha', 'Alpha theory', ['inbox']],
  ['gamma', 'Gamma flow', ['inbox', 'misc']],
  ['dsys', 'Delta systems', ['inbox']],
  ['dchains', 'Delta chains', ['inbox']],
  ['eps', 'Epsilon maps', ['inbox']],
  ['eta', 'Eta model', ['inbox']],
  ['bspec', 'Beta spectrum', ['inbox']],
  ['samp', 'Sampling methods', ['inbox']],
  ['fast', 'Fast sampling', ['inbox']],
];

let root: string;
let packs: string;
let store: FileLibraryStore;
let s: MainServices;
let events: Array<{ name: string; payload: unknown }>;
const saved = { e2e: process.env['RL_E2E'], dir: process.env['RL_E2E_PACKS_DIR'] };

const snapshot = async () => {
  const { revision: _r, ...tax } = await store.readTaxonomy();
  const docs = (await store.documents.list()).map((d) => ({ id: d.id, tags: d.tags })).sort((a, b) => (a.id < b.id ? -1 : 1));
  return JSON.parse(canonical({ tax, docs })) as unknown;
};
const nodes = async () => new Map((await store.readTaxonomy()).nodes.map((n) => [n.id, n]));

async function library(known: ReadonlyArray<[string, string, string[]]>) {
  await store.writeTaxonomy(
    taxonomyFileSchema.parse({
      nodes: [
        node('topic', 'Topic', { family: 'many' }),
        node('inbox', 'To sort'),
        node('misc', 'Miscellaneous'),
        node('zeta', 'Zeta solvr', { parents: ['inbox'] }),
        node('other', 'Something else', { parents: ['inbox'] }),
        ...known.map(([id, label, parents]) => node(id, label, { parents })),
      ],
    }),
  );
  await store.documents.put(doc(1, ['alpha', 'zeta']));
  await store.documents.put(doc(2, ['gamma', 'bspec']));
  await store.documents.put(doc(3, ['other', 'dchains']));
  await store.documents.put(doc(4, ['dchain']));
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rl-pack-auto-'));
  packs = path.join(root, 'packs');
  await mkdir(packs);
  await copyFile(new URL('../../../../../../packages/core/src/vocab/test-pack.json', import.meta.url), path.join(packs, 'test-pack.json'));
  process.env['RL_E2E'] = '1';
  process.env['RL_E2E_PACKS_DIR'] = packs;
  releasePack();
  store = createLibraryStore({ rootPath: path.join(root, 'lib'), deviceId: 'dev-1' });
  await store.init();
  events = [];
  const organizer = createOrganizer({ store, deviceId: 'dev-1', cacheTtlMs: 0 });
  const rt = { store, organizer, libraryId: 'lib-1', reindexDocuments: async () => {} };
  s = { log: createMemoryLogger(), emit: (name: string, payload: unknown) => events.push({ name, payload }), settings: { get: async () => ({ uiLanguage: 'en' }) }, runtime: { require: async () => rt } } as unknown as MainServices;
});
afterEach(async () => {
  releasePack();
  if (saved.e2e === undefined) delete process.env['RL_E2E'];
  else process.env['RL_E2E'] = saved.e2e;
  if (saved.dir === undefined) delete process.env['RL_E2E_PACKS_DIR'];
  else process.env['RL_E2E_PACKS_DIR'] = saved.dir;
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('when the pack applies itself', () => {
  it('does nothing below the threshold: fewer than 8 tags sure-match', async () => {
    await library(KNOWN.slice(0, 5));
    expect((await preview(s, { packId: 'test-pack' })).matches.filter((m) => m.confidence === 'sure').length).toBeLessThan(8);
    expect(await autoApply(s)).toBeNull();
    expect((await readState(store.dataDir)).packId).toBe('');
    expect(events).toEqual([]);
  });

  it('needs a tenth of the tags as well: many unrelated tags keep it off', async () => {
    await library(KNOWN);
    const tax = await store.readTaxonomy();
    const many = Array.from({ length: 100 }, (_, i) => node(`x${i}`, `Unrelated ${String.fromCharCode(97 + (i % 26))}${i}q`, { parents: ['inbox'] }));
    await store.writeTaxonomy({ ...tax, nodes: [...tax.nodes, ...many] } as never);
    expect(await autoApply(s)).toBeNull();
  });

  it('applies the sure matches in ONE change: links, a merge, the pack parents; likely ones stay proposals', async () => {
    await library(KNOWN);
    await store.documents.put(doc(5, ['dchain']));
    await store.writeTaxonomy({ ...(await store.readTaxonomy()), nodes: [...(await store.readTaxonomy()).nodes, node('dchain', 'Delta chain', { parents: ['inbox'] })] } as never);


    const r = await autoApply(s);
    expect(r).toMatchObject({ packId: 'test-pack' });
    expect(r!.n).toBeGreaterThanOrEqual(10);

    const tax = await nodes();
    // Linked, with the names of the field as variants; the user's names stay.
    expect(tax.get('alpha')).toMatchObject({ pack: 'test-pack/topic.alpha-theory', label: 'Alpha theory', parents: ['topic'] });
    expect(tax.get('alpha')?.aliases).toContain('Teoria alfa');
    // The pack placement wins: the old parents are gone (gamma had two).
    expect(tax.get('gamma')?.parents).toEqual(['alpha']);
    // "Delta chain" and "Delta chains" are one tag now, the most used one (the other becomes a variant), and the papers follow.
    expect(tax.has('dchains')).toBe(false);
    expect(tax.get('dchain')).toMatchObject({ pack: 'test-pack/topic.delta-chains', parents: ['dsys'] });
    expect(tax.get('dchain')?.aliases).toContain('Delta chains');
    expect((await store.documents.get(hex(3) as never))?.tags).toEqual(['other', 'dchain']);
    // The ancestor a used tag lacks is made, linked: Topic > Alpha theory > Beta states > Beta spectrum.
    const spec = tax.get('bspec');
    expect(spec?.pack).toBe('test-pack/topic.beta-spectrum');
    const states = tax.get(spec!.parents[0]!);
    expect(states).toMatchObject({ label: 'Beta states', pack: 'test-pack/topic.beta-states', parents: ['alpha'] });
    // A family the library lacks gets its root at first use, and the tags go under it.
    const method = [...tax.values()].find((n) => n.label === 'Method');
    expect(method).toMatchObject({ family: 'one', parents: [] });
    expect(tax.get('fast')?.parents).toEqual(['samp']);
    expect(tax.get('samp')?.parents).toEqual([method!.id]);
    // Latent concepts with no paper are not tags; the half-known tag is not linked.
    expect([...tax.values()].some((n) => n.label === 'Epsilon maps' && n.id !== 'eps')).toBe(false);
    expect(tax.get('zeta')).toMatchObject({ parents: ['inbox'] });
    expect(tax.get('zeta')?.pack).toBeUndefined();
    expect(tax.get('other')?.pack).toBeUndefined();

    const st = await readState(store.dataDir);
    expect(st).toMatchObject({ packId: 'test-pack', changeIds: [r!.changeId], auto: { n: r!.n, changeId: r!.changeId } });
    expect(events.filter((e) => e.name === 'vocabPack:autoApplied')).toEqual([{ name: 'vocabPack:autoApplied', payload: { n: r!.n, changeId: r!.changeId, at: st.auto!.at } }]);
    // The likely and the maybe are still proposals of the pack dialog, never applied.
    const p = await preview(s, { packId: 'test-pack' });
    expect(p.matches.every((m) => m.confidence !== 'sure')).toBe(true);
  });

  it('merges a tag and its short name that reach one concept, as part of the same single change (D-571)', async () => {
    await library([...KNOWN, ['eta2', 'Eta', ['inbox']]]);
    await store.documents.put(doc(6, ['eta2']));
    const r = await autoApply(s);
    expect(r).not.toBeNull();
    const tax = await nodes();
    // Two tags, one concept: "Eta" and "Eta model" are one tag now (the more used one; the papers follow), and it is the only linked one.
    const eta = [...tax.values()].filter((n) => n.pack === 'test-pack/topic.eta-model');
    expect(eta).toHaveLength(1);
    expect(tax.has('eta') && tax.has('eta2')).toBe(false);
    expect([eta[0]!.label, ...eta[0]!.aliases]).toEqual(expect.arrayContaining(['Eta', 'Eta model']));
    expect((await readState(store.dataDir)).changeIds).toEqual([r!.changeId]);
  });

  it('the parts of a combined concept are different concepts: two tags on two parts are linked to two concepts, never merged (D-571)', async () => {
    await library([...KNOWN, ['lam', 'Lambda methods', ['inbox']], ['mu', 'Mu methods', ['inbox']]]);
    await store.documents.put(doc(6, ['lam', 'mu']));
    expect(await autoApply(s)).not.toBeNull();
    const tax = await nodes();
    expect(tax.get('lam')?.pack).toBe('test-pack/topic.lambda-methods');
    expect(tax.get('mu')?.pack).toBe('test-pack/topic.mu-methods');
    // Both sit under the combined concept, which became a tag because papers use them.
    const combined = tax.get('lam')!.parents[0]!;
    expect(tax.get(combined)).toMatchObject({ pack: 'test-pack/topic.lambda-and-mu' });
    expect(tax.get('mu')?.parents).toEqual([combined]);
  });

  it('never twice, and the review can still take more of the pack', async () => {
    await library(KNOWN);
    expect(await autoApply(s)).not.toBeNull();
    expect(await autoApply(s)).toBeNull();
    const again = await enable(s, { packId: 'test-pack', families: {}, accept: { matches: [], place: [] }, reject: [] });
    expect(again.changeId).toBeNull();
    expect((await readState(store.dataDir)).packId).toBe('test-pack');
  });

  it('undo gives the taxonomy and the papers back as they were, and the pack never applies itself again', async () => {
    await library(KNOWN);
    await store.documents.put(doc(5, ['dchain']));
    await store.writeTaxonomy({ ...(await store.readTaxonomy()), nodes: [...(await store.readTaxonomy()).nodes, node('dchain', 'Delta chain', { parents: ['inbox'] })] } as never);
    const before = await snapshot();
    const r = await autoApply(s);
    expect(r).not.toBeNull();
    expect(await snapshot()).not.toEqual(before);
    expect(await disable(s, { undo: true })).toEqual({ undone: 1 });
    expect(await snapshot()).toEqual(before);
    const st = await readState(store.dataDir);
    expect(st).toMatchObject({ packId: '', dismissed: true });
    expect(await autoApply(s)).toBeNull();
    expect(await snapshot()).toEqual(before);
  });

  it('never applies to a library that turned the pack off, or dismissed the suggestion', async () => {
    await library(KNOWN);
    await list(s, { dismiss: true });
    expect(await autoApply(s)).toBeNull();
    expect((await readState(store.dataDir)).packId).toBe('');
  });

  it('never applies to a library that already turned it on by hand', async () => {
    await library(KNOWN);
    await enable(s, { packId: 'test-pack', families: {}, accept: { matches: [], place: [] }, reject: [] });
    await disable(s, { undo: false });
    expect(await autoApply(s)).toBeNull();
  });
});
