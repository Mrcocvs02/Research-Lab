import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { channels, createDispatcher, createMemoryLogger, defaultLibraryConfig, documentRecordSchema, taxonomyFileSchema, type IpcEnvelope } from '@rl/core';
import { createLibraryStore, createOrganizer, type FileLibraryStore } from '@rl/data';
import { abortAllJobs } from '../ai/jobs.js';
import { buildHandlers, type MainServices } from '../ipc/handlers/index.js';
import { fixtureFetch } from '../net-fixtures.js';
import { netTuning } from './context.js';
import { whenCitationJobsIdle } from './refresh.js';
import { trimSeen } from './watch.js';

const NOW = '2026-01-02T03:04:05.000Z';
const hex = (n: number) => n.toString(16).padStart(16, '0');
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

let root: string;
let store: FileLibraryStore;
let libraryId: string;
let online: boolean;
let settings: { network: { openAlexEmail: boolean }; user: { email: string; authorVariants: string[]; openAlexId: string } };
let urls: string[];
let secretValue: string | null;
let events: Array<[string, any]>;
let net: (u: URL, signal?: AbortSignal) => Response | Promise<Response>;
let organizer: ReturnType<typeof createOrganizer>;
let openedUrls: string[];
let reindexed: string[][];

const work = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `https://openalex.org/W${n}`,
  doi: `https://doi.org/10.1001/w${n}`,
  title: `Work number ${n} about robots`,
  publication_year: 2020,
  authorships: [{ author: { display_name: `Author${n} Person` } }],
  primary_location: { source: { display_name: 'Journal X' } },
  ...extra,
});
/** The fake OpenAlex: works by DOI, batches by id, nothing cites anyone. */
const WORKS: Record<string, any> = {
  '10.1001/w1': work(1, { referenced_works: ['https://openalex.org/W2', 'https://openalex.org/W7', 'https://openalex.org/W8'], cited_by_count: 1 }),
  '10.1001/w2': work(2, { referenced_works: ['https://openalex.org/W7', 'https://openalex.org/W8', 'https://openalex.org/W9'], cited_by_count: 0 }),
};
const openAlex = (u: URL): Response => {
  const f = u.searchParams.get('filter') ?? '';
  const m = /^\/works\/doi:(.+)$/.exec(decodeURIComponent(u.pathname));
  if (m) return WORKS[m[1]!] ? json(WORKS[m[1]!]) : new Response(null, { status: 404 });
  if (f.startsWith('openalex_id:')) return json({ results: f.slice(12).split('|').map((id) => work(Number(id.slice(1)))) });
  if (f.startsWith('cites:')) return json({ results: [], meta: { next_cursor: null } });
  return json({ results: [], meta: { next_cursor: null } });
};

const doc = (n: number, p: string, extra: Record<string, unknown> = {}) => documentRecordSchema.parse({ id: hex(n), hash: 'a'.repeat(64), path: p, size: 1, mtimeMs: 1, addedAt: NOW, updatedAt: NOW, ...extra });

function harness() {
  const log = createMemoryLogger();
  organizer = createOrganizer({ store, deviceId: 'device-12345678', cacheTtlMs: 0 });
  const rt = {
    get libraryId() {
      return libraryId;
    },
    store,
    organizer,
    getDocument: async (id: string) => {
      const d = await store.documents.get(id as never);
      if (!d) throw new Error('NOT_FOUND');
      return d;
    },
    reindexDocuments: async (ids: string[]) => void reindexed.push(ids),
  };
  const services = {
    log,
    emit: (e: string, p: unknown) => events.push([e, p]),
    runtime: { sync: async () => {}, hold: () => () => {}, status: () => ({}), require: async () => rt },
    settings: { get: async () => settings },
    secrets: {
      get: async () => secretValue,
      set: async (_s: unknown, _n: string, v: string) => void (secretValue = v),
      has: async () => secretValue !== null,
      delete: async () => void (secretValue = null),
    },
    isOnline: () => online,
    shell: { openExternal: async (u: string) => void openedUrls.push(u) },
    fetch: (async (url: string, init?: RequestInit) => {
      urls.push(url);
      return net(new URL(url), init?.signal ?? undefined);
    }) as unknown as typeof fetch,
    localDataDir: os.tmpdir(),
  } as unknown as MainServices;
  const dispatch = createDispatcher(channels, buildHandlers(services), log);
  return async (c: string, p: unknown = {}) => dispatch(c, p);
}
let call: ReturnType<typeof harness>;
const ok = (r: IpcEnvelope) => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.data as Record<string, any>;
};
const fail = (r: IpcEnvelope) => {
  if (r.ok) throw new Error('expected an error');
  return r.error;
};

beforeEach(async () => {
  netTuning.sleep = async () => undefined;
  root = await mkdtemp(path.join(os.tmpdir(), 'rl-cit-'));
  store = createLibraryStore({ rootPath: root, deviceId: 'device-12345678' });
  await store.init();
  await store.writeConfig(defaultLibraryConfig());
  await store.writeTaxonomy(taxonomyFileSchema.parse({ nodes: [] }));
  await store.documents.put(doc(1, 'papers/a.pdf', { doi: '10.1001/w1', title: 'Alpha paper about robots', authors: ['Ada Example'], year: 2020 }));
  await store.documents.put(doc(2, 'papers/b.pdf', { doi: '10.1001/w2', title: 'Beta paper about robots', year: 2020 }));
  await store.documents.put(doc(3, 'other/c.pdf'));
  libraryId = 'lib-1';
  online = true;
  urls = [];
  secretValue = null;
  events = [];
  reindexed = [];
  openedUrls = [];
  net = openAlex;
  settings = { network: { openAlexEmail: false }, user: { email: 'me@example.org', authorVariants: ['Ada Example'], openAlexId: '' } };
  call = harness();
});
afterEach(async () => {
  abortAllJobs();
  await whenCitationJobsIdle();
  await rm(root, { recursive: true, force: true });
});

describe('citations:get and citations:refresh', () => {
  it('is empty before a refresh; a refresh stores the file, matches the library and counts', async () => {
    expect(ok(await call('citations:get', { docId: hex(1) }))).toMatchObject({ fetched: false, references: [], inLibrary: 0, missing: 0 });
    const v = ok(await call('citations:refresh', { docId: hex(1) }));
    expect(v).toMatchObject({ fetched: true, citedByCount: 1, inLibrary: 1, missing: 2 });
    expect(v.references.map((r: any) => r.externalId)).toEqual(['W2', 'W7', 'W8']);
    expect(v.references[0].matched).toEqual({ docId: hex(2), title: 'Beta paper about robots', path: 'papers/b.pdf' });
    expect((await store.citations.get(hex(1) as never))?.externalId).toBe('W1');
    expect(urls.every((u) => u.startsWith('https://api.openalex.org/') && !u.includes('mailto'))).toBe(true);
    expect(urls.some((u) => u.includes('pdf') || u.includes('papers'))).toBe(false);
  });

  it('a removed document is unmatched, a document added later is matched, without a new network call', async () => {
    ok(await call('citations:refresh', { docId: hex(1) }));
    await store.documents.remove(hex(2) as never);
    const n = urls.length;
    const gone = ok(await call('citations:get', { docId: hex(1) }));
    expect(gone.references[0].matched).toBeNull();
    expect(gone).toMatchObject({ inLibrary: 0, missing: 3 });
    expect((await store.citations.get(hex(1) as never))?.references[0]?.matchedDocId).toBe(hex(2)); // the stored link is not rewritten by a read
    await store.documents.put(doc(5, 'papers/z.pdf', { doi: '10.1001/w7' }));
    // the index of owned documents is reused for a while: a refresh of any document rebuilds it
    ok(await call('citations:refresh', { docId: hex(1), what: ['references'] }));
    // references come in order of relevance (D-446 g), so the new match is looked up by its work and not by position
    expect(ok(await call('citations:get', { docId: hex(1) })).references.find((r: any) => r.externalId === 'W7').matched.docId).toBe(hex(5));
    expect(urls.length).toBeGreaterThan(n);
  });

  it('sends the email only when the setting is on and the profile has one', async () => {
    settings.network.openAlexEmail = true;
    ok(await call('citations:refresh', { docId: hex(1) }));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.includes('mailto=me%40example.org'))).toBe(true);
    urls.length = 0;
    settings.user.email = '';
    ok(await call('citations:refresh', { docId: hex(1) }));
    expect(urls.some((u) => u.includes('mailto'))).toBe(false);
  });

  it('sends the OpenAlex key from the secret store, re-read after it is saved or removed, never logged', async () => {
    const app = { kind: 'app' };
    ok(await call('secrets:set', { scope: app, name: 'openalex-api-key', value: 'k-secret-3' }));
    ok(await call('citations:refresh', { docId: hex(1) }));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.includes('api_key=k-secret-3'))).toBe(true);
    ok(await call('secrets:set', { scope: app, name: 'openalex-api-key', value: 'k-secret-4' }));
    urls.length = 0;
    ok(await call('citations:refresh', { docId: hex(1), what: ['references'] }));
    expect(urls.every((u) => u.includes('api_key=k-secret-4'))).toBe(true);
    ok(await call('secrets:delete', { scope: app, name: 'openalex-api-key' }));
    urls.length = 0;
    ok(await call('citations:refresh', { docId: hex(1), what: ['references'] }));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.some((u) => u.includes('api_key'))).toBe(false);
  });

  it('errors: offline, nothing to look up, unknown work, rate limit', async () => {
    online = false;
    expect(fail(await call('citations:refresh', { docId: hex(1) }))).toMatchObject({ code: 'NETWORK_ERROR', details: { reason: 'offline' } });
    expect(urls).toHaveLength(0);
    online = true;
    expect(fail(await call('citations:refresh', { docId: hex(3) })).code).toBe('INVALID_REQUEST');
    await store.documents.put(doc(4, 'papers/d.pdf', { doi: '10.1001/unknown' }));
    expect(fail(await call('citations:refresh', { docId: hex(4) })).code).toBe('NOT_FOUND');
    net = () => new Response(null, { status: 400 });
    expect(fail(await call('citations:refresh', { docId: hex(1) }))).toMatchObject({ code: 'NETWORK_ERROR', details: { reason: 'http' } });
  });
});

describe('citations:refreshMany', () => {
  it('refreshes one document at a time, skips the ones with nothing to look up, and reports progress', async () => {
    const { jobId } = ok(await call('citations:refreshMany', { docIds: [hex(1), hex(3), hex(2), hex(1)] })) as { jobId: string };
    await whenCitationJobsIdle();
    const last = events.filter(([e]) => e === 'citations:progress').at(-1)![1];
    expect(last).toMatchObject({ jobId, state: 'done', total: 3, done: 2, skipped: 1, failed: 0 });
    expect(await store.citations.get(hex(2) as never)).not.toBeNull();
    expect(await store.citations.get(hex(3) as never)).toBeNull();
  });

  it('cancel stops a running job; a library switch stops it without touching the other library', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    net = async (u) => {
      await gate;
      return openAlex(u);
    };
    const a = ok(await call('citations:refreshMany', { docIds: [hex(1), hex(2)] })) as { jobId: string };
    const queued = ok(await call('citations:refreshMany', { docIds: [hex(2)] })) as { jobId: string };
    expect(ok(await call('citations:cancel', { jobId: queued.jobId }))).toEqual({ cancelled: true });
    expect(ok(await call('citations:cancel', { jobId: 'nope' }))).toEqual({ cancelled: false });
    libraryId = 'lib-2';
    release();
    await whenCitationJobsIdle();
    const states = Object.fromEntries(events.filter(([e]) => e === 'citations:progress').map(([, p]) => [p.jobId, p.state]));
    expect(states[a.jobId]).toBe('cancelled');
    expect(states[queued.jobId]).toBe('cancelled');
    expect(await store.citations.get(hex(1) as never)).toBeNull();
  });

  it('cancel while running, abortAllJobs and offline end the job', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    net = async (u) => {
      await gate;
      return openAlex(u);
    };
    const j = ok(await call('citations:refreshMany', { docIds: [hex(1), hex(2)] })) as { jobId: string };
    await new Promise((r) => setTimeout(r, 20));
    expect(ok(await call('citations:cancel', { jobId: j.jobId }))).toEqual({ cancelled: true });
    release();
    await whenCitationJobsIdle();
    expect(events.filter(([e]) => e === 'citations:progress').at(-1)![1].state).toBe('cancelled');
    const g2 = new Promise<void>((r) => (release = r));
    net = async (u) => {
      await g2;
      return openAlex(u);
    };
    ok(await call('citations:refreshMany', { docIds: [hex(1), hex(2)] }));
    await new Promise((r) => setTimeout(r, 20));
    abortAllJobs(); // app quit, library switch
    release();
    await whenCitationJobsIdle();
    expect(events.filter(([e]) => e === 'citations:progress').at(-1)![1].state).toBe('cancelled');
    net = openAlex;
    online = false;
    ok(await call('citations:refreshMany', { docIds: [hex(1)] }));
    await whenCitationJobsIdle();
    expect(events.filter(([e]) => e === 'citations:progress').at(-1)![1]).toMatchObject({ state: 'failed', failed: 1, error: { code: 'NETWORK_ERROR' } });
  });
});

describe('recommend', () => {
  beforeEach(async () => {
    ok(await call('citations:refresh', { docId: hex(1) }));
    ok(await call('citations:refresh', { docId: hex(2) }));
  });
  it('lists works cited by enough documents and not owned, with the citing documents as the reason', async () => {
    const r = ok(await call('recommend:readNext', {}));
    expect(r.documentsWithCitations).toBe(2);
    expect(r.items.map((i: any) => [i.key, i.citingCount, i.score])).toEqual([
      ['doi:10.1001/w7', 2, 2],
      ['doi:10.1001/w8', 2, 2],
    ]);
    expect(r.items[0].citing.map((c: any) => c.docId).sort()).toEqual([hex(1), hex(2)]);
    expect(r.items[0].work).toMatchObject({ doi: '10.1001/w7', title: 'Work number 7 about robots', source: 'openalex' });
    expect(ok(await call('recommend:readNext', { minCiting: 1 })).items).toHaveLength(3); // w9 is cited once; w2 is owned
  });
  it('is scoped by project members or folder, and dismissed keys disappear', async () => {
    await store.projects.put({ schemaVersion: 1, id: 'proj', kind: 'project', name: 'P', description: '', status: 'active', members: [{ docId: hex(1), addedAt: NOW }], notes: '', readingPlan: [], createdAt: NOW, updatedAt: NOW, revision: 0 } as never);
    expect(ok(await call('recommend:readNext', { projectId: 'proj', minCiting: 2 })).items).toEqual([]);
    const one = ok(await call('recommend:readNext', { projectId: 'proj', minCiting: 1 }));
    expect(one.items.map((i: any) => [i.key, i.citingCount, i.score])).toEqual([
      ['doi:10.1001/w7', 2, 1],
      ['doi:10.1001/w8', 2, 1],
    ]);
    expect(ok(await call('recommend:readNext', { folder: 'papers', minCiting: 2 })).items).toHaveLength(2);
    expect(ok(await call('recommend:readNext', { folder: 'other', minCiting: 1 })).items).toEqual([]);
    expect(fail(await call('recommend:readNext', { projectId: 'nope' })).code).toBe('NOT_FOUND');
    ok(await call('recommend:dismiss', { key: 'doi:10.1001/w7' }));
    ok(await call('recommend:dismiss', { key: 'doi:10.1001/w7' }));
    expect((await store.readWatch()).dismissedRecommendations).toEqual(['doi:10.1001/w7', 'oa:W7']); // every key of the work
    expect(ok(await call('recommend:readNext', {})).items.map((i: any) => i.key)).toEqual(['doi:10.1001/w8']);
  });
  it('a removed citing document no longer counts', async () => {
    await store.documents.remove(hex(2) as never);
    expect(ok(await call('recommend:readNext', {})).items).toEqual([]);
  });
});

describe('watch sources and checks', () => {
  const found = (ids: number[], extra: Record<string, unknown> = {}) => json({ results: ids.map((n) => work(n, extra)), meta: { next_cursor: null } });
  const filterOf = (u: string) => decodeURIComponent(new URL(u).searchParams.get('filter') ?? '');
  it('manages sources: validation, replace keeps the id, limit, removal', async () => {
    expect(fail(await call('watch:saveSource', { kind: 'topic', query: '' })).code).toBe('INVALID_REQUEST');
    const a = ok(await call('watch:saveSource', { kind: 'topic', query: 'robots', label: 'R' }));
    expect(a).toMatchObject({ kind: 'topic', query: 'robots', enabled: true, newCount: 0 });
    expect(a.id).toMatch(/^src-/);
    ok(await call('watch:saveSource', { kind: 'own-preprint', query: '' }));
    const b = ok(await call('watch:saveSource', { id: a.id, kind: 'topic', query: 'robots', label: 'Renamed', enabled: false }));
    expect(b).toMatchObject({ id: a.id, label: 'Renamed', enabled: false });
    expect(ok(await call('watch:list')).sources).toHaveLength(2);
    expect(ok(await call('watch:removeSource', { id: a.id }))).toEqual({ removed: true });
    expect(ok(await call('watch:removeSource', { id: a.id }))).toEqual({ removed: false });
  });

  it('checks a topic: first check looks back 90 days, new items are seen once, dismissed ones stay hidden, items know the library', async () => {
    const s = ok(await call('watch:saveSource', { kind: 'topic', query: 'planning robots' }));
    net = (u) => (u.pathname === '/works' ? found([1, 30]) : json({}));
    const r = ok(await call('watch:check', {}));
    expect(r).toEqual({ checked: 1, newItems: 2, failed: [] });
    const first = urls.find((u) => u.includes('/works?'))!;
    expect(new URL(first).searchParams.get('search')).toBe('planning robots');
    const since = /from_publication_date:(\d{4}-\d{2}-\d{2})/.exec(filterOf(first))![1]!;
    const days = (Date.now() - Date.parse(since)) / 86_400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91.5);
    expect(ok(await call('watch:check', {}))).toMatchObject({ checked: 1, newItems: 0 });
    expect(filterOf(urls.at(-1)!)).toBe(`from_publication_date:${new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10)}`);
    const items = ok(await call('watch:items', {}));
    expect(items.total).toBe(2);
    expect(items.items.map((i: any) => [i.externalId, i.inLibrary])).toEqual([['W30', null], ['W1', hex(1)]]) // newest published first (the source answers oldest first);
    expect(ok(await call('watch:list')).sources[0]).toMatchObject({ id: s.id, newCount: 2 });
    ok(await call('watch:dismiss', { sourceId: s.id, externalId: 'W30' }));
    expect(ok(await call('watch:items', {})).total).toBe(1);
    expect(ok(await call('watch:items', { includeDismissed: true })).total).toBe(2);
    expect(ok(await call('watch:check', {}))).toMatchObject({ newItems: 0 });
    expect(events.filter(([e]) => e === 'watch:changed').length).toBeGreaterThan(2);
  });

  it('checks authors by id and by name, venues by id and by name, and own preprints', async () => {
    net = (u) => (u.pathname === '/authors' ? json({ results: [{ id: 'https://openalex.org/A77', display_name: 'Ada Example' }] }) : u.pathname === '/sources' ? json({ results: [{ id: 'https://openalex.org/S88' }] }) : found([40], { authorships: [{ author: { display_name: 'Ada Example' } }] }));
    const mk = async (kind: string, query: string) => ok(await call('watch:saveSource', { kind, query }));
    await mk('author', 'A123');
    await mk('author', 'Some Name');
    await mk('venue', 'S5');
    await mk('venue', 'Journal Name');
    await mk('own-preprint', '');
    expect(ok(await call('watch:check', {}))).toEqual({ checked: 5, newItems: 5, failed: [] });
    const filters = urls.filter((u) => u.includes('/works?')).map(filterOf);
    expect(filters.some((f) => f.endsWith('author.id:A123'))).toBe(true);
    expect(filters.some((f) => f.endsWith('author.id:A77'))).toBe(true);
    expect(filters.some((f) => f.endsWith('primary_location.source.id:S5'))).toBe(true);
    expect(filters.some((f) => f.endsWith('primary_location.source.id:S88'))).toBe(true);
    expect(filters.some((f) => f.endsWith('author.id:A77,type:preprint'))).toBe(true); // by the profile's name variants
    settings.user.openAlexId = 'A9';
    urls.length = 0;
    ok(await call('watch:check', { sourceIds: [(ok(await call('watch:list')).sources as any[]).find((x) => x.kind === 'own-preprint').id] }));
    expect(filterOf(urls.find((u) => u.includes('/works?'))!)).toMatch(/author\.id:A9,type:preprint$/);
  });

  it('reports a failing source and runs the others; offline refuses the whole check', async () => {
    const a = ok(await call('watch:saveSource', { kind: 'topic', query: 'one' }));
    const b = ok(await call('watch:saveSource', { kind: 'topic', query: 'two' }));
    net = (u) => (u.searchParams.get('search') === 'one' ? new Response(null, { status: 400 }) : found([50]));
    expect(ok(await call('watch:check', {}))).toEqual({ checked: 1, newItems: 1, failed: [{ sourceId: a.id, code: 'NETWORK_ERROR' }] });
    expect(ok(await call('watch:list')).sources.find((x: any) => x.id === a.id).lastCheckedAt).toBeUndefined();
    expect(ok(await call('watch:list')).sources.find((x: any) => x.id === b.id).lastCheckedAt).toBeDefined();
    online = false;
    expect(fail(await call('watch:check', {}))).toMatchObject({ code: 'NETWORK_ERROR', details: { reason: 'offline' } });
  });
});

describe('published versions', () => {
  const preprint = (n: number, extra: Record<string, unknown> = {}) => doc(n, `pre/p${n}.pdf`, { arxivId: `2401.0000${n}`, title: `Preprint ${n} on planning`, authors: ['Ada Example'], year: 2024, publication: { status: 'preprint' }, ...extra });
  const publishedNet = (u: URL) => {
    const p = decodeURIComponent(u.pathname);
    if (p === '/works/doi:10.48550/arxiv.2401.00006')
      return json(work(60, { doi: 'https://doi.org/10.48550/arxiv.2401.00006', type: 'preprint', locations: [{ version: 'publishedVersion', source: { type: 'journal', display_name: 'Journal Y' }, landing_page_url: 'https://doi.org/10.1002/pub' }] }));
    if (p === '/works/doi:10.1002/pub') return json(work(61, { doi: 'https://doi.org/10.1002/pub', publication_year: 2025, biblio: { volume: '3', first_page: '10', last_page: '20' } }));
    if (p === '/works/doi:10.48550/arxiv.2401.00007') return json(work(70, { doi: 'https://doi.org/10.48550/arxiv.2401.00007', type: 'preprint' }));
    return new Response(null, { status: 404 });
  };
  beforeEach(async () => {
    await store.documents.put(preprint(6));
    await store.documents.put(preprint(7));
    await store.documents.put(preprint(8, { authors: ['Someone Else'] }));
    net = publishedNet;
  });

  it('proposes the published version of preprints only, and ownOnly keeps the profile\'s papers', async () => {
    const r = ok(await call('watch:checkPublished', {}));
    expect(r).toMatchObject({ checked: 3, failed: 0 });
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ docId: hex(6), found: { doi: '10.1002/pub', venue: 'Journal X', year: 2025, source: 'openalex' }, current: { doi: null, arxivId: '2401.00006', year: 2024 } });
    expect(ok(await call('watch:checkPublished', { ownOnly: true })).checked).toBe(2);
    expect(ok(await call('watch:checkPublished', { docIds: [hex(7)] })).checked).toBe(1);
    await store.documents.put(preprint(9));
    net = () => new Response(null, { status: 400 });
    expect(ok(await call('watch:checkPublished', { docIds: [hex(9)] }))).toMatchObject({ checked: 1, failed: 1, proposals: [] });
    online = false;
    expect(fail(await call('watch:checkPublished', {})).code).toBe('NETWORK_ERROR');
  });

  it('applies a proposal as one change that history can undo, and a stale revision is a conflict', async () => {
    const p = ok(await call('watch:checkPublished', {})).proposals[0];
    const req = { docId: p.docId, doi: p.found.doi, venue: p.found.venue, venueRef: p.found.venueRef, year: p.found.year, source: p.found.source };
    expect(fail(await call('watch:applyPublished', { ...req, expectedRevision: p.revision + 3 })).code).toBe('CONFLICT');
    const done = ok(await call('watch:applyPublished', { ...req, expectedRevision: p.revision }));
    expect(done.checkedAt).toMatch(/^\d{4}-/);
    expect(await store.documents.get(hex(6) as never)).toMatchObject({ doi: '10.1002/pub', year: 2025, ref: { venue: 'Journal X' }, publication: { status: 'published', source: 'openalex', checkedAt: done.checkedAt } });
    expect(reindexed.at(-1)).toEqual([hex(6)]);
    expect(events.some(([e, pl]) => e === 'library:changed' && pl.kind === 'documents')).toBe(true);
    expect(ok(await call('watch:checkPublished', {})).proposals).toEqual([]);
    expect(ok(await call('history:undo', { changeId: done.changeId })).changeId).toBeDefined();
    expect(await store.documents.get(hex(6) as never)).toMatchObject({ doi: null, year: 2024, publication: { status: 'preprint' } });
  });
});

/* ------------------------------------------------ phase 5 fixes ------------------------------------------------ */

const hang = (signal?: AbortSignal) =>
  new Promise<Response>((_, reject) => {
    const stop = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    if (signal?.aborted) stop();
    else signal?.addEventListener('abort', stop, { once: true });
  });
const progressOf = () => events.filter(([e]) => e === 'citations:progress').map(([, p]) => p);

describe('citation jobs: failures, order, skipping, merging', () => {
  beforeEach(async () => {
    for (const n of [4, 5, 6, 7]) await store.documents.put(doc(n, `papers/x${n}.pdf`, { doi: `10.1001/w${n + 10}`, title: `Extra paper ${n} on robots` }));
  });

  it('one timeout does not stop a job; three in a row do, and the job says it failed', async () => {
    netTuning.timeoutMs = 15;
    // the first document times out (twice: one retry), the others answer
    net = (u, signal) => (u.pathname.includes('w1') ? hang(signal) : openAlex(u));
    ok(await call('citations:refreshMany', { docIds: [hex(1), hex(2)] }));
    await whenCitationJobsIdle();
    expect(progressOf().at(-1)).toMatchObject({ state: 'done', done: 1, failed: 1 });
    expect(urls.filter((u) => u.includes('openalex') && u.includes('w1')).length).toBe(2); // tried, retried once, then the next source
    urls.length = 0;
    events.length = 0;
    net = (_u, signal) => hang(signal);
    ok(await call('citations:refreshMany', { docIds: [hex(1), hex(2), hex(4), hex(5), hex(6)], skipCheckedDays: 0 }));
    await whenCitationJobsIdle();
    expect(progressOf().at(-1)).toMatchObject({ state: 'failed', failed: 3, error: { code: 'NETWORK_ERROR' } });
    netTuning.timeoutMs = undefined;
  });

  it('runs queued jobs in order and refuses more than a handful at once', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    net = async (u) => {
      await gate;
      return openAlex(u);
    };
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((ok(await call('citations:refreshMany', { docIds: [hex(1 + (i % 2))], skipCheckedDays: 0 })) as { jobId: string }).jobId);
    expect(fail(await call('citations:refreshMany', { docIds: [hex(1)] }))).toMatchObject({ code: 'INVALID_REQUEST', details: { reason: 'too-many-jobs' } });
    release();
    await whenCitationJobsIdle();
    const order = [...new Set(progressOf().filter((p) => p.state === 'running').map((p) => p.jobId))];
    expect(order).toEqual(ids);
  });

  it('skips documents checked recently (7 days by default, 0 refreshes all) and counts unknown works apart from skipped ones', async () => {
    ok(await call('citations:refreshMany', { docIds: [hex(1), hex(2)] }));
    await whenCitationJobsIdle();
    expect(progressOf().at(-1)).toMatchObject({ done: 2, skipped: 0 });
    events.length = 0;
    ok(await call('citations:refreshMany', { docIds: [hex(1), hex(2)] }));
    await whenCitationJobsIdle();
    expect(progressOf().at(-1)).toMatchObject({ state: 'done', done: 0, skipped: 2 });
    events.length = 0;
    ok(await call('citations:refreshMany', { docIds: [hex(1), hex(2)], skipCheckedDays: 0 }));
    await whenCitationJobsIdle();
    expect(progressOf().at(-1)).toMatchObject({ done: 2, skipped: 0 });
    events.length = 0;
    // w14..w17 are unknown to the fake: not found, not skipped, not failed
    ok(await call('citations:refreshMany', { docIds: [hex(4), hex(5)] }));
    await whenCitationJobsIdle();
    expect(progressOf().at(-1)).toMatchObject({ state: 'done', done: 0, skipped: 0, notFound: 2, failed: 0 });
  });

  it('a refresh of one half does not undo what a concurrent refresh of the other half stored', async () => {
    ok(await call('citations:refresh', { docId: hex(1) }));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    net = async (u) => {
      await gate;
      return openAlex(u);
    };
    const pending = call('citations:refresh', { docId: hex(1), what: ['references'] });
    await new Promise((r) => setTimeout(r, 20));
    // meanwhile another refresh stored a different "cited by" half
    await store.citations.update(hex(1) as never, (cur) => ({ ...cur!, citedBy: [{ title: 'Stored meanwhile', authors: [], matchedDocId: null, source: 'openalex', checkedAt: NOW }], citedByCount: 99 }));
    release();
    ok(await pending);
    const file = await store.citations.get(hex(1) as never);
    expect(file?.citedBy.map((l) => l.title)).toEqual(['Stored meanwhile']);
    expect(file?.citedByCount).toBe(99);
    expect(file?.references).toHaveLength(3);
  });

  it('sets a damaged citation file aside (.corrupt) and writes a new one on refresh', async () => {
    const file = path.join(store.dataDir, 'citations', `${hex(1)}.json`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{ not json');
    expect(fail(await call('citations:get', { docId: hex(1) })).code).toBe('SCHEMA_INVALID');
    expect(ok(await call('citations:refresh', { docId: hex(1) }))).toMatchObject({ fetched: true });
    expect(await readFile(`${file}.corrupt`, 'utf8')).toBe('{ not json');
    expect((await store.citations.get(hex(1) as never))?.references).toHaveLength(3);
  });
});

describe('read next: cache, keys, untitled works', () => {
  const link = (over: Record<string, unknown>) => ({ authors: [], matchedDocId: null, source: 'semanticscholar', checkedAt: NOW, ...over });
  const putRefs = async (n: number, references: unknown[]) => store.citations.put({ schemaVersion: 1, docId: hex(n), references, citedBy: [] } as never);

  it('reuses the aggregate until a citation file or a document changes', async () => {
    await putRefs(1, [link({ doi: '10.1001/zz1', title: 'Shared work one' })]);
    await putRefs(2, [link({ doi: '10.1001/zz1', title: 'Shared work one' })]);
    const spy = vi.spyOn(store.citations, 'list');
    expect(ok(await call('recommend:readNext', {})).items).toHaveLength(1);
    expect(ok(await call('recommend:readNext', { minCiting: 1 })).items).toHaveLength(1);
    expect(ok(await call('recommend:readNext', { limit: 5 })).items).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
    ok(await call('citations:refresh', { docId: hex(1) })); // writes a citation file
    ok(await call('recommend:readNext', {}));
    expect(spy).toHaveBeenCalledTimes(2);
    organizer.invalidate(); // a document changed
    ok(await call('recommend:readNext', {}));
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('no longer recommends a work after the library gets it (the owned index follows the documents)', async () => {
    await putRefs(1, [link({ doi: '10.1001/zz2', title: 'Work that gets imported' })]);
    await putRefs(2, [link({ doi: '10.1001/zz2', title: 'Work that gets imported' })]);
    expect(ok(await call('recommend:readNext', {})).items).toHaveLength(1);
    expect(ok(await call('citations:get', { docId: hex(1) })).references[0].matched).toBeNull();
    await store.documents.put(doc(9, 'papers/imported.pdf', { doi: '10.1001/zz2' }));
    organizer.invalidate();
    expect(ok(await call('recommend:readNext', {})).items).toEqual([]);
    expect(ok(await call('citations:get', { docId: hex(1) })).references[0].matched.docId).toBe(hex(9));
  });

  it('one work keyed by a DOI by one source and by its arXiv id by another is one item, and one dismissal covers both', async () => {
    await putRefs(1, [link({ doi: '10.1001/zz3', arxivId: '2401.00003', title: 'Twin work in two sources', source: 'openalex' })]);
    await putRefs(2, [link({ arxivId: '2401.00003v2', title: 'Twin work in two sources' })]);
    const r = ok(await call('recommend:readNext', {}));
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ key: 'doi:10.1001/zz3', citingCount: 2 });
    ok(await call('recommend:dismiss', { key: 'doi:10.1001/zz3' }));
    expect((await store.readWatch()).dismissedRecommendations.sort()).toEqual(['arxiv:2401.00003', 'doi:10.1001/zz3']);
    await putRefs(3, [link({ arxivId: '2401.00003', title: 'Twin work in two sources' })]);
    expect(ok(await call('recommend:readNext', { minCiting: 1 })).items).toEqual([]);
  });

  it('hides bare OpenAlex ids (no title) and counts only real works', async () => {
    await putRefs(1, [link({ externalId: 'W555', source: 'openalex' })]);
    await putRefs(2, [link({ externalId: 'W555', source: 'openalex' })]);
    expect(ok(await call('recommend:readNext', { minCiting: 1 })).items).toEqual([]);
  });
});

describe('watch: window, progress, cancel, breaker, partial reads, authors', () => {
  const found = (ids: number[], extra: Record<string, unknown> = {}) => json({ results: ids.map((n) => work(n, extra)), meta: { next_cursor: null } });
  const watchProgress = () => events.filter(([e]) => e === 'watch:progress').map(([, p]) => p);

  it('looks back 14 days from the last check, so a work indexed late is still seen', async () => {
    const s = ok(await call('watch:saveSource', { kind: 'topic', query: 'late indexing' }));
    net = () => found([60]);
    ok(await call('watch:check', {}));
    const last = (await store.readWatch()).sources[0]!.lastCheckedAt!;
    // the work is dated before the last check but indexed after it
    net = () => found([60, 61], { publication_date: '2026-11-01' });
    urls.length = 0;
    expect(ok(await call('watch:check', {}))).toMatchObject({ checked: 1, newItems: 1 });
    const since = /from_publication_date:(\d{4}-\d{2}-\d{2})/.exec(decodeURIComponent(urls.find((u) => u.includes('/works?'))!))![1]!;
    expect((Date.parse(last) - Date.parse(since)) / 86_400_000).toBeGreaterThanOrEqual(13);
    expect((await store.readWatch()).seen.find((x) => x.externalId === 'W61')).toMatchObject({ publishedOn: '2026-11-01', sourceId: s.id });
  });

  it('reports progress, stops after three unreachable sources in a row, and can be cancelled', async () => {
    for (const q of ['one', 'two', 'three', 'four', 'five']) ok(await call('watch:saveSource', { kind: 'topic', query: q }));
    net = () => new Response(null, { status: 400 });
    const r = ok(await call('watch:check', {}));
    expect(r.checked).toBe(0);
    expect(r.failed.map((f: any) => f.code)).toEqual(['NETWORK_ERROR', 'NETWORK_ERROR', 'NETWORK_ERROR', 'STOPPED', 'STOPPED']);
    expect(urls.filter((u) => u.includes('/works?')).length).toBe(3);
    expect(watchProgress().at(-1)).toEqual({ op: 'check', done: 5, total: 5, failed: 5 });

    expect(ok(await call('watch:cancel', { op: 'check' }))).toEqual({ cancelled: false });
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    net = async (_u, signal) => {
      await Promise.race([gate, hang(signal)]);
      return found([70]);
    };
    const pending = call('watch:check', {});
    await new Promise((res) => setTimeout(res, 20));
    expect(fail(await call('watch:check', {})).code).toBe('CONFLICT');
    expect(ok(await call('watch:cancel', { op: 'check' }))).toEqual({ cancelled: true });
    release();
    expect(ok(await pending)).toMatchObject({ checked: 0, newItems: 0 });
  });

  it('a source with more works than one check reads is read from the oldest and continues from there', async () => {
    const s = ok(await call('watch:saveSource', { kind: 'topic', query: 'very busy' }));
    let page = 0;
    net = () => {
      page++;
      return json({ results: [work(100 + page, { publication_date: `2026-02-0${page}` })], meta: { next_cursor: `c${page}` } });
    };
    const r = ok(await call('watch:check', {}));
    expect(r).toMatchObject({ checked: 1, newItems: 5, failed: [{ sourceId: s.id, code: 'PARTIAL' }] });
    const src = (await store.readWatch()).sources[0]!;
    // the next check starts at the date of the last work read (14 days before the stamp), not at "now"
    expect(day(Date.parse(src.lastCheckedAt!) - 14 * 86_400_000)).toBe('2026-02-05');
  });

  it('own preprints: only authors that match the profile names, and a clear failure when none does', async () => {
    ok(await call('watch:saveSource', { kind: 'own-preprint', query: '' }));
    net = (u) =>
      u.pathname === '/authors'
        ? json({ results: [{ id: 'https://openalex.org/A1', display_name: 'Ada Example' }, { id: 'https://openalex.org/A2', display_name: 'Adam Exemplar' }, { id: 'https://openalex.org/A3', display_name: 'Bob Other' }] })
        : json({ results: [work(80, { authorships: [{ author: { display_name: 'Ada Example' } }] }), work(81, { authorships: [{ author: { display_name: 'Someone Else' } }] })], meta: { next_cursor: null } });
    expect(ok(await call('watch:check', {}))).toMatchObject({ checked: 1, newItems: 1 });
    const filter = decodeURIComponent(urls.find((u) => u.includes('/works?'))!);
    expect(filter).toContain('author.id:A1,type:preprint');
    expect(filter).not.toContain('A2');
    expect((await store.readWatch()).seen.map((x) => x.externalId)).toEqual(['W80']);
    // an id that is not an OpenAlex author id is not put into the filter
    settings.user.openAlexId = 'A1,type:article';
    urls.length = 0;
    ok(await call('watch:check', {}));
    expect(decodeURIComponent(urls.find((u) => u.includes('/works?'))!)).not.toContain('type:article');
    // no author matches the profile: the message is clear and nothing is searched wrongly
    net = (u) => (u.pathname === '/authors' ? json({ results: [{ id: 'https://openalex.org/A3', display_name: 'Bob Other' }] }) : found([82]));
    settings.user.openAlexId = '';
    expect(ok(await call('watch:check', {}))).toMatchObject({ checked: 0, failed: [{ code: 'OWN_AUTHOR_UNKNOWN' }] });
  });

  it('trims the seen list per source and keeps dismissed items as long as possible', () => {
    const mk = (sourceId: string, n: number, dismissed = false) => ({ sourceId, externalId: `${sourceId}-${n}`, firstSeenAt: NOW, dismissed, authors: [] }) as never;
    const seen = [...Array.from({ length: 6 }, (_, i) => mk('busy', i, i === 0)), ...Array.from({ length: 2 }, (_, i) => mk('quiet', i))];
    const kept = trimSeen(seen, 5);
    expect(kept).toHaveLength(5);
    expect(kept.filter((x) => x.sourceId === 'quiet')).toHaveLength(2); // the busy source pays
    expect(kept.some((x) => x.externalId === 'busy-0')).toBe(true); // dismissed, oldest, but kept
    expect(kept.some((x) => x.externalId === 'busy-1')).toBe(false); // the oldest not dismissed went
    expect(trimSeen(seen, 50)).toBe(seen);
  });

  it('sets a damaged watch.json aside on request and starts empty', async () => {
    ok(await call('watch:saveSource', { kind: 'topic', query: 'to be lost' }));
    const file = path.join(store.dataDir, 'watch.json');
    await writeFile(file, '{ broken');
    expect(fail(await call('watch:list')).code).toBe('SCHEMA_INVALID');
    expect(ok(await call('watch:reset'))).toEqual({ backedUp: true });
    expect(await readFile(`${file}.corrupt`, 'utf8')).toBe('{ broken');
    expect(ok(await call('watch:list')).sources).toEqual([]);
    expect(ok(await call('watch:reset'))).toEqual({ backedUp: false });
    ok(await call('watch:saveSource', { kind: 'topic', query: 'again' }));
  });
});

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe('published versions: duplicates, breaker, rate limit, arXiv identity', () => {
  const preprint = (n: number, extra: Record<string, unknown> = {}) => doc(n, `pre/q${n}.pdf`, { arxivId: `2402.0000${n}`, title: `Late preprint ${n} on planning`, authors: ['Ada Example'], year: 2024, publication: { status: 'preprint' }, ...extra });
  const pubNet = (n: number, pubDoi: string) => (u: URL) => {
    const p = decodeURIComponent(u.pathname);
    if (p === `/works/doi:10.48550/arxiv.2402.0000${n}`) return json(work(200 + n, { doi: `https://doi.org/10.48550/arxiv.2402.0000${n}`, type: 'preprint', locations: [{ version: 'publishedVersion', source: { type: 'journal', display_name: 'Journal Y' }, landing_page_url: `https://doi.org/${pubDoi}` }] }));
    if (p === `/works/doi:${pubDoi}`) return json(work(300 + n, { doi: `https://doi.org/${pubDoi}`, publication_year: 2025 }));
    return new Response(null, { status: 404 });
  };

  it('flags a published DOI the library already owns, refuses to apply it, and keeps the arXiv identity when the DOI was the arXiv one', async () => {
    await store.documents.put(preprint(1));
    await store.documents.put(doc(2, 'papers/published.pdf', { doi: '10.1002/owned', title: 'Late preprint 1 on planning, published' }));
    net = pubNet(1, '10.1002/owned');
    const r = ok(await call('watch:checkPublished', { docIds: [hex(1)] }));
    expect(r.proposals[0]).toMatchObject({ docId: hex(1), ownedBy: hex(2) });
    const req = { docId: hex(1), doi: '10.1002/owned', venue: null, venueRef: null, year: 2025, source: 'openalex', expectedRevision: r.proposals[0].revision };
    expect(fail(await call('watch:applyPublished', req))).toMatchObject({ code: 'CONFLICT', details: { reason: 'doi-owned', docId: hex(2) } });
    expect((await store.documents.get(hex(1) as never))?.doi).toBeNull();
    // a DOI that is not a DOI never reaches the document
    expect(fail(await call('watch:applyPublished', { ...req, doi: 'javascript:alert(1)' })).code).toBe('INVALID_REQUEST');

    // the arXiv DOI was the only identity: it becomes the arXiv id when the journal DOI replaces it
    await store.documents.put(preprint(3, { doi: '10.48550/arxiv.2402.00003v2', arxivId: null }));
    net = pubNet(3, '10.1003/fresh');
    const p = ok(await call('watch:checkPublished', { docIds: [hex(3)] })).proposals[0];
    expect(p.ownedBy).toBeUndefined();
    ok(await call('watch:applyPublished', { docId: hex(3), doi: '10.1003/fresh', venue: 'Journal Y', venueRef: null, year: 2025, source: 'openalex', expectedRevision: p.revision }));
    expect(await store.documents.get(hex(3) as never)).toMatchObject({ doi: '10.1003/fresh', arxivId: '2402.00003' });
  });

  it('stops after three documents whose sources fail and counts the rest as failed', async () => {
    for (const n of [1, 2, 3, 4, 5]) await store.documents.put(preprint(n));
    net = () => new Response(null, { status: 400 });
    const r = ok(await call('watch:checkPublished', { docIds: [hex(1), hex(2), hex(3), hex(4), hex(5)] }));
    expect(r).toMatchObject({ checked: 3, failed: 5, proposals: [] });
    expect(events.filter(([e]) => e === 'watch:progress').at(-1)![1]).toMatchObject({ op: 'checkPublished', done: 3, total: 5 });
  });

  it('leaves a source that asked to slow down alone for the rest of the check', async () => {
    for (const n of [1, 2, 3]) await store.documents.put(preprint(n));
    net = (u) => (u.host === 'api.semanticscholar.org' ? new Response(null, { status: 429 }) : new Response(null, { status: 404 }));
    ok(await call('watch:checkPublished', { docIds: [hex(1), hex(2), hex(3)] }));
    const s2 = urls.filter((u) => u.includes('semanticscholar'));
    expect(s2.length).toBeGreaterThan(0);
    expect(s2.every((u) => u.includes('2402.00001'))).toBe(true); // only the first document reached it
  });
});

describe('citations:openExternal', () => {
  it('opens a DOI, arXiv and OpenAlex page built in main, and refuses anything of the wrong shape', async () => {
    for (const [kind, id] of [['doi', '10.1000/abc'], ['doi', 'https://doi.org/10.1000/a<b>?#'], ['arxiv', 'arXiv:2401.01234v2'], ['arxiv', 'hep-th/9901001'], ['openalex', 'W123']] as const) ok(await call('citations:openExternal', { kind, id }));
    expect(openedUrls).toEqual(['https://doi.org/10.1000/abc', 'https://doi.org/10.1000/a%3Cb%3E%3F%23', 'https://arxiv.org/abs/2401.01234v2', 'https://arxiv.org/abs/hep-th/9901001', 'https://openalex.org/W123']);
    openedUrls.length = 0;
    for (const [kind, id] of [
      ['doi', 'https://evil.example/10.1000/x'],
      ['doi', '10.1/short'],
      ['doi', '10.1000/../../x'],
      ['doi', '10.1000/a‮b'],
      ['doi', '10.1000/a\u0000b'],
      ['doi', '@evil.example/x'],
      ['arxiv', '../../x'],
      ['arxiv', '2401.01234?x=1'],
      ['openalex', 'W1/../../x'],
      ['openalex', 'https://openalex.org/W1'],
    ] as const) expect(fail(await call('citations:openExternal', { kind, id })).code).toBe('INVALID_REQUEST');
    expect(fail(await call('citations:openExternal', { kind: 'url', id: 'https://evil.example' })).code).toBe('INVALID_REQUEST');
    expect(openedUrls).toEqual([]);
  });
});

describe('net fixtures hook', () => {
  let file: string;
  beforeEach(async () => {
    file = path.join(root, 'fixtures.json');
    await writeFile(
      file,
      JSON.stringify({
        'https://api.openalex.org/works/doi:10.1001/w1': WORKS['10.1001/w1'],
        'https://api.openalex.org/works?filter=openalex_id:W2|W7|W8&per-page=50&select=id,doi,title,publication_year,authorships,primary_location': { results: [work(2)] },
        'https://api.openalex.org/works': { results: [], meta: { next_cursor: null } },
        'https://export.arxiv.org/api/query?id_list=2401.00001': '<feed/>',
        'https://api.semanticscholar.org/graph/v1/paper/DOI:10.1001/gone': { status: 404 },
      }),
    );
  });
  it('serves exact keys (query decoded and sorted, mailto and api_key ignored), then the key without a query, else 404', async () => {
    const f = fixtureFetch(file);
    expect((await f('https://api.openalex.org/works/doi:10.1001/w1?select=id&mailto=x%40y.z&api_key=zzz')).status).toBe(200);
    const batch = await f('https://api.openalex.org/works?select=id,doi,title,publication_year,authorships,primary_location&per-page=50&filter=openalex_id%3AW2%7CW7%7CW8');
    expect(((await batch.json()) as { results: unknown[] }).results).toHaveLength(1);
    expect(((await (await f('https://api.openalex.org/works?filter=cites%3AW1&cursor=*')).json()) as { results: unknown[] }).results).toEqual([]);
    expect(await (await f('https://export.arxiv.org/api/query?id_list=2401.00001')).text()).toBe('<feed/>');
    expect((await f('https://api.semanticscholar.org/graph/v1/paper/DOI:10.1001/gone?fields=x')).status).toBe(404);
    expect((await f('https://api.openalex.org/authors?search=x')).status).toBe(404);
  });
  it('replaces the network for a refresh', async () => {
    net = () => {
      throw new Error('the network must not be used');
    };
    const rt = fixtureFetch(file);
    const services = { log: createMemoryLogger(), localDataDir: os.tmpdir(), emit: () => {}, runtime: { require: async () => ({ libraryId, store, getDocument: async (id: string) => store.documents.get(id as never) }) }, settings: { get: async () => settings }, isOnline: () => true, fetch: rt } as unknown as MainServices;
    const d = createDispatcher(channels, buildHandlers(services), createMemoryLogger());
    const v = ok(await d('citations:refresh', { docId: hex(1) }));
    expect(v).toMatchObject({ fetched: true, references: [{ externalId: 'W2' }, { externalId: 'W7' }, { externalId: 'W8' }] });
  });
});
