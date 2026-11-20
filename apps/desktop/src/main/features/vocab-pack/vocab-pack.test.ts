import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryLogger, documentRecordSchema, taxonomyFileSchema } from '@rl/core';
import { canonical, createLibraryStore, createOrganizer, type FileLibraryStore } from '@rl/data';
import type { MainServices } from '../../ipc/handlers/services.js';
import { latentOf } from './hook.js';
import { disable, enable, list, materialize, preview, search } from './index.js';
import { releasePack } from './packs.js';
import { readState } from './state.js';

/** The field vocabulary on a synthetic library with the synthetic `test-pack` only (D-516 .. D-519). */
const NOW = '2026-01-02T03:04:05.000Z';
const hex = (n: number) => n.toString(16).padStart(16, '0');
const doc = (n: number, tags: string[]) => documentRecordSchema.parse({ id: hex(n), hash: 'a'.repeat(64), path: `papers/f${n}.pdf`, size: 10, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, tags });
const node = (id: string, label: string, over: Record<string, unknown> = {}) => ({ id, label, parents: [], aliases: [], implies: [], status: 'active', origin: 'user', ...over });
const none = { matches: [], place: [] };

let root: string;
let packs: string;
let store: FileLibraryStore;
let s: MainServices;
const saved = { e2e: process.env['RL_E2E'], dir: process.env['RL_E2E_PACKS_DIR'] };

const snapshot = async () => {
  const { revision: _r, ...tax } = await store.readTaxonomy();
  const docs = (await store.documents.list()).map((d) => ({ id: d.id, tags: d.tags })).sort((a, b) => (a.id < b.id ? -1 : 1));
  return JSON.parse(canonical({ tax, docs })) as unknown;
};

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rl-pack-'));
  packs = path.join(root, 'packs');
  await mkdir(packs);
  await copyFile(new URL('../../../../../../packages/core/src/vocab/test-pack.json', import.meta.url), path.join(packs, 'test-pack.json'));
  process.env['RL_E2E'] = '1';
  process.env['RL_E2E_PACKS_DIR'] = packs;
  releasePack();
  store = createLibraryStore({ rootPath: path.join(root, 'lib'), deviceId: 'dev-1' });
  await store.init();
  await store.writeTaxonomy(
    taxonomyFileSchema.parse({
      nodes: [node('topic', 'Topic', { family: 'many' }), node('inbox', 'To sort'), node('alpha', 'Alpha theory', { parents: ['inbox'] }), node('gamma', 'Gamma flow', { parents: ['inbox'] }), node('other', 'Something else', { parents: ['inbox'] })],
    }),
  );
  await store.documents.put(doc(1, ['alpha', 'other']));
  await store.documents.put(doc(2, ['gamma']));
  await store.documents.put(doc(3, ['other']));
  const organizer = createOrganizer({ store, deviceId: 'dev-1', cacheTtlMs: 0 });
  const rt = { store, organizer, libraryId: 'lib-1', reindexDocuments: async () => {} };
  s = { log: createMemoryLogger(), emit: () => {}, settings: { get: async () => ({ uiLanguage: 'en' }) }, runtime: { require: async () => rt } } as unknown as MainServices;
});
afterEach(async () => {
  releasePack();
  if (saved.e2e === undefined) delete process.env['RL_E2E'];
  else process.env['RL_E2E'] = saved.e2e;
  if (saved.dir === undefined) delete process.env['RL_E2E_PACKS_DIR'];
  else process.env['RL_E2E_PACKS_DIR'] = saved.dir;
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('the list and the preview', () => {
  it('lists the packs from their files, none active, and previews what the pack would do', async () => {
    const l = await list(s, {});
    expect(l.packs.map((p) => p.id)).toEqual(['test-pack']);
    expect(l.active).toBeNull();
    const p = await preview(s, { packId: 'test-pack' });
    expect(p.matches.map((m) => m.nodeId).sort()).toEqual(['alpha', 'gamma']);
    expect(p.matches.every((m) => m.confidence === 'sure')).toBe(true);
    expect(p).toMatchObject({ recognized: 2, papers: 3, papersWithTopic: 2 });
    await expect(preview(s, { packId: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('turning the pack on and off', () => {
  it('links and places as ONE change; turning off with undo gives the taxonomy back as it was', async () => {
    const before = await snapshot();
    const p = await preview(s, { packId: 'test-pack' });
    const r = await enable(s, {
      packId: 'test-pack',
      families: Object.fromEntries(p.families.map((f) => [f.packFamily, f.root])),
      accept: { matches: p.matches.map((m) => ({ nodeId: m.nodeId, conceptId: m.conceptId })), place: p.place },
      reject: [],
    });
    expect(r).toMatchObject({ linked: 2, placed: 2 });
    expect(r.changeId).not.toBeNull();
    const tax = await store.readTaxonomy();
    const alpha = tax.nodes.find((n) => n.id === 'alpha');
    expect(alpha?.pack).toBe('test-pack/topic.alpha-theory');
    expect(alpha?.parents).toEqual(['topic']);
    expect(tax.nodes.find((n) => n.id === 'gamma')?.parents).toEqual(['alpha']);
    // The names stay; the Italian name of the field becomes a variant.
    expect(alpha?.label).toBe('Alpha theory');
    expect(alpha?.aliases).toContain('Teoria alfa');
    expect((await readState(store.dataDir)).packId).toBe('test-pack');
    await expect(enable(s, { packId: 'test-pack', families: {}, accept: none, reject: [] })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    const off = await disable(s, { undo: true });
    expect(off).toEqual({ undone: 1 });
    expect(await snapshot()).toEqual(before);
    expect((await readState(store.dataDir)).packId).toBe('');
  });

  it('"stop using it" keeps the tags and their links, and removes only the state', async () => {
    const p = await preview(s, { packId: 'test-pack' });
    await enable(s, { packId: 'test-pack', families: {}, accept: { matches: p.matches.map((m) => ({ nodeId: m.nodeId, conceptId: m.conceptId, useFieldName: true })), place: [] }, reject: [] });
    const linked = await snapshot();
    expect(await disable(s, { undo: false })).toEqual({ undone: 0 });
    expect(await snapshot()).toEqual(linked);
    expect((await store.readTaxonomy()).nodes.find((n) => n.id === 'alpha')).toMatchObject({ pack: 'test-pack/topic.alpha-theory', label: 'Alpha theory' });
  });

  it('remembers a pair that is not the same and does not propose it again', async () => {
    await enable(s, { packId: 'test-pack', families: {}, accept: none, reject: [['alpha', 'topic.alpha-theory']] });
    expect((await readState(store.dataDir)).rejected).toEqual([['alpha', 'topic.alpha-theory']]);
  });
});

describe('materializing a concept', () => {
  beforeEach(async () => {
    await enable(s, { packId: 'test-pack', families: {}, accept: none, reject: [] });
  });

  it('for the macro-areas (D-561) a concept is made alone under the family root, a value of level 1, without the ancestors it lacks', async () => {
    const { packHooks } = await import('../../graph/macro-run.js');
    const ops = await packHooks(s).materialize!(['topic.beta-states'], [{ op: 'move', id: 'alpha', parents: ['topic.beta-states'] }], 'topic');
    const creates = ops.filter((o) => o.op === 'create');
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({ parents: ['topic'] });
    expect(ops.find((o) => o.op === 'setPack')).toMatchObject({ id: (creates[0] as { id: string }).id, pack: 'test-pack/topic.beta-states' });
    expect(ops.find((o) => o.op === 'move')).toMatchObject({ id: 'alpha', parents: [(creates[0] as { id: string }).id] });
  });

  it('makes the concept and the ancestors it lacks, with the family root, and tags the papers: ONE change', async () => {
    const before = await snapshot();
    const r = await materialize(s, { conceptId: 'topic.beta-spectrum', docIds: [hex(3)] });
    expect(r.created).toHaveLength(3);
    const tax = await store.readTaxonomy();
    const made = (id: string) => tax.nodes.find((n) => n.id === id);
    expect(made(r.nodeId)?.pack).toBe('test-pack/topic.beta-spectrum');
    const chain = [r.nodeId, ...made(r.nodeId)!.parents, ...made(made(r.nodeId)!.parents[0]!)!.parents];
    expect(chain.slice(1).map((id) => made(id)?.pack ?? made(id)?.label)).toEqual(['test-pack/topic.beta-states', 'test-pack/topic.alpha-theory']);
    expect((await store.documents.get(hex(3) as never))?.tags).toContain(r.nodeId);
    // The same concept again is the same tag, and nothing new.
    expect(await materialize(s, { conceptId: 'topic.beta-spectrum' })).toMatchObject({ nodeId: r.nodeId, created: [] });
    const rt = await s.runtime.require();
    await rt.organizer.undo(r.changeId);
    expect(await snapshot()).toEqual(before);
  });

  it('refuses a concept that would go deeper than the tags allow', async () => {
    const rt = await s.runtime.require();
    const tax = await store.readTaxonomy();
    // "Alpha theory" is a tag at level 3 of Topic: its sub-concept would be level 4.
    await rt.organizer.applyTaxonomy(
      [
        { op: 'create', id: 'l1', label: 'One', parents: ['topic'] },
        { op: 'create', id: 'l2', label: 'Two', parents: ['l1'] },
        { op: 'move', id: 'alpha', parents: ['l2'] },
        { op: 'setPack', id: 'alpha', pack: 'test-pack/topic.alpha-theory' },
      ],
      tax.revision,
    );
    await expect(materialize(s, { conceptId: 'topic.beta-states' })).rejects.toMatchObject({ code: 'INVALID_REQUEST', details: { reason: 'depth' } });
  });

  it('finds concepts no tag stands for, for the tag picker', async () => {
    expect((await search(s, { q: 'epsilon' })).items).toMatchObject([{ conceptId: 'topic.epsilon-maps', label: 'Epsilon maps' }]);
    expect((await search(s, { q: 'delta', limit: 1 })).items).toHaveLength(1);
    await materialize(s, { conceptId: 'topic.epsilon-maps' });
    expect((await search(s, { q: 'epsilon' })).items).toEqual([]);
  });

  it('search and materialize need a pack in use', async () => {
    await disable(s, { undo: false });
    await expect(search(s, { q: 'epsilon' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(materialize(s, { conceptId: 'topic.epsilon-maps' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

describe('the field vocabulary in the tagging prompt', () => {
  it('costs nothing without a pack: no state file, no latent concepts', async () => {
    const tax = await store.readTaxonomy();
    expect(await latentOf(store.dataDir, tax, 'en', 'delta chains')).toBeNull();
  });

  it('offers only concepts no tag stands for, never more than 15, and names no library text', async () => {
    await enable(s, { packId: 'test-pack', families: {}, accept: none, reject: [] });
    await materialize(s, { conceptId: 'topic.epsilon-maps' });
    const tax = await store.readTaxonomy();
    const l = await latentOf(store.dataDir, tax, 'en', 'We study delta chains, epsilon maps and gamma flow.');
    expect(l).not.toBeNull();
    const labels = l!.offered.map((o) => o.label);
    expect(labels).toContain('Delta chains');
    expect(labels).not.toContain('Epsilon maps');
    expect(l!.offered.length).toBeLessThanOrEqual(15);
    const short = l!.offered.find((o) => o.label === 'Gamma flow')!.short;
    expect(l!.lookup.byShort(short)).toMatchObject({ label: 'Gamma flow', pack: 'test-pack/topic.gamma-flow' });
    // A short id the prompt did not offer is not accepted.
    expect(l!.lookup.byShort('f999')).toBeNull();
  });
});
