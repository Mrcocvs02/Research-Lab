import { describe, expect, it } from 'vitest';
import { AppError, channels, createDispatcher, createMemoryLogger, documentRecordSchema, type IpcEnvelope } from '@rl/core';
import { buildHandlers, type MainServices } from './handlers/index.js';

const DOC = 'abcdef0123456789';
const ABS_WIN = String.raw`C:\Users\%USERNAME%\Papers\old\paper.pdf`;
const ABS_POSIX = '/home/<user>/papers/old/paper.pdf';

const record = documentRecordSchema.parse({
  id: DOC,
  hash: 'a'.repeat(64),
  path: 'papers/paper.pdf',
  size: 10,
  mtimeMs: 1,
  title: 'A paper',
  addedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  legacy: { path: ABS_WIN, nested: { other: [ABS_POSIX] }, st: 'ok' },
});

const hit = {
  docId: DOC,
  score: 1,
  field: 'text' as const,
  snippet: 'a \u0001hit\u0002',
  title: 'A paper',
  authors: [],
  year: null,
  type: null,
  path: 'papers/paper.pdf',
  studyState: 'to-read' as const,
  size: 10,
  tags: [] as string[],
};
const facets = { total: 1, tags: [], authors: [], types: [], venues: [], studyStates: [], years: [], folders: [{ value: 'papers', count: 1 }], labels: { tags: {}, types: {} } };

function setup() {
  const order: string[] = [];
  const rt = {
    search: async () => (order.push('search'), { total: 1, hits: [hit] }),
    facets: async () => (order.push('facets'), facets),
    list: async () => ({
      total: 1,
      items: [{ docId: DOC, title: 'A paper', authors: [], year: null, type: null, venue: null, path: 'papers/paper.pdf', studyState: 'to-read' as const, tags: [], addedAt: '', missing: false, size: 10 }],
    }),
    getDocument: async (id: string) => {
      if (id !== DOC) throw new AppError('NOT_FOUND', 'no');
      return record;
    },
  };
  const runtime = { sync: async () => {}, hold: () => () => {}, status: () => ({}), require: async () => rt as never } as unknown as MainServices['runtime'];
  const log = createMemoryLogger();
  const dispatch = createDispatcher(channels, buildHandlers({ runtime, log } as unknown as MainServices), log);
  return { call: (c: string, p: unknown = {}) => dispatch(c, p), order };
}

const data = (r: IpcEnvelope) => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.data as Record<string, any>;
};

/** Every string in a value, at any depth. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}
const isAbsolute = (s: string) => /^[A-Za-z]:[\/]/.test(s) || s.startsWith('\\') || /^\/(home|Users|tmp|var|etc)\//.test(s);

describe('documents and search responses never carry absolute paths', () => {
  it('documents:get drops `legacy` (it holds absolute paths of the old index)', async () => {
    const { call } = setup();
    const r = data(await call('documents:get', { docId: DOC }));
    expect(r).not.toHaveProperty('legacy');
    expect(r.title).toBe('A paper');
    expect(r.path).toBe('papers/paper.pdf');
    const all = strings(r);
    expect(all.some((s) => s.includes('someone'))).toBe(false);
    expect(all.filter(isAbsolute)).toEqual([]);
  });

  it('no response of documents:* or search:* has an absolute path', async () => {
    const { call } = setup();
    const answers = [
      await call('documents:get', { docId: DOC }),
      await call('documents:list', {}),
      await call('search:query', { text: 'a' }),
      await call('search:facets', { text: 'a' }),
      await call('search:run', { text: 'a' }),
    ];
    for (const a of answers) expect(strings(data(a)).filter(isAbsolute)).toEqual([]);
  });

  it('search:run answers query and facets together, evaluating the query first', async () => {
    const { call, order } = setup();
    const r = data(await call('search:run', { text: 'a', limit: 25, offset: 0 }));
    expect(r.total).toBe(1);
    expect(r.hits).toHaveLength(1);
    expect(r.facets.folders).toEqual([{ value: 'papers', count: 1 }]);
    expect(r.facets.labels).toBeUndefined();
    expect(r.tookMs).toBeGreaterThanOrEqual(0);
    expect(order).toEqual(['search', 'facets']);
  });
});
