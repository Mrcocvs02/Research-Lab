import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IndexableDocument, SearchIndex, SearchQuery } from '@rl/core';
import { createSearchIndex } from './index.js';
import { makeDoc } from './test-utils.js';

/**
 * Reproducible benchmark (PLAN section 4, phase 1): 1000 synthetic documents of 20 pages each, a file-based
 * index, typical queries, p95 under 200 ms. Everything is generated from a fixed seed; no real data.
 * Variables: RL_BENCH_DOCS (default 1000), RL_BENCH_PAGES (default 20), RL_BENCH_WORDS (words per page, default 300).
 */
const DOCS = Number(process.env.RL_BENCH_DOCS ?? 1000);
const PAGES = Number(process.env.RL_BENCH_PAGES ?? 20);
const WORDS = Number(process.env.RL_BENCH_WORDS ?? 300);
/** Long documents (theses, books: 300+ pages) added on top of the regular ones. */
const LONG_DOCS = Number(process.env.RL_BENCH_LONG_DOCS ?? 25);
const LONG_PAGES = Number(process.env.RL_BENCH_LONG_PAGES ?? 340);
const P95_BUDGET_MS = 200;
const ROUNDS = 20;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYL = ['ba', 'ke', 'ri', 'mo', 'tu', 'sa', 'ne', 'li', 'do', 'fu', 'ga', 'pe', 'vi', 'zo', 'cha', 'the', 'qui', 'ren', 'tal', 'um', 'er', 'ion'];
function makeVocabulary(rand: () => number, size: number): string[] {
  const words = new Set<string>();
  while (words.size < size) {
    const n = 2 + Math.floor(rand() * 3);
    let w = '';
    for (let i = 0; i < n; i++) w += SYL[Math.floor(rand() * SYL.length)];
    words.add(w);
  }
  // A few accented words so that folding is exercised.
  return [...words, 'università', 'più', 'città', 'perché', 'naïve', 'café'];
}

let dir: string;
let index: SearchIndex;
let dbFile: string;
const timings = new Map<string, number[]>();
let buildMs = 0;

interface BenchQuery {
  name: string;
  query: SearchQuery;
  /** Also compute the facets, as the interface does for every keystroke (`search:run`); the time is of both. */
  facets?: boolean;
}
let QUERIES: BenchQuery[] = [];
const makeQueries = (common: string, mid: string, rare: string, pair: string): BenchQuery[] => [
  { name: 'one common word', query: { text: common } },
  { name: 'two words (body)', query: { text: `${common} ${mid}` } },
  { name: 'rare word', query: { text: rare } },
  { name: 'phrase (common pair)', query: { text: `"${pair}"` } },
  { name: 'phrase (frequent pair)', query: { text: '"rimo tusa"' } },
  { name: 'prefix', query: { text: `${common.slice(0, 3)}*` } },
  { name: 'accent folding', query: { text: 'universita citta' } },
  { name: 'title word + author filter', query: { text: 'author:vance ZZTITLE5' } },
  { name: 'text + tag + year filters', query: { text: mid, filters: { tags: ['topic-3'], yearFrom: 2015, yearTo: 2022 } } },
  { name: 'text, sorted by year, page 2', query: { text: mid, sort: 'year-desc', offset: 25 } },
  { name: 'filters only (list)', query: { text: '', filters: { types: ['article'], studyStates: ['read'] } } },
  { name: 'hostile input', query: { text: `" OR ( NEAR ${common}` } },
  // With facets (query + facets in one request) and long documents.
  { name: 'one common word + facets', query: { text: common }, facets: true },
  { name: 'two words + facets', query: { text: `${common} ${mid}` }, facets: true },
  { name: 'prefix + facets', query: { text: `${common.slice(0, 3)}*` }, facets: true },
  { name: 'phrase + facets', query: { text: '"rimo tusa"' }, facets: true },
  { name: 'filters only + facets', query: { text: '', filters: { types: ['article'], studyStates: ['read'] } }, facets: true },
  { name: 'text + tag + year + facets', query: { text: mid, filters: { tags: ['topic-3'], yearFrom: 2015, yearTo: 2022 } }, facets: true },
  { name: 'long docs: body word + facets', query: { text: mid, filters: { types: ['thesis'] } }, facets: true },
  { name: 'long docs: common word + facets', query: { text: common, sort: 'year-desc' }, facets: true },
  { name: 'long docs: title word + facets', query: { text: 'ZZLONG' }, facets: true },
];

beforeAll(async () => {
  const rand = mulberry32(20260115);
  const vocab = makeVocabulary(rand, 4000);
  // Zipf-like: low indexes are far more frequent.
  const word = () => vocab[Math.min(vocab.length - 1, Math.floor(Math.pow(rand(), 2.2) * vocab.length))]!;
  // A common pair is forced to be frequent so the phrase query has many candidates.
  const surnames = ['vance', 'okafor', 'lindqvist', 'moreau', 'tanaka', 'rossi', 'novak', 'silva', 'haddad', 'berg'];
  dir = await mkdtemp(path.join(os.tmpdir(), 'rl-bench-'));
  dbFile = path.join(dir, 'bench.sqlite');
  index = createSearchIndex();
  await index.open(dbFile);

  const started = performance.now();
  const batch: IndexableDocument[] = [];
  for (let d = 0; d < DOCS; d++) {
    const pages = Array.from({ length: PAGES }, (_, p) => {
      const ws: string[] = [];
      for (let i = 0; i < WORDS; i++) ws.push(rand() < 0.0003 ? 'rimo tusa' : word());
      return { page: p + 1, text: ws.join(' ') + '.' };
    });
    batch.push(
      makeDoc(
        {
          seed: `bench-${d}`,
          title: `${word()} ${word()} ${word()} ZZTITLE${d % 50}`,
          authors: [`${surnames[d % surnames.length]} ${word()}`, `${surnames[(d * 7 + 3) % surnames.length]} ${word()}`],
          year: 2000 + (d % 25),
          type: d % 3 === 0 ? 'article' : 'preprint',
          venue: `Venue ${d % 12}`,
          path: `area-${d % 8}/sub-${d % 5}/doc-${d}.pdf`,
          tags: [`topic-${d % 10}`, `topic-${(d + 4) % 10}`],
          state: (['to-read', 'reading', 'read'] as const)[d % 3],
        },
        { pages, abstract: Array.from({ length: 120 }, word).join(' '), keywords: [word(), word(), word()], notes: d % 4 === 0 ? Array.from({ length: 40 }, word).join(' ') : undefined },
      ),
    );
    if (batch.length === 100) await index.upsertMany(batch.splice(0));
  }
  if (batch.length) await index.upsertMany(batch);
  // Long documents: hundreds of pages each, so a common word matches thousands of pages of a few documents.
  for (let d = 0; d < LONG_DOCS; d++) {
    const pages = Array.from({ length: LONG_PAGES + (d % 5) * 20 }, (_, p) => {
      const ws: string[] = [];
      for (let i = 0; i < WORDS; i++) ws.push(rand() < 0.0003 ? 'rimo tusa' : word());
      return { page: p + 1, text: ws.join(' ') + '.' };
    });
    batch.push(
      makeDoc(
        {
          seed: `bench-long-${d}`,
          title: `${word()} ${word()} ZZLONG`,
          authors: [`${surnames[d % surnames.length]} ${word()}`],
          year: 2005 + (d % 15),
          type: 'thesis',
          venue: `Venue ${d % 12}`,
          path: `theses/long-${d}.pdf`,
          tags: [`topic-${d % 10}`],
          state: 'to-read',
        },
        { pages, abstract: Array.from({ length: 200 }, word).join(' ') },
      ),
    );
    if (batch.length >= 5) await index.upsertMany(batch.splice(0));
  }
  if (batch.length) await index.upsertMany(batch);
  buildMs = performance.now() - started;
  QUERIES = makeQueries(vocab[0]!, vocab[150]!, vocab[3000]!, `${vocab[0]} ${vocab[1]}`);
  // eslint-disable-next-line no-console
  console.log(`build ${(buildMs / 1000).toFixed(1)} s`);

  // Warm-up (statement preparation, caches), not measured.
  const run = async (q: BenchQuery) => {
    await index.searchPage(q.query);
    if (q.facets) await index.facets(q.query);
  };
  for (const q of QUERIES) await run(q);
  for (let r = 0; r < ROUNDS; r++) {
    for (const q of QUERIES) {
      const t0 = performance.now();
      await run(q);
      const list = timings.get(q.name) ?? [];
      list.push(performance.now() - t0);
      timings.set(q.name, list);
    }
  }
}, 600_000);

afterAll(async () => {
  await index.close();
  await rm(dir, { recursive: true, force: true });
});

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};

describe.skipIf(process.env.RL_HEAVY_TESTS !== '1')(`search benchmark (${DOCS} documents x ${PAGES} pages + ${LONG_DOCS} long documents of ${LONG_PAGES}+ pages)`, () => {
  it('indexes everything', async () => {
    expect(await index.count()).toBe(DOCS + LONG_DOCS);
  });

  it(`answers typical queries with p95 under ${P95_BUDGET_MS} ms`, async () => {
    const all: number[] = [];
    const rows: string[] = [];
    for (const [name, xs] of timings) {
      all.push(...xs);
      rows.push(`${name.padEnd(30)} p50 ${pct(xs, 50).toFixed(1).padStart(6)} ms   p95 ${pct(xs, 95).toFixed(1).padStart(6)} ms`);
    }
    const size = (await stat(dbFile)).size + (await stat(dbFile + '-wal').then((s) => s.size, () => 0));
    // eslint-disable-next-line no-console
    console.log(
      [
        `index: ${DOCS + LONG_DOCS} docs, ${DOCS * PAGES + LONG_DOCS * (LONG_PAGES + 40)} pages, ${(size / 1024 / 1024).toFixed(1)} MiB on disk, built in ${(buildMs / 1000).toFixed(1)} s`,
        ...rows,
        `ALL                            p50 ${pct(all, 50).toFixed(1).padStart(6)} ms   p95 ${pct(all, 95).toFixed(1).padStart(6)} ms   max ${Math.max(...all).toFixed(1)} ms`,
      ].join('\n'),
    );
    for (const [name, xs] of timings) expect(pct(xs, 95), name).toBeLessThan(P95_BUDGET_MS);
    expect(pct(all, 95)).toBeLessThan(P95_BUDGET_MS);
  });

  it('returns sensible results', async () => {
    const hit = await index.searchPage({ text: 'ZZTITLE17' });
    expect(hit.total).toBe(Math.ceil((DOCS - 17) / 50));
    expect(hit.hits[0]!.field).toBe('title');
    const facets = await index.facets({ text: QUERIES[0]!.query.text });
    expect(facets.total).toBeGreaterThan(0);
    const long = await index.searchPage({ text: 'ZZLONG', limit: 200 });
    expect(long.total).toBe(LONG_DOCS);
    expect((await index.facets({ text: 'ZZLONG' })).types).toEqual([{ value: 'thesis', count: LONG_DOCS }]);
  });
});
