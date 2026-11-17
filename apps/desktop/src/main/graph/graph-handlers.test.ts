import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockAiProvider, type MockScript } from '@rl/ai';
import { channels, createDispatcher, createMemoryLogger, defaultLibraryConfig, documentRecordSchema, taxonomyFileSchema, type IpcEnvelope, type LibraryConfig } from '@rl/core';
import { createLibraryStore, type FileLibraryStore } from '@rl/data';
import { syntheticDocs } from '@rl/graph/testing';
import { buildHandlers, type MainServices } from '../ipc/handlers/index.js';
import { whenBuilt } from './service.js';

const NOW = '2026-01-02T03:04:05.000Z';
const hex = (n: number) => n.toString(16).padStart(16, '0');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const aiField = (value: unknown, status = 'accepted') => ({ value, meta: { model: 'm', provider: 'mock', date: NOW, source: 'job:suggest' }, review: { status } });
const COUNT = 60;
const DOCS = syntheticDocs(COUNT, { topics: 4, seed: 9 });

const record = (i: number, extra: Record<string, unknown> = {}) =>
  documentRecordSchema.parse({
    id: hex(i),
    hash: sha(`doc-${i}`),
    path: `${DOCS[i % COUNT]!.folder}/p${i}.pdf`,
    size: 1,
    mtimeMs: 1,
    addedAt: NOW,
    updatedAt: NOW,
    title: DOCS[i % COUNT]!.title,
    year: 2000 + (i % 20),
    authors: [`Quillon${i % 6} Wrenfold`, `Quillon${(i + 1) % 6} Wrenfold`],
    ref: { venue: `Venue ${i % 4}` },
    tags: [`tag${i % 4}`],
    ai: { summary: aiField(DOCS[i % COUNT]!.abstract) },
    ...extra,
  });

let root: string;
let local: string;
let store: FileLibraryStore;
let generation = 0;
let events: Array<{ channel: string; payload: any }>;
let script: MockScript;
let prompts: string[];
/** One runtime object per test: the handlers keep their caches per runtime. */
let rt: { libraryId: string; store: FileLibraryStore; textCacheDir: string; organizer: { generation: number } };
const makeRuntime = () => ({
  libraryId: 'lib-1',
  store,
  textCacheDir: path.join(local, 'cache', 'text'),
  organizer: {
    get generation() {
      return generation;
    },
  },
});

const config = (over: Partial<LibraryConfig> & { ai?: Partial<LibraryConfig['ai']> } = {}): LibraryConfig => {
  const base = defaultLibraryConfig();
  return { ...base, aiEnabledFolders: ['folder0'], ...over, ai: { ...base.ai, confirmBeforeSend: false, ...over.ai } } as LibraryConfig;
};

let services: MainServices;
function harness() {
  const log = createMemoryLogger();
  services = {
    log,
    localDataDir: local,
    emit: (channel: string, payload: unknown) => events.push({ channel, payload }),
    runtime: { sync: async () => {}, hold: () => () => {}, status: () => ({}), require: async () => rt },
    settings: { get: async () => ({ deviceId: 'device-12345678', ai: { claudeCodePath: null } }) },
    aiProvider: (cfg: { models: any }) => {
      const p: any = createMockAiProvider({ models: cfg.models, ...script });
      return Object.assign(Object.create(p), {
        id: p.id,
        completeStructured: (r: { prompt: string; system: string }) => (prompts.push(`${r.system}\n${r.prompt}`), p.completeStructured(r)),
        access: () => p.access(),
        isAvailable: () => p.isAvailable(),
      });
    },
    isOnline: () => true,
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

async function writeCache(i: number, text: string) {
  const dir = path.join(local, 'cache', 'text');
  await mkdir(dir, { recursive: true });
  const result = { pages: [{ page: 1, text }], meta: { pageCount: 1 }, noTextLayer: false, hasText: true, needsOcr: false, truncated: false, format: 'pdf' };
  await writeFile(path.join(dir, `${sha(`doc-${i}`)}.json`), JSON.stringify({ v: 1, maxPages: 400, result }));
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'rl-graph-'));
  local = await mkdtemp(path.join(os.tmpdir(), 'rl-graph-local-'));
  store = createLibraryStore({ rootPath: root, deviceId: 'device-12345678' });
  await store.init();
  await store.writeConfig(config());
  await store.writeTaxonomy(
    taxonomyFileSchema.parse({
      nodes: [{ id: 'science', label: 'Science' }, ...[0, 1, 2, 3].map((t) => ({ id: `tag${t}`, label: `Topic ${t}`, parents: ['science'] }))],
    }),
  );
  for (let i = 0; i < COUNT; i++) {
    await store.documents.put(record(i));
    await writeCache(i, DOCS[i]!.text);
  }
  generation = 1;
  rt = makeRuntime();
  events = [];
  script = {};
  prompts = [];
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  await rm(local, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function built(call: ReturnType<typeof harness>, seed?: number) {
  const { jobId } = ok(await call('graph:build', seed === undefined ? {} : { seed }));
  await whenBuilt(services);
  return jobId as string;
}

describe('graph:status, build and cancel', () => {
  it('starts as `none`, builds in the worker with progress, and stores the model locally', async () => {
    const call = harness();
    expect(ok(await call('graph:status'))).toMatchObject({ state: 'none', documents: COUNT, builtAt: null, seed: null, pending: 0 });
    fail(await call('graph:map', {}));
    const jobId = await built(call, 5);
    const progress = events.filter((e) => e.channel === 'graph:progress' && e.payload.jobId === jobId).map((e) => e.payload);
    const phases = [...new Set(progress.map((p) => p.phase))];
    expect(phases).toEqual(['vectors', 'similarity', 'clusters', 'layout', 'done']);
    expect(progress.at(-1)).toMatchObject({ phase: 'done', done: COUNT, total: COUNT });
    expect(ok(await call('graph:status'))).toMatchObject({ state: 'ready', documents: COUNT, seed: 5, pending: 0 });
    // The model is in the local app data, never in the library or its data folder.
    expect(await readdir(path.join(local, 'graph', 'lib-1'))).toContain('model.json');
    const everything = async (dir: string): Promise<string[]> => (await readdir(dir, { withFileTypes: true, recursive: true })).map((e) => e.name);
    expect(await everything(root)).not.toContain('model.json');
    expect(await everything(store.dataDir)).not.toContain('model.json');
    expect(ok(await call('graph:build', {})).jobId).not.toBe('');
    await whenBuilt(services);
  });

  it('a second build request while one runs returns the same job; cancel stops it and leaves the old model alone', async () => {
    const call = harness();
    await built(call, 5);
    const before = ok(await call('graph:map', {}));
    const first = ok(await call('graph:build', { seed: 6 })).jobId;
    expect(ok(await call('graph:build', { seed: 6 })).jobId).toBe(first);
    expect(ok(await call('graph:status')).state).toBe('building');
    expect(ok(await call('graph:cancel', { jobId: first })).cancelled).toBe(true);
    expect(ok(await call('graph:cancel', { jobId: 'nope' })).cancelled).toBe(false);
    await whenBuilt(services);
    expect(events.some((e) => e.channel === 'graph:progress' && e.payload.jobId === first && e.payload.phase === 'cancelled')).toBe(true);
    expect(ok(await call('graph:status')).seed).toBe(5);
    expect(ok(await call('graph:map', {})).points).toEqual(before.points);
  });

  it('a rebuild with the same seed gives the same clusters and positions; another seed may differ', async () => {
    const call = harness();
    await built(call, 3);
    const a = ok(await call('graph:map', {}));
    await built(call, 3);
    const b = ok(await call('graph:map', {}));
    expect(b.points).toEqual(a.points);
    expect(b.clusters.map((c: any) => [c.id, c.size, c.topTerms])).toEqual(a.clusters.map((c: any) => [c.id, c.size, c.topTerms]));
    // A rebuild without a seed keeps the seed of the model.
    await built(call);
    expect(ok(await call('graph:status')).seed).toBe(3);
  });
});

describe('graph:map', () => {
  it('has one point per document, its clusters at each level, and the clusters with their terms', async () => {
    const call = harness();
    await built(call);
    const m = ok(await call('graph:map', {}));
    expect(m.points).toHaveLength(COUNT);
    const ids = new Set(m.clusters.map((c: any) => c.id));
    for (const p of m.points) {
      expect(p.clusters.length).toBeGreaterThan(0);
      expect(p.clusters.every((c: string) => ids.has(c))).toBe(true);
    }
    const top = m.clusters.filter((c: any) => c.level === 0);
    expect(top.reduce((n: number, c: any) => n + c.size, 0)).toBe(COUNT);
    expect(top.every((c: any) => c.parent === null && c.topTerms.length > 0 && c.aiLabel === null)).toBe(true);
    expect(m.builtAt).toMatch(/^\d{4}-/);
  });

  it('can be limited to a folder, a project or a tag (and what is under it)', async () => {
    await store.projects.put({ schemaVersion: 1, id: 'proj', name: 'P', description: '', status: 'active', members: [0, 1, 2].map((i) => ({ docId: hex(i), addedAt: NOW })), notes: '', readingPlan: [], createdAt: NOW, updatedAt: NOW } as never);
    const call = harness();
    await built(call);
    const inFolder = ok(await call('graph:map', { scope: { folder: 'folder1' } })).points;
    expect(inFolder).toHaveLength(COUNT / 3);
    expect(ok(await call('graph:map', { scope: { projectId: 'proj' } })).points.map((p: any) => p.docId).sort()).toEqual([hex(0), hex(1), hex(2)]);
    expect(ok(await call('graph:map', { scope: { tagId: 'tag2' } })).points).toHaveLength(COUNT / 4);
    expect(ok(await call('graph:map', { scope: { tagId: 'science' } })).points).toHaveLength(COUNT);
    expect(ok(await call('graph:map', { scope: { tagId: 'tag1', folder: 'folder1' } })).points.length).toBeLessThan(COUNT / 4);
    fail(await call('graph:map', { scope: { tagId: 'nope' } }));
    fail(await call('graph:map', { scope: { projectId: 'nope' } }));
  });

  it('answers a 500-document map in well under 100 ms once the model is loaded', async () => {
    // 500 records written directly (the 60 of the other tests stay).
    for (let i = COUNT; i < 500; i++) await store.documents.put(record(i, { path: `folder${i % 3}/p${i}.pdf`, title: DOCS[i % COUNT]!.title }));
    generation++;
    const call = harness();
    await built(call);
    await call('graph:map', {}); // loads the model
    const t = performance.now();
    const m = ok(await call('graph:map', {}));
    const ms = performance.now() - t;
    expect(m.points).toHaveLength(500);
    expect(ms).toBeLessThan(100);
  });
});

describe('incremental placement and staleness', () => {
  it('reports stale with the number of changed documents and places a new one from its neighbours', async () => {
    const call = harness();
    await built(call);
    const before = ok(await call('graph:map', {}));
    // A new document that reads like those of topic 2, and a changed title on another document.
    const text = DOCS[2]!.text;
    await store.documents.put(record(900, { title: DOCS[2]!.title, tags: ['tag2'], path: 'folder2/new.pdf', ai: { summary: aiField(DOCS[2]!.abstract) } }));
    await writeCache(900, text);
    await store.documents.update(hex(5) as never, (cur) => ({ ...cur!, title: 'Renamed', revision: cur!.revision + 1 }));
    generation++;
    expect(ok(await call('graph:status'))).toMatchObject({ state: 'stale', pending: 2, documents: COUNT });
    const after = ok(await call('graph:map', {}));
    expect(after.points).toHaveLength(COUNT + 1);
    const byId = (m: any) => new Map(m.points.map((p: any) => [p.docId, p]));
    const was = byId(before);
    const now = byId(after);
    // Nobody else moved.
    for (const [id, p] of was) if (id !== hex(5)) expect(now.get(id)).toEqual(p);
    // The new document sits among the documents of its topic (tag2 = i % 4 === 2).
    const peers = [...was.values()].filter((_p: any, k: number) => k % 4 === 2) as any[];
    const cx = peers.reduce((s, p) => s + p.x, 0) / peers.length;
    const cy = peers.reduce((s, p) => s + p.y, 0) / peers.length;
    const fresh = now.get(hex(900)) as any;
    const others = [0, 1, 3].map((t) => (([...was.values()].filter((_p: any, k: number) => k % 4 === t) as any[]).reduce((s, p) => [s[0] + p.x, s[1] + p.y], [0, 0]) as number[]).map((v) => v / (COUNT / 4)));
    const dOwn = Math.hypot(fresh.x - cx, fresh.y - cy);
    for (const o of others) expect(dOwn).toBeLessThan(Math.hypot(fresh.x - o[0]!, fresh.y - o[1]!));
    expect(fresh.clusters[0]).toBe((was.get(hex(2)) as any).clusters[0]);
    // The same call again gives the same place (and no model change).
    expect((byId(ok(await call('graph:map', {}))).get(hex(900)) as any).x).toBe(fresh.x);
    // A rebuild takes everybody in.
    await built(call);
    expect(ok(await call('graph:status'))).toMatchObject({ state: 'ready', pending: 0, documents: COUNT + 1 });
  });

  it('drops a deleted document from the map and calls the model stale', async () => {
    const call = harness();
    await built(call);
    await store.documents.remove(hex(7) as never);
    generation++;
    expect(ok(await call('graph:status'))).toMatchObject({ state: 'stale', pending: 0 });
    expect(ok(await call('graph:map', {})).points.some((p: any) => p.docId === hex(7))).toBe(false);
  });

  it('refuses a damaged model file instead of crashing, and a rebuild repairs it', async () => {
    const call = harness();
    await built(call);
    await writeFile(path.join(local, 'graph', 'lib-1', 'model.json'), '{"format":"rl-graph-model","version":1,"ids":[1]}');
    // The loaded copy is keyed by the file's size and time: the damaged file is read, found wrong, and ignored.
    expect(ok(await call('graph:status')).state).toBe('none');
    fail(await call('graph:map', {}));
    await built(call);
    expect(ok(await call('graph:status')).state).toBe('ready');
  });
});

describe('graph:similar and graph:surprising', () => {
  it('works without a model (on the fly), then from the model, with the same answer', async () => {
    const call = harness();
    const fly = ok(await call('graph:similar', { docId: hex(0), limit: 10 })).items as any[];
    expect(fly.length).toBe(10);
    // Documents of the same topic (i % 4 === 0) come first, with text and tags as reasons.
    expect(fly.slice(0, 5).every((it) => Number.parseInt(it.docId, 16) % 4 === 0)).toBe(true);
    expect(fly[0].reasons).toEqual(expect.arrayContaining(['text', 'tags']));
    expect(fly[0].shared.tags).toEqual(['tag0']);
    expect(fly[0].shared.terms.length).toBeGreaterThan(0);
    expect(fly.every((it) => it.score >= 0 && it.score <= 1)).toBe(true);
    await built(call);
    const fromModel = ok(await call('graph:similar', { docId: hex(0), limit: 10 })).items as any[];
    // The model also read the first pages, so the order can differ; the documents of the topic still come first.
    expect(fromModel.slice(0, 5).every((it) => Number.parseInt(it.docId, 16) % 4 === 0)).toBe(true);
    expect(fromModel[0]!.reasons).toEqual(expect.arrayContaining(['text', 'tags']));
    expect(fromModel[0]!.shared).toMatchObject({ tags: ['tag0'], citations: 0 });
    expect(fromModel[0]!.shared.terms.length).toBeGreaterThan(0);
    // More than the model keeps: computed on the fly again.
    // (documents that share nothing with it are not "similar": the list ends with the topic's 14 others).
    expect(ok(await call('graph:similar', { docId: hex(0), limit: 40 })).items).toHaveLength(COUNT / 4 - 1);
    fail(await call('graph:similar', { docId: hex(9999) }));
  });

  it('lists close pairs that share no tag, no citation and no folder', async () => {
    // Document 4 reads like the documents of topic 0 but is tagged like topic 1 and lives in another folder than document 0.
    await store.documents.update(hex(4) as never, (cur) => ({ ...cur!, tags: ['tag1'], revision: cur!.revision + 1 }));
    generation++;
    const call = harness();
    fail(await call('graph:surprising', {}));
    await built(call);
    const one = ok(await call('graph:surprising', { docId: hex(0), limit: 50 })).pairs as any[];
    expect(one.some((p) => p.a === hex(0) && p.b === hex(4))).toBe(true);
    expect(one.every((p) => p.a === hex(0))).toBe(true);
    const all = ok(await call('graph:surprising', { limit: 200 })).pairs as any[];
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) {
      const a = await store.documents.get(p.a);
      const b = await store.documents.get(p.b);
      expect(a!.tags.some((t) => b!.tags.includes(t))).toBe(false);
      expect(a!.path.split('/')[0]).not.toBe(b!.path.split('/')[0]);
      expect(p.score).toBeGreaterThanOrEqual(0.2);
    }
  });
});

describe('graph:neighbors', () => {
  it('expands a document, a folder and a tag', async () => {
    await store.citations.put({ schemaVersion: 1, docId: hex(0), references: [{ matchedDocId: hex(1), authors: [], source: 'manual', checkedAt: NOW }], citedBy: [{ matchedDocId: hex(2), authors: [], source: 'manual', checkedAt: NOW }] } as never);
    const call = harness();
    const doc = ok(await call('graph:neighbors', { node: { kind: 'doc', id: hex(0) }, kinds: ['similar', 'citations', 'tags', 'folder'], limit: 5 }));
    const kinds = new Set(doc.edges.map((e: any) => e.kind));
    expect([...kinds].sort()).toEqual(['cites', 'contains', 'similar', 'tagged']);
    expect(doc.edges).toContainEqual({ from: hex(0), to: hex(1), kind: 'cites', weight: 1 });
    expect(doc.edges).toContainEqual({ from: hex(2), to: hex(0), kind: 'cites', weight: 1 });
    expect(doc.nodes).toContainEqual({ kind: 'tag', id: 'tag0', label: 'Topic 0', count: COUNT / 4 });
    expect(doc.nodes.find((n: any) => n.kind === 'folder')).toMatchObject({ id: 'folder0', count: COUNT / 3 });

    const root = ok(await call('graph:neighbors', { node: { kind: 'folder', id: '' }, kinds: ['children'], limit: 10 }));
    expect(root.nodes.map((n: any) => n.id)).toEqual(['folder0', 'folder1', 'folder2']);
    const files = ok(await call('graph:neighbors', { node: { kind: 'folder', id: 'folder1' }, kinds: ['documents', 'folder'], limit: 7 }));
    expect(files.nodes.filter((n: any) => n.kind === 'doc')).toHaveLength(7);
    expect(files.edges).toContainEqual({ from: '', to: 'folder1', kind: 'contains', weight: 1 });
    fail(await call('graph:neighbors', { node: { kind: 'folder', id: 'missing' }, kinds: ['children'] }));

    const tag = ok(await call('graph:neighbors', { node: { kind: 'tag', id: 'science' }, kinds: ['children', 'documents'], limit: 100 }));
    expect(tag.nodes.filter((n: any) => n.kind === 'tag').map((n: any) => n.id)).toEqual(['tag0', 'tag1', 'tag2', 'tag3']);
    expect(tag.nodes.filter((n: any) => n.kind === 'doc')).toHaveLength(COUNT);
    await store.documents.update(hex(0) as never, (cur) => ({ ...cur!, tags: ['tag0', 'tag1'], revision: cur!.revision + 1 }));
    generation++;
    const related = ok(await call('graph:neighbors', { node: { kind: 'tag', id: 'tag0' }, kinds: ['tags'], limit: 5 }));
    expect(related.edges.map((e: any) => [e.to, e.kind])).toEqual([['tag1', 'similar']]);
    expect(related.edges[0].weight).toBeGreaterThan(0);
    expect(related.edges[0].weight).toBeLessThan(1);
    fail(await call('graph:neighbors', { node: { kind: 'doc', id: hex(9999) }, kinds: ['similar'] }));
  });
});

describe('cluster labels written by Claude', () => {
  const ask = (call: ReturnType<typeof harness>, over: Record<string, unknown> = {}) => ({ clusterIds: [] as string[], model: 'claude-haiku-5-5', reasoning: 'low', confirmed: false, ...over });
  async function topClusters(call: ReturnType<typeof harness>) {
    const m = ok(await call('graph:map', {}));
    return m.clusters.filter((c: any) => c.level === 0).map((c: any) => c.id) as string[];
  }
  const sendLog = async () => (await store.readLog({ type: 'ai-send' })) as any[];

  it('previews only what is allowed: titles of enabled folders, terms from those documents alone', async () => {
    const call = harness();
    await built(call);
    const ids = await topClusters(call);
    const p = ok(await call('graph:previewLabels', { clusterIds: ids, model: 'claude-haiku-5-5' }));
    // Only folder0 is enabled: 1/3 of the documents may go, the rest are refused.
    const allowedPaths = await Promise.all(p.allowed.map(async (id: string) => (await store.documents.get(id as never))!.path));
    expect(allowedPaths.every((x) => x.startsWith('folder0/'))).toBe(true);
    expect(p.allowed.length).toBeGreaterThan(0);
    expect(p.refused.every((r: any) => r.reason === 'folder-not-enabled')).toBe(true);
    expect(p.folders).toEqual(['folder0']);
    expect(p.approxInputTokens).toBeGreaterThan(0);
    // Nothing was sent or logged by a preview.
    expect(prompts).toEqual([]);
    expect(await sendLog()).toEqual([]);
    fail(await call('graph:previewLabels', { clusterIds: ['c9.9'], model: 'claude-haiku-5-5' }));
  });

  it('labels with the mock provider, sends only titles of enabled folders, logs the send and stores labels as AI output', async () => {
    const call = harness();
    await built(call);
    const ids = await topClusters(call);
    const r = ok(await call('graph:labelClusters', ask(call, { clusterIds: ids })));
    expect(r.labelled).toBe(ids.length);
    // What was sent: ids, terms and titles; no title of a document outside folder0.
    expect(prompts).toHaveLength(1);
    const hidden = (await store.documents.list()).filter((d) => !d.path.startsWith('folder0/')).map((d) => d.title!);
    const shown = (await store.documents.list()).filter((d) => d.path.startsWith('folder0/')).map((d) => d.title!);
    expect(hidden.every((t) => !prompts[0]!.includes(t))).toBe(true);
    expect(shown.some((t) => prompts[0]!.includes(t))).toBe(true);
    expect(prompts[0]).not.toContain('folder0/');
    // The send is logged: ids and sizes, folders, no text.
    const [entry] = await sendLog();
    expect(entry).toMatchObject({ purpose: 'graph:labels', provider: 'mock', model: 'claude-haiku-5-5', folders: ['folder0'], confirmed: false });
    expect(entry.docIds.length).toBeGreaterThan(0);
    expect(JSON.stringify(entry)).not.toContain('Renamed');
    // Labels are deterministic with the mock, marked as AI output and kept locally.
    const m = ok(await call('graph:map', {}));
    const labelled = m.clusters.filter((c: any) => c.aiLabel);
    expect(labelled.map((c: any) => c.id).sort()).toEqual([...ids].sort());
    for (const c of labelled) {
      const first = c.topTerms.slice(0, 1);
      expect(c.aiLabel.text.length).toBeGreaterThan(0);
      expect(c.aiLabel.meta).toMatchObject({ provider: 'mock', model: 'claude-haiku-5-5', source: 'graph:labels' });
      expect(first.length).toBe(1);
    }
    expect(await readdir(path.join(local, 'graph', 'lib-1'))).toContain('labels.json');
    const again = ok(await call('graph:labelClusters', ask(call, { clusterIds: ids })));
    expect(again.labelled).toBe(ids.length);
    expect(ok(await call('graph:map', {})).clusters.map((c: any) => c.aiLabel?.text)).toEqual(m.clusters.map((c: any) => c.aiLabel?.text));
  });

  it('asks for the confirmation when the library wants it, and refuses over the cap or without access', async () => {
    await store.writeConfig(config({ ai: { confirmBeforeSend: true } as never }));
    const call = harness();
    await built(call);
    const ids = await topClusters(call);
    const needs = fail(await call('graph:labelClusters', ask(call, { clusterIds: ids })));
    expect(needs).toMatchObject({ code: 'CONFLICT', details: { reason: 'needs-confirmation' } });
    expect(prompts).toEqual([]);
    expect(await sendLog()).toEqual([]);
    expect(ok(await call('graph:labelClusters', ask(call, { clusterIds: ids, confirmed: true }))).labelled).toBeGreaterThan(0);
    expect((await sendLog())[0]).toMatchObject({ confirmed: true });

    // Monthly cap already reached: nothing is sent, nothing is logged.
    const before = (await sendLog()).length;
    await store.writeConfig(config({ ai: { confirmBeforeSend: false, usageCap: { monthlyUsd: 1, confirmBatchAboveUsd: 100 } } as never }));
    await store.appendLog({ type: 'ai-send', at: new Date().toISOString(), deviceId: 'd', provider: 'mock', model: 'claude-haiku-5-5', purpose: 'chat', docIds: [], folders: [], approxInputTokens: 1, estimatedCostUsd: 5, confirmed: true });
    const capped = fail(await call('graph:labelClusters', ask(call, { clusterIds: ids, confirmed: true })));
    expect(capped.code).toBe('AI_BUDGET_EXCEEDED');
    expect((await sendLog()).length).toBe(before + 1);

    // No access.
    await store.writeConfig(config());
    script = { available: false };
    const none = fail(await harness()('graph:labelClusters', ask(call, { clusterIds: ids, confirmed: true })));
    expect(none.code).toBe('AI_PROVIDER_ERROR');
    expect(fail(await harness()('graph:labelClusters', ask(call, { clusterIds: ids, model: 'unknown-model' }))).code).toBe('INVALID_REQUEST');
  });

  it('sends nothing when no cluster has a document in an enabled folder', async () => {
    await store.writeConfig(config({ aiEnabledFolders: ['nowhere'] }));
    const call = harness();
    await built(call);
    const ids = await topClusters(call);
    expect(fail(await call('graph:labelClusters', ask(call, { clusterIds: ids }))).code).toBe('FOLDER_NOT_AI_ENABLED');
    expect(prompts).toEqual([]);
    expect(await sendLog()).toEqual([]);
    expect(ok(await call('graph:previewLabels', { clusterIds: ids, model: 'claude-haiku-5-5' })).allowed).toEqual([]);
  });

  it('logs a failed send that may have reached the model, but not one that never left', async () => {
    const call = harness();
    await built(call);
    const ids = await topClusters(call);
    script = { fail: { code: 'AI_PROVIDER_ERROR', message: 'boom', sent: false } };
    expect(fail(await harness()('graph:labelClusters', ask(call, { clusterIds: ids }))).code).toBe('AI_PROVIDER_ERROR');
    expect(await sendLog()).toEqual([]);
    script = { fail: { code: 'AI_PROVIDER_ERROR', message: 'boom' } };
    expect(fail(await harness()('graph:labelClusters', ask(call, { clusterIds: ids }))).code).toBe('AI_PROVIDER_ERROR');
    expect(await sendLog()).toHaveLength(1);
  });

  it('forgets labels when the graph is rebuilt (cluster ids belong to one build)', async () => {
    const call = harness();
    await built(call, 1);
    const ids = await topClusters(call);
    ok(await call('graph:labelClusters', ask(call, { clusterIds: ids })));
    await new Promise((r) => setTimeout(r, 5));
    await built(call, 2);
    expect(ok(await call('graph:map', {})).clusters.every((c: any) => c.aiLabel === null)).toBe(true);
  });
});

describe('explore:*', () => {
  it('goes from the macro topic to a single paper in a few zooms and back, with the path kept', async () => {
    const call = harness();
    const top = ok(await call('explore:level', { dimension: 'topic' }));
    expect(top.path).toEqual([]);
    expect(top.nodes).toEqual([{ id: 'science', label: 'Science', kind: 'topic', count: COUNT, hasChildren: true }]);
    const kids = ok(await call('explore:level', { dimension: 'topic', parentId: 'science' }));
    expect(kids.nodes.map((n: any) => n.id).sort()).toEqual(['tag0', 'tag1', 'tag2', 'tag3']);
    expect(kids.path).toEqual([{ id: 'science', label: 'Science' }]);
    const leaf = ok(await call('explore:level', { dimension: 'topic', parentId: 'tag2' }));
    expect(leaf.nodes).toEqual([]);
    expect(leaf.path.map((p: any) => p.id)).toEqual(['science', 'tag2']);
    const page = ok(await call('explore:documents', { dimension: 'topic', id: 'tag2', limit: 5, offset: 0 }));
    expect(page.total).toBe(COUNT / 4);
    expect(page.docIds).toHaveLength(5);
    expect(page.docIds.every((id: string) => Number.parseInt(id, 16) % 4 === 2)).toBe(true);
    expect(fail(await call('explore:level', { dimension: 'topic', parentId: 'nope' })).code).toBe('NOT_FOUND');
    expect(fail(await call('explore:documents', { dimension: 'author', id: 'author:nobody' })).code).toBe('NOT_FOUND');
  });

  it('switches dimension from a node: topic -> authors and venues, author -> topics', async () => {
    const call = harness();
    const authors = ok(await call('explore:level', { dimension: 'author' })).nodes as any[];
    expect(authors.length).toBeGreaterThan(0);
    const members = ok(await call('explore:level', { dimension: 'author', parentId: authors[0].id })).nodes as any[];
    expect(members.length).toBeGreaterThan(0);
    const topics = ok(await call('explore:related', { from: { dimension: 'author', id: members[0].id }, to: 'topic' })).nodes as any[];
    expect(topics.length).toBeGreaterThan(0);
    expect(topics[0].path.length).toBeGreaterThan(0);
    expect(topics[0].score).toBeGreaterThan(0);
    const venues = ok(await call('explore:related', { from: { dimension: 'topic', id: 'tag1' }, to: 'venue', limit: 3 })).nodes as any[];
    expect(venues.length).toBeGreaterThan(0);
    expect(venues.every((v) => v.kind === 'venue' && v.path.length === 2)).toBe(true);
    expect(fail(await call('explore:related', { from: { dimension: 'topic', id: 'nope' }, to: 'venue' })).code).toBe('NOT_FOUND');
  });

  it('follows the documents: a new tag shows after the library changes', async () => {
    const call = harness();
    expect(ok(await call('explore:level', { dimension: 'topic', parentId: 'science' })).nodes).toHaveLength(4);
    await store.documents.update(hex(0) as never, (cur) => ({ ...cur!, tags: [], revision: cur!.revision + 1 }));
    generation++;
    expect(ok(await call('explore:documents', { dimension: 'topic', id: 'tag0' })).total).toBe(COUNT / 4 - 1);
  });
});
