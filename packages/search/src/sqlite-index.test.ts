import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SearchIndex } from '@rl/core';
import { createSearchIndex, INDEX_SCHEMA_VERSION, parseQuery } from './index.js';
import { docId, makeDoc } from './test-utils.js';

let index: SearchIndex;
beforeEach(async () => {
  index = createSearchIndex();
  await index.open(':memory:');
});
afterEach(async () => {
  await index.close();
});

const ids = async (text: string, extra: Parameters<SearchIndex['search']>[0] extends infer Q ? Partial<Q> : never = {}) =>
  (await index.search({ text, ...extra })).map((h) => h.docId);

describe('query parsing', () => {
  it('quotes every token and never lets operators through', () => {
    expect(parseQuery('quantum entanglement').match).toBe('"quantum" "entanglement"');
    expect(parseQuery('"sparse attention" memory').match).toBe('"sparse attention" "memory"');
    expect(parseQuery('entangl*').match).toBe('"entangl"*');
    expect(parseQuery('cats OR dogs').match).toBe('"cats" OR "dogs"');
    expect(parseQuery('OR cats OR').match).toBe('"cats"');
    expect(parseQuery('well-known').match).toBe('"well known"');
    // Hostile input: operators and columns become plain quoted words.
    expect(parseQuery('title:foo NEAR(a b) AND NOT x').match).toBe('"title foo" "NEAR a" "b" "AND" "NOT" "x"');
    expect(parseQuery('"""').match).toBeNull();
    expect(parseQuery('(((').match).toBeNull();
  });

  it('extracts filters', () => {
    const p = parseQuery('graph author:Smith tag:"deep learning" type:article venue:Nature year:2018-2022');
    expect(p.match).toBe('"graph"');
    expect(p.filters).toMatchObject({ authors: ['smith'], tags: ['deep learning'], types: ['article'], venues: ['nature'], yearFrom: 2018, yearTo: 2022 });
    expect(parseQuery('year:>=2020').filters.yearFrom).toBe(2020);
    expect(parseQuery('year:<2020').filters.yearTo).toBe(2019);
    expect(parseQuery('year:2015').filters).toMatchObject({ yearFrom: 2015, yearTo: 2015 });
    expect(parseQuery('anno:2015 autore:rossi').filters).toMatchObject({ yearFrom: 2015, authors: ['rossi'] });
    expect(parseQuery('author:smith').hasText).toBe(false);
  });
});

describe('search', () => {
  it('ranks title above abstract above notes above body text', async () => {
    const body = [{ page: 1, text: 'we discuss entanglement briefly' }];
    await index.upsertMany([
      makeDoc({ seed: 'body', title: 'Unrelated' }, { pages: body }),
      makeDoc({ seed: 'notes', title: 'Other' }, { notes: 'entanglement is mentioned in my notes' }),
      makeDoc({ seed: 'abstract', title: 'Else' }, { abstract: 'a study of entanglement' }),
      makeDoc({ seed: 'title', title: 'Entanglement in practice' }),
    ]);
    expect(await ids('entanglement')).toEqual([docId('title'), docId('abstract'), docId('notes'), docId('body')]);
  });

  it('reports the field of the match and a marked snippet', async () => {
    await index.upsertMany([
      makeDoc({ seed: 'a', title: 'Sparse attention layouts' }),
      makeDoc({ seed: 'b', title: 'Plain' }, { abstract: 'long inputs need sparse attention to fit memory' }),
      makeDoc({ seed: 'c', title: 'Plain two' }, { notes: 'remember the ablation' }),
      makeDoc({ seed: 'd', title: 'Plain three' }, { annotations: 'highlighted: ablation study' }),
      makeDoc({ seed: 'e', title: 'Plain four' }, { pages: [{ page: 3, text: 'the ablation was repeated twice' }] }),
    ]);
    const a = (await index.search({ text: 'sparse' }))[0]!;
    expect(a).toMatchObject({ field: 'title', docId: docId('a') });
    expect(a.snippet).toContain('[[Sparse]]');
    const b = (await index.search({ text: 'sparse' }))[1]!;
    expect(b.field).toBe('summary');
    const abl = Object.fromEntries((await index.search({ text: 'ablation' })).map((h) => [h.docId, h]));
    expect(abl[docId('c')]!.field).toBe('note');
    expect(abl[docId('d')]!.field).toBe('annotation');
    expect(abl[docId('e')]).toMatchObject({ field: 'text', page: 3 });
    expect(abl[docId('e')]!.snippet).toContain('[[ablation]]');
  });

  it('knows the pages of the full text where the query matches', async () => {
    await index.upsert(
      makeDoc(
        { seed: 'long' },
        {
          pages: [
            { page: 1, text: 'introduction to the topic' },
            { page: 2, text: 'the variance decreases after repeated averaging' },
            { page: 5, text: 'proof that variance is bounded' },
            { page: 6, text: 'nothing relevant' },
          ],
        },
      ),
    );
    const hit = (await index.search({ text: 'variance' }))[0]!;
    expect(hit.pages?.map((p) => p.page)).toEqual([2, 5]);
    expect([2, 5]).toContain(hit.page);
    expect(hit.pages![0]!.snippet).toContain('[[variance]]');
  });

  it('matches phrases, prefixes, OR and ignores accents and case', async () => {
    await index.upsertMany([
      makeDoc({ seed: '1', title: 'Università e ricerca' }, { pages: [{ page: 1, text: 'sparse attention layouts reduce memory' }] }),
      makeDoc({ seed: '2', title: 'Attention is sparse' }, { pages: [{ page: 1, text: 'attention that is not sparse in layouts' }] }),
      makeDoc({ seed: '3', title: 'Entanglement of perception' }),
    ]);
    expect(await ids('universita')).toEqual([docId('1')]);
    expect(await ids('UNIVERSITÀ')).toEqual([docId('1')]);
    expect(await ids('"sparse attention"')).toEqual([docId('1')]);
    expect(await ids('entangl*')).toEqual([docId('3')]);
    expect(await ids('percep*')).toEqual([docId('3')]);
    expect((await ids('universita OR entanglement')).sort()).toEqual([docId('1'), docId('3')].sort());
    // All words must match within the metadata of a document, or within one page of its text.
    expect(await ids('entanglement perception')).toEqual([docId('3')]);
    expect(await ids('sparse layouts')).toEqual([docId('1'), docId('2')].sort());
  });

  it('never throws on hostile input', async () => {
    await index.upsert(makeDoc({ seed: 'x', title: 'Normal title' }));
    const hostile = [
      '" OR ( NEAR',
      '"',
      '((((',
      'a AND OR NOT',
      'NEAR(a b, 5)',
      'title: : :',
      '* * *',
      '-foo +bar ^baz',
      "'; DROP TABLE docs; --",
      'author:',
      'year:abc',
      '\u0000 \u0001',
      '{title}:x',
      'x'.repeat(5000),
      '\\" ""',
    ];
    for (const text of hostile) {
      await expect(index.searchPage({ text }), text).resolves.toBeDefined();
      await expect(index.facets({ text }), text).resolves.toBeDefined();
    }
    expect(await index.count()).toBe(1);
    expect(await ids('(((')).toEqual([]);
  });

  it('indexes tags with their aliases and filters by tag id or tag text', async () => {
    await index.upsertMany([
      makeDoc({ seed: 'a', tags: ['ml'] }, { tagTerms: { ml: ['Machine learning', 'ML', 'apprendimento automatico'] } }),
      makeDoc({ seed: 'b', tags: ['bio'] }, { tagTerms: { bio: ['Biology'] } }),
    ]);
    expect(await ids('apprendimento')).toEqual([docId('a')]);
    expect(await ids('tag:machine')).toEqual([docId('a')]);
    expect(await ids('', { filters: { tags: ['bio'] } })).toEqual([docId('b')]);
    expect(await ids('', { filters: { tags: ['ml', 'bio'] } })).toEqual([]);
  });

  it('applies the structured filters', async () => {
    await index.upsertMany([
      makeDoc({ seed: 'a', title: 'Graph methods', authors: ['Ada Lovelace', 'Alan Turing'], year: 2019, type: 'article', venue: 'Journal One', path: 'x/y/a.pdf', state: 'read', tags: ['t1'] }),
      makeDoc({ seed: 'b', title: 'Graph theory', authors: ['Émile Borel'], year: 2021, type: 'book', venue: 'Press Two', path: 'x/b.pdf', state: 'reading', tags: ['t1', 't2'] }),
      makeDoc({ seed: 'c', title: 'Graph tricks', authors: ['Ada Lovelace'], year: 2023, type: 'article', path: 'z/c.pdf', tags: ['t2'] }),
    ]);
    const q = async (extra: Parameters<SearchIndex['search']>[0]['filters'], text = 'graph') =>
      (await index.search({ text, filters: extra, sort: 'year-asc' })).map((h) => h.docId);
    const [a, b, c] = ['a', 'b', 'c'].map(docId);
    expect(await q({ authors: ['ada lovelace'] })).toEqual([a, c]);
    expect(await q({ authors: ['Ada Lovelace', 'Alan Turing'] })).toEqual([a]);
    expect(await q({ types: ['book'] })).toEqual([b]);
    expect(await q({ venues: ['journal one'] })).toEqual([a]);
    expect(await q({ studyStates: ['read', 'reading'] })).toEqual([a, b]);
    expect(await q({ folders: ['x'] })).toEqual([a, b]);
    expect(await q({ folders: ['x/y'] })).toEqual([a]);
    expect(await q({ folders: ['x/'] })).toEqual([a, b]);
    expect(await q({ yearFrom: 2020 })).toEqual([b, c]);
    expect(await q({ yearTo: 2020 })).toEqual([a]);
    expect(await q({ tags: ['t1', 't2'] })).toEqual([b]);
    // The same through the text.
    expect(await q(undefined, 'graph author:borel')).toEqual([b]);
    expect(await q(undefined, 'graph year:2019-2021')).toEqual([a, b]);
    expect(await q(undefined, 'graph type:article')).toEqual([a, c]);
    expect(await q(undefined, 'graph venue:press')).toEqual([b]);
    expect(await q(undefined, 'author:lovelace year:>=2020')).toEqual([c]);
    expect(await q(undefined, 'graph tag:t2')).toEqual([b, c]);
    // Filters also restrict matches that come only from the page text.
    await index.upsert(makeDoc({ seed: 'd', title: 'Zeta', year: 2000 }, { pages: [{ page: 1, text: 'graph body only' }] }));
    expect(await q({ yearFrom: 1990, yearTo: 2001 })).toEqual([docId('d')]);
  });

  it('sorts and paginates', async () => {
    await index.upsertMany([
      makeDoc({ seed: '1', title: 'Beta', year: 2020, authors: ['Zed'], addedAt: '2026-01-03T00:00:00.000Z' }),
      makeDoc({ seed: '2', title: 'alpha', year: 2022, authors: ['Amy'], addedAt: '2026-01-01T00:00:00.000Z' }),
      makeDoc({ seed: '3', title: 'Gamma', year: null, authors: [], addedAt: '2026-01-02T00:00:00.000Z' }),
    ]);
    const order = async (sort: Parameters<SearchIndex['search']>[0]['sort']) => (await index.search({ text: '', sort })).map((h) => h.title);
    expect(await order('title')).toEqual(['alpha', 'Beta', 'Gamma']);
    expect(await order('year-desc')).toEqual(['alpha', 'Beta', 'Gamma']);
    expect(await order('year-asc')).toEqual(['Beta', 'alpha', 'Gamma']);
    expect(await order('added-desc')).toEqual(['Beta', 'Gamma', 'alpha']);
    expect(await order('author')).toEqual(['alpha', 'Beta', 'Gamma']);
    const page = await index.searchPage({ text: '', limit: 2, offset: 1 });
    expect(page.total).toBe(3);
    expect(page.hits.map((h) => h.title)).toEqual(['Beta', 'Gamma']);
    // With text, any sort works too.
    await index.upsert(makeDoc({ seed: '4', title: 'Beta again', year: 2018 }));
    expect((await index.search({ text: 'beta', sort: 'year-asc' })).map((h) => h.year)).toEqual([2018, 2020]);
    const p2 = await index.searchPage({ text: 'beta', limit: 1, offset: 1 });
    expect(p2.total).toBe(2);
    expect(p2.hits).toHaveLength(1);
  });

  it('computes facets with counts for the matching documents', async () => {
    await index.upsertMany([
      makeDoc({ seed: 'a', title: 'Graph a', authors: ['Ada L'], year: 2019, type: 'article', venue: 'J1', path: 'f1/a.pdf', tags: ['t1'] }),
      makeDoc({ seed: 'b', title: 'Graph b', authors: ['Ada L', 'Bob'], year: 2019, type: 'article', venue: 'J1', path: 'f1/s/b.pdf', tags: ['t1', 't2'], state: 'read' }),
      makeDoc({ seed: 'c', title: 'Other c', authors: ['Cy'], year: 2020, type: 'book', path: 'f2/c.pdf', tags: ['t2'] }),
    ]);
    const f = await index.facets({ text: 'graph' });
    expect(f.total).toBe(2);
    expect(f.tags).toEqual([
      { value: 't1', count: 2 },
      { value: 't2', count: 1 },
    ]);
    expect(f.authors[0]).toEqual({ value: 'Ada L', count: 2 });
    expect(f.types).toEqual([{ value: 'article', count: 2 }]);
    expect(f.venues).toEqual([{ value: 'J1', count: 2 }]);
    expect(f.years).toEqual([{ value: '2019', count: 2 }]);
    expect(f.studyStates).toEqual(
      expect.arrayContaining([
        { value: 'to-read', count: 1 },
        { value: 'read', count: 1 },
      ]),
    );
    expect(f.folders).toEqual([{ value: 'f1', count: 2 }]);
    const all = await index.facets({ text: '' });
    expect(all.total).toBe(3);
    expect(all.folders).toEqual([
      { value: 'f1', count: 2 },
      { value: 'f2', count: 1 },
    ]);
    const filtered = await index.facets({ text: '', filters: { types: ['book'] } });
    expect(filtered.total).toBe(1);
    expect(filtered.tags).toEqual([{ value: 't2', count: 1 }]);
  });

  it('lists documents with filters, sort and pages', async () => {
    await index.upsertMany([
      makeDoc({ seed: 'a', title: 'B', year: 2020, tags: ['x'] }),
      makeDoc({ seed: 'b', title: 'A', year: 2021, tags: ['x'] }),
      makeDoc({ seed: 'c', title: 'C', year: 2022 }),
    ]);
    const all = await index.list({});
    expect(all.total).toBe(3);
    expect(all.items.map((i) => i.title)).toEqual(['A', 'B', 'C']);
    const tagged = await index.list({ filters: { tags: ['x'] }, sort: 'year-desc', limit: 1 });
    expect(tagged.total).toBe(2);
    expect(tagged.items).toHaveLength(1);
    expect(tagged.items[0]).toMatchObject({ title: 'A', tags: ['x'], missing: false });
  });
});

describe('incremental updates and rebuild', () => {
  it('upserts replace the old content and keep what was not passed', async () => {
    await index.upsert(makeDoc({ seed: 'a', title: 'First title' }, { notes: 'keepnote', pages: [{ page: 1, text: 'oldbody' }] }));
    await index.upsert(makeDoc({ seed: 'a', title: 'Second title' }));
    expect(await ids('first')).toEqual([]);
    expect(await ids('second')).toEqual([docId('a')]);
    expect(await ids('keepnote')).toEqual([docId('a')]); // notes kept
    expect(await ids('oldbody')).toEqual([docId('a')]); // pages kept
    await index.upsert(makeDoc({ seed: 'a', title: 'Second title' }, { pages: [{ page: 1, text: 'newbody' }], notes: '' }));
    expect(await ids('oldbody')).toEqual([]);
    expect(await ids('newbody')).toEqual([docId('a')]);
    expect(await ids('keepnote')).toEqual([]);
    expect(await index.count()).toBe(1);
    await index.upsert(makeDoc({ seed: 'a', title: 'Second title' }, { pages: [] }));
    expect(await ids('newbody')).toEqual([]);
  });

  it('removes a document everywhere', async () => {
    await index.upsertMany([makeDoc({ seed: 'a', title: 'Keep me', tags: ['t'] }, { pages: [{ page: 2, text: 'zebra' }] }), makeDoc({ seed: 'b', title: 'Drop me', authors: ['Q'] }, { pages: [{ page: 1, text: 'zebra' }] })]);
    await index.remove(docId('b'));
    await index.remove(docId('nope'));
    expect(await ids('zebra')).toEqual([docId('a')]);
    expect(await index.count()).toBe(1);
    expect((await index.facets({ text: '' })).authors).toEqual([]);
    // A new document may reuse the freed internal id without inheriting its pages.
    await index.upsert(makeDoc({ seed: 'c', title: 'Fresh' }));
    expect(await ids('zebra')).toEqual([docId('a')]);
  });

  it('keeps pages of different documents apart', async () => {
    await index.upsertMany([
      makeDoc({ seed: 'a' }, { pages: [{ page: 1, text: 'alpha' }, { page: 2, text: 'beta' }] }),
      makeDoc({ seed: 'b' }, { pages: [{ page: 1, text: 'beta' }, { page: 3, text: 'alpha' }] }),
    ]);
    const hits = await index.search({ text: 'beta' });
    const byDoc = Object.fromEntries(hits.map((h) => [h.docId, h.pages?.map((p) => p.page)]));
    expect(byDoc).toEqual({ [docId('a')]: [2], [docId('b')]: [1] });
  });

  it('upsertMany is atomic', async () => {
    const good = makeDoc({ seed: 'good' });
    const bad = makeDoc({ seed: 'bad' });
    (bad.record as { authors: unknown }).authors = { notAnArray: true }; // makes the insert throw
    await expect(index.upsertMany([good, bad])).rejects.toBeDefined();
    expect(await index.count()).toBe(0);
  });

  it('reset empties the index and indexedState tells which text is in it', async () => {
    const a = makeDoc({ seed: 'a' }, { pages: [{ page: 1, text: 'x' }] });
    await index.upsertMany([a, makeDoc({ seed: 'b' })]);
    const state = await index.indexedState();
    expect(state.get(docId('a'))?.textHash).toBe(a.record.hash);
    expect(state.get(docId('b'))?.textHash).toBeNull();
    expect(state.get(docId('a'))?.stamp).toBe(`${a.record.revision}:${a.record.updatedAt}`);
    await index.reset();
    expect(await index.count()).toBe(0);
    expect(await ids('x')).toEqual([]);
    await index.upsert(makeDoc({ seed: 'c', title: 'After reset' }));
    expect(await ids('reset')).toEqual([docId('c')]);
  });
});

describe('index file', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'rl-index-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('persists, creates parent folders, and rebuilds when the schema version differs', async () => {
    const file = path.join(dir, 'nested', 'index', 'lib.sqlite');
    const a = createSearchIndex();
    await a.open(file);
    expect(a.needsRebuild).toBe(true);
    await a.upsert(makeDoc({ seed: 'a', title: 'Persistent' }));
    await a.close();

    const b = createSearchIndex();
    await b.open(file);
    expect(b.needsRebuild).toBe(false);
    expect((await b.search({ text: 'persistent' })).length).toBe(1);
    await b.close();

    const raw = new DatabaseSync(file);
    raw.exec(`PRAGMA user_version = ${INDEX_SCHEMA_VERSION + 1}`);
    raw.close();
    const c = createSearchIndex();
    await c.open(file);
    expect(c.needsRebuild).toBe(true);
    expect(await c.count()).toBe(0);
    await c.upsert(makeDoc({ seed: 'z', title: 'Rebuilt' }));
    expect((await c.search({ text: 'rebuilt' })).length).toBe(1);
    await c.close();
  });

  it('starts over from a corrupt file', async () => {
    const { writeFile } = await import('node:fs/promises');
    const file = path.join(dir, 'broken.sqlite');
    await writeFile(file, 'this is not a database at all, just text '.repeat(50));
    const a = createSearchIndex();
    await a.open(file);
    expect(a.needsRebuild).toBe(true);
    await a.upsert(makeDoc({ seed: 'a', title: 'Works again' }));
    expect(await a.count()).toBe(1);
    await a.close();
  });
});
