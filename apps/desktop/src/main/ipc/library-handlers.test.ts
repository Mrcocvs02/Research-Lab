import { describe, expect, it } from 'vitest';
import { AppError, channels, createDispatcher, createMemoryLogger, type IpcEnvelope, type ScanStatus } from '@rl/core';
import { buildHandlers, type MainServices } from './handlers/index.js';

const DOC = 'abcdef0123456789';
const status = (patch: Partial<ScanStatus> = {}): ScanStatus => ({ libraryId: 'lib-a', state: 'idle', seen: 0, processed: 0, indexed: 0, ...patch });

function setup() {
  const calls: Array<[string, unknown]> = [];
  const rt = {
    startScan: (o: unknown) => (calls.push(['startScan', o]), status({ state: 'running' })),
    cancel: () => (calls.push(['cancel', null]), status({ state: 'cancelled' })),
    rebuild: async () => (calls.push(['rebuild', null]), status({ state: 'running' })),
    search: async (q: unknown) => {
      calls.push(['search', q]);
      return {
        total: 1,
        hits: [
          {
            docId: DOC,
            score: 1.5,
            field: 'text' as const,
            snippet: 'a [[hit]]',
            page: 3,
            pages: [{ page: 3, snippet: 'a [[hit]]' }],
            title: 'T',
            authors: ['A'],
            year: 2020,
            type: null,
            path: 'x/y.pdf',
            studyState: 'to-read' as const,
            size: 10,
            tags: [],
          },
        ],
      };
    },
    facets: async () => ({
      total: 1,
      tags: [{ value: 'ml', count: 1 }],
      authors: [],
      types: [{ value: 'article', count: 1 }],
      venues: [],
      studyStates: [],
      years: [{ value: '2020', count: 1 }],
      folders: [],
      labels: { tags: { ml: 'Machine learning' }, types: { article: 'Article' } },
    }),
    list: async (q: unknown) => (calls.push(['list', q]), { total: 0, items: [] }),
    getDocument: async (id: string) => {
      throw new AppError('NOT_FOUND', `no ${id}`);
    },
  };
  let active: string | null = 'lib-a';
  const runtime: MainServices['runtime'] = {
    sync: async () => {},
    hold: () => () => {},
    status: () => status({ libraryId: active }),
    require: async (libraryId?: string) => {
      if (!active) throw new AppError('LIBRARY_NOT_ACTIVE', 'none');
      if (libraryId !== undefined && libraryId !== active) throw new AppError('LIBRARY_NOT_ACTIVE', 'other');
      return rt as never;
    },
  };
  const log = createMemoryLogger();
  const dispatch = createDispatcher(channels, buildHandlers({ runtime, log } as unknown as MainServices), log);
  const call = (channel: string, payload: unknown = {}) => dispatch(channel, payload);
  return { call, calls, setActive: (id: string | null) => (active = id) };
}

const data = (r: IpcEnvelope) => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.data as Record<string, any>;
};
const code = (r: IpcEnvelope) => (r.ok ? 'ok' : r.error.code);

describe('scan, index, search and documents handlers', () => {
  it('scan:start / cancel / status go to the active runtime', async () => {
    const { call, calls } = setup();
    expect(data(await call('scan:start', { full: true })).state).toBe('running');
    expect(calls[0]).toEqual(['startScan', { full: true }]);
    expect(data(await call('scan:cancel')).state).toBe('cancelled');
    expect(data(await call('scan:status')).libraryId).toBe('lib-a');
    expect(data(await call('index:rebuild')).state).toBe('running');
  });

  it('refuses another library and a missing one', async () => {
    const { call, setActive } = setup();
    expect(code(await call('scan:start', { libraryId: 'lib-b' }))).toBe('LIBRARY_NOT_ACTIVE');
    expect(code(await call('scan:status', { libraryId: 'lib-b' }))).toBe('LIBRARY_NOT_ACTIVE');
    setActive(null);
    expect(code(await call('search:query', { text: 'x' }))).toBe('LIBRARY_NOT_ACTIVE');
    expect(code(await call('documents:list', {}))).toBe('LIBRARY_NOT_ACTIVE');
  });

  it('validates the requests', async () => {
    const { call } = setup();
    expect(code(await call('search:query', { text: 'x'.repeat(501) }))).toBe('INVALID_REQUEST');
    expect(code(await call('search:query', { text: 'x', limit: 5000 }))).toBe('INVALID_REQUEST');
    expect(code(await call('search:query', { text: 'x', filters: { folders: ['/abs'] } }))).toBe('INVALID_REQUEST');
    expect(code(await call('search:query', { text: 'x', sort: 'random' }))).toBe('INVALID_REQUEST');
    // New in D-130: a folder filter is confined like any path; tag lists are bounded; size is a sort.
    expect(code(await call('search:query', { text: 'x', filters: { folder: '/abs' } }))).toBe('INVALID_REQUEST');
    expect(code(await call('search:query', { text: 'x', filters: { folder: 'a/../..' } }))).toBe('INVALID_REQUEST');
    expect(code(await call('search:query', { text: 'x', filters: { tagsAny: Array.from({ length: 51 }, (_, i) => `t${i}`) } }))).toBe('INVALID_REQUEST');
    expect(code(await call('search:query', { text: 'x', filters: { tagsExclude: [''] } }))).toBe('INVALID_REQUEST');
    expect(code(await call('documents:list', { sort: 'random' }))).toBe('INVALID_REQUEST');
    expect(code(await call('documents:list', { sort: 'size-desc', filters: { folder: 'a/b', includeSubfolders: false, tagsAny: ['t'], tagsExclude: ['u'] } }))).toBe('ok');
    expect(code(await call('search:query', { text: 'x', sort: 'size-asc', filters: { folder: '' } }))).toBe('ok');
    expect(code(await call('search:query', { text: 'x', extra: 1 }))).toBe('ok'); // unknown keys are dropped, not trusted
    expect(code(await call('scan:start', { libraryId: '../x' }))).toBe('INVALID_REQUEST');
    expect(code(await call('documents:get', { docId: 'nothex' }))).toBe('INVALID_REQUEST');
    expect(code(await call('documents:list', { offset: -1 }))).toBe('INVALID_REQUEST');
  });

  it('search:query returns ids, relative paths, snippets, pages and timing', async () => {
    const { call, calls } = setup();
    const r = data(await call('search:query', { text: 'hit', filters: { tags: ['ml'], yearFrom: 2019 }, sort: 'year-desc', limit: 10, offset: 5 }));
    expect(calls.find((c) => c[0] === 'search')![1]).toEqual({ text: 'hit', filters: { tags: ['ml'], yearFrom: 2019 }, sort: 'year-desc', limit: 10, offset: 5 });
    expect(r.total).toBe(1);
    expect(r.tookMs).toBeGreaterThanOrEqual(0);
    expect(r.hits[0]).toMatchObject({ docId: DOC, title: 'T', authors: ['A'], year: 2020, path: 'x/y.pdf', snippet: 'a [[hit]]', page: 3, score: 1.5 });
    expect(r.hits[0].pages).toEqual([{ page: 3, snippet: 'a [[hit]]' }]);
  });

  it('search:facets adds the labels of tags and types', async () => {
    const { call } = setup();
    const f = data(await call('search:facets', { text: '' }));
    expect(f.tags).toEqual([{ value: 'ml', label: 'Machine learning', count: 1 }]);
    expect(f.types[0].label).toBe('Article');
    expect(f.labels).toBeUndefined();
  });

  it('documents:get maps a missing document to NOT_FOUND', async () => {
    const { call } = setup();
    expect(code(await call('documents:get', { docId: DOC }))).toBe('NOT_FOUND');
    expect(data(await call('documents:list', { limit: 10, sort: 'title' })).total).toBe(0);
  });
});
