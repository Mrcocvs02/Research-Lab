import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SearchIndex } from '@rl/core';
import { SEARCH_MARK_CLOSE as C, SEARCH_MARK_OPEN as O } from '@rl/core';
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
    expect(a.snippet).toContain(`${O}Sparse${C}`);
    const b = (await index.search({ text: 'sparse' }))[1]!;
    expect(b.field).toBe('summary');
    const abl = Object.fromEntries((await index.search({ text: 'ablation' })).map((h) => [h.docId, h]));
    expect(abl[docId('c')]!.field).toBe('note');
    expect(abl[docId('d')]!.field).toBe('annotation');
    expect(abl[docId('e')]).toMatchObject({ field: 'text', page: 3 });
    expect(abl[docId('e')]!.snippet).toContain(`${O}ablation${C}`);
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
    expect(hit.pages![0]!.snippet).toContain(`${O}variance${C}`);
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
    expect(await q({ docIds: [a!, c!] })).toEqual([a, c]);
    expect(await q({ docIds: [b!], yearFrom: 2022 })).toEqual([]);
    expect(await q({ docIds: [] })).toEqual([]);
    expect(await q({ docIds: [a!, b!, c!], folders: ['x'] })).toEqual([a, b]);
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

describe('size, tag and folder filters (D-130)', () => {
  const list = async (filters: NonNullable<Parameters<SearchIndex['list']>[0]['filters']>, text = '') =>
    (await index.search({ text, filters, sort: 'title' })).map((h) => h.title);

  it('sorts by size, both ways, and reports it on rows and hits', async () => {
    await index.upsertMany([
      makeDoc({ seed: '1', title: 'Mid', size: 2000 }),
      makeDoc({ seed: '2', title: 'Big', size: 90_000 }),
      makeDoc({ seed: '3', title: 'Tiny', size: 10 }),
    ]);
    expect((await index.list({ sort: 'size-desc' })).items.map((i) => [i.title, i.size])).toEqual([['Big', 90_000], ['Mid', 2000], ['Tiny', 10]]);
    expect((await index.list({ sort: 'size-asc' })).items.map((i) => i.title)).toEqual(['Tiny', 'Mid', 'Big']);
    expect((await index.search({ text: '', sort: 'size-desc' })).map((h) => h.size)).toEqual([90_000, 2000, 10]);
    // With text, the same sorts apply to the matches.
    await index.upsert(makeDoc({ seed: '4', title: 'Mid two', size: 5 }));
    expect((await index.search({ text: 'mid', sort: 'size-asc' })).map((h) => h.title)).toEqual(['Mid two', 'Mid']);
  });

  it('tagsAny keeps documents with at least one tag, tagsExclude drops documents with any of them', async () => {
    await index.upsertMany([
      makeDoc({ seed: 'a', title: 'A', tags: ['x'] }),
      makeDoc({ seed: 'b', title: 'B', tags: ['y'] }),
      makeDoc({ seed: 'c', title: 'C', tags: ['x', 'y'] }),
      makeDoc({ seed: 'd', title: 'D', tags: ['z'] }),
      makeDoc({ seed: 'e', title: 'E' }),
    ]);
    expect(await list({ tagsAny: ['x', 'y'] })).toEqual(['A', 'B', 'C']);
    expect(await list({ tagsExclude: ['x'] })).toEqual(['B', 'D', 'E']);
    expect(await list({ tagsExclude: ['x', 'y'] })).toEqual(['D', 'E']);
    expect(await list({ tags: ['y'], tagsExclude: ['x'] })).toEqual(['B']);
    expect(await list({ tagsAny: ['x', 'z'], tagsExclude: ['y'] })).toEqual(['A', 'D']);
    expect(await list({ tagsAny: [], tagsExclude: [] })).toHaveLength(5);
    // The same with text, and through the list channel and the facets.
    expect(await list({ tagsAny: ['x', 'y'], tagsExclude: ['x'] }, 'b')).toEqual(['B']);
    expect((await index.list({ filters: { tagsAny: ['x', 'z'] } })).total).toBe(3);
    const f = await index.facets({ text: '', filters: { tagsAny: ['x', 'y'], tagsExclude: ['x'] } });
    expect(f.total).toBe(1);
    expect(f.tags).toEqual([{ value: 'y', count: 1 }]);
  });

  it('a tag filter also finds documents with a descendant of the tag, without listing the ancestor as a tag', async () => {
    // "ml" is the parent of "nn"; "deep" implies "nn" (the caller expands implications into `record.tags`).
    const terms = { nn: ['Neural nets'], ml: ['Machine learning', 'ML'] };
    await index.upsertMany([
      makeDoc({ seed: 'a', title: 'A', tags: ['nn'] }, { tagTerms: terms, tagAncestors: ['ml'] }),
      makeDoc({ seed: 'b', title: 'B', tags: ['ml'] }, { tagTerms: terms }),
      makeDoc({ seed: 'c', title: 'C', tags: ['deep', 'nn'] }, { tagTerms: { ...terms, deep: ['Deep'] }, tagAncestors: ['ml'] }),
      makeDoc({ seed: 'd', title: 'D', tags: ['other'] }),
    ]);
    expect(await list({ tags: ['ml'] })).toEqual(['A', 'B', 'C']);
    expect(await list({ tagsAny: ['ml', 'other'] })).toEqual(['A', 'B', 'C', 'D']);
    expect(await list({ tagsExclude: ['ml'] })).toEqual(['D']);
    expect(await list({ tags: ['nn'] })).toEqual(['A', 'C']);
    expect(await list({ tags: ['deep'] })).toEqual(['C']);
    // The summary and the facets keep to the document's own (expanded) tags.
    expect((await index.list({ filters: { tags: ['nn'] } })).items.map((i) => i.tags)).toEqual([['nn'], ['deep', 'nn']]);
    const f = await index.facets({ text: '', filters: { tags: ['ml'] } });
    expect(f.tags).toEqual(expect.arrayContaining([{ value: 'nn', count: 2 }, { value: 'deep', count: 1 }, { value: 'ml', count: 1 }]));
    expect(f.tags).toHaveLength(3);
    // `tag:` in the text finds descendants by the ancestor's words, like the tag filter.
    expect(await ids('tag:"machine learning"')).toHaveLength(3);
    // Changing the ancestors on the next upsert replaces the old ones.
    await index.upsert(makeDoc({ seed: 'a', title: 'A', tags: ['nn'] }, { tagTerms: terms, tagAncestors: [] }));
    expect(await list({ tags: ['ml'] })).toEqual(['B', 'C']);
  });

  it('the folder filter respects separators, is confined, and can leave sub-folders out', async () => {
    await index.upsertMany([
      makeDoc({ seed: 'r', title: 'Root', path: 'r.pdf' }),
      makeDoc({ seed: 'a', title: 'In a', path: 'a/x.pdf' }),
      makeDoc({ seed: 'ab', title: 'In a/b', path: 'a/b/x.pdf' }),
      makeDoc({ seed: 'abd', title: 'In a/b/d', path: 'a/b/d/x.pdf' }),
      makeDoc({ seed: 'abc', title: 'In a/bc', path: 'a/bc/x.pdf' }),
      makeDoc({ seed: 'a0', title: 'In a/b0', path: 'a/b0/x.pdf' }),
      makeDoc({ seed: 'AB', title: 'In A/B', path: 'A/B/x.pdf' }),
      makeDoc({ seed: 'pct', title: 'In 100%', path: '100%/x.pdf' }),
    ]);
    expect(await list({ folder: 'a/b' })).toEqual(['In a/b', 'In a/b/d']);
    expect(await list({ folder: 'a/b', includeSubfolders: true })).toEqual(['In a/b', 'In a/b/d']);
    expect(await list({ folder: 'a/b', includeSubfolders: false })).toEqual(['In a/b']);
    expect(await list({ folder: 'a' })).toEqual(['In a', 'In a/b', 'In a/b/d', 'In a/b0', 'In a/bc']);
    expect(await list({ folder: 'a', includeSubfolders: false })).toEqual(['In a']);
    expect(await list({ folder: '', includeSubfolders: false })).toEqual(['Root']);
    expect(await list({ folder: '' })).toHaveLength(8);
    expect(await list({ folder: '/a//b/./' })).toEqual(['In a/b', 'In a/b/d']);
    expect(await list({ folder: '100%' })).toEqual(['In 100%']);
    expect(await list({ folder: 'a/b/d/e' })).toEqual([]);
    // Case matters, like the paths themselves.
    expect(await list({ folder: 'A' })).toEqual(['In A/B']);
    // The older `folders` filter has the same separator rule.
    expect(await list({ folders: ['a/b'] })).toEqual(['In a/b', 'In a/b/d']);
    // Combined with text, facets and the list channel.
    expect(await list({ folder: 'a/b', includeSubfolders: false }, 'in')).toEqual(['In a/b']);
    expect((await index.list({ filters: { folder: 'a/b' } })).total).toBe(2);
    expect((await index.facets({ text: '', filters: { folder: 'a/b', includeSubfolders: false } })).total).toBe(1);
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

describe('match markers and pagination (D-080)', () => {
  it('marks only real matches: [[ ]] and control characters in the text are not markers', async () => {
    await index.upsertMany([
      makeDoc({ seed: 'wiki', title: 'Notes on [[wikilink]] syntax and ]] brackets' }, { abstract: 'The [[sparse]] idea', pages: [{ page: 1, text: 'text with [[sparse]] and \u0001forged\u0002 marks' }] }),
      makeDoc({ seed: 'plain', title: 'Plain title' }, { abstract: 'only [[brackets]] here', pages: [{ page: 1, text: 'no \u0001other\u0002 words' }] }),
    ]);
    // The brackets are not a match: a field that merely contains them is not chosen as the matching field.
    const hits = await index.search({ text: 'wikilink' });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.field).toBe('title');
    expect(hits[0]!.snippet).toContain(`${O}wikilink${C}`);
    expect(hits[0]!.snippet.replaceAll(O, '').replaceAll(C, '')).toContain('[[');
    // A page whose text carries forged markers: only the searched word is marked.
    const page = (await index.search({ text: 'sparse' })).find((h) => h.docId === docId('wiki'))!;
    const marked = [...page.pages![0]!.snippet.matchAll(new RegExp(`${O}(.*?)${C}`, 'g'))].map((m) => m[1]);
    expect(marked).toEqual(['sparse']);
    expect(page.pages![0]!.snippet.match(new RegExp(`[${O}${C}]`, 'g'))).toHaveLength(2);
    // Words from the forged markers were not turned into extra words of the page.
    expect((await index.search({ text: 'forged' }))[0]!.pages![0]!.snippet.match(new RegExp(`[${O}${C}]`, 'g'))).toHaveLength(2);
    // A field with brackets but no match never wins the "field" choice.
    const other = (await index.search({ text: 'words' }))[0]!;
    expect(other.field).toBe('text');
  });

  it('pages through more than the maximum page size with offset', async () => {
    const docs = Array.from({ length: 450 }, (_, i) => makeDoc({ seed: `p${i}`, title: `Common title ${String(i).padStart(3, '0')}` }, { abstract: 'shared words' }));
    await index.upsertMany(docs);
    for (const text of ['shared', '']) {
      const seen = new Set<string>();
      let total = 0;
      for (let offset = 0; offset < 600; offset += 25) {
        const page = await index.searchPage({ text, sort: 'title', limit: 25, offset });
        total = page.total;
        for (const h of page.hits) seen.add(h.docId);
        if (page.hits.length === 0) break;
      }
      expect(total).toBe(450);
      expect(seen.size).toBe(450);
    }
    expect((await index.searchPage({ text: 'shared', limit: 200, offset: 400 })).hits).toHaveLength(50);
    expect((await index.searchPage({ text: 'shared', limit: 25, offset: 450 })).hits).toHaveLength(0);
  });

  it('facets reuse the evaluation of the query, and never a stale one', async () => {
    await index.upsert(makeDoc({ seed: 'a', title: 'Alpha cats', tags: ['t1'] }));
    const q = { text: 'cats' };
    await index.searchPage(q);
    expect((await index.facets(q)).total).toBe(1);
    await index.upsert(makeDoc({ seed: 'b', title: 'Beta cats', tags: ['t1'] }));
    // Same text, but the data changed in between: the facets see the new document.
    expect((await index.facets(q)).total).toBe(2);
    expect((await index.facets(q)).tags).toEqual([{ value: 't1', count: 2 }]);
    // Facets without a search first, and for other text, answer for their own query.
    expect((await index.facets({ text: 'alpha' })).total).toBe(1);
  });
});

describe('ids (select all)', () => {
  it('lists the same ids, in the same order and with the same total, as the pages of the same query', async () => {
    await index.upsertMany([
      makeDoc({ seed: '1', title: 'Beta zeta', year: 2020, tags: ['x'] }),
      makeDoc({ seed: '2', title: 'alpha zeta zeta', year: 2022, tags: ['x'] }),
      makeDoc({ seed: '3', title: 'Gamma', year: null, tags: ['y'] }),
      { ...makeDoc({ seed: '4', title: 'Gone zeta', tags: ['x'] }), record: { ...makeDoc({ seed: '4', title: 'Gone zeta', tags: ['x'] }).record, missing: true } },
    ]);
    const queries = [
      { text: '' },
      { text: '', sort: 'year-asc' as const },
      { text: 'zeta' },
      { text: 'zeta', sort: 'year-desc' as const },
      { text: '', filters: { tags: ['x'] } },
      { text: 'zeta', filters: { includeMissing: true }, sort: 'title' as const },
      { text: 'nothingmatches' },
    ];
    for (const q of queries) {
      const page = await index.searchPage({ ...q, limit: 200 });
      const r = await index.ids(q);
      expect(r.ids, JSON.stringify(q)).toEqual(page.hits.map((h) => h.docId));
      expect(r.total, JSON.stringify(q)).toBe(page.total);
    }
    expect((await index.ids({ text: '', limit: 2 })).ids).toHaveLength(2);
    expect((await index.ids({ text: '', limit: 2 })).total).toBe(3);
  });
});

describe('missing documents and direct tags', () => {
  it('lists, searches and counts leave missing documents out unless asked', async () => {
    await index.upsertMany([
      makeDoc({ seed: 'a', title: 'Present zeta', tags: ['x'] }),
      { ...makeDoc({ seed: 'b', title: 'Gone zeta', tags: ['x'] }), record: { ...makeDoc({ seed: 'b', title: 'Gone zeta', tags: ['x'] }).record, missing: true } },
    ]);
    expect((await index.list({})).items.map((i) => i.title)).toEqual(['Present zeta']);
    expect((await index.list({ filters: { includeMissing: true } })).total).toBe(2);
    expect((await index.search({ text: 'zeta' })).map((h) => h.docId)).toHaveLength(1);
    expect((await index.search({ text: 'zeta', filters: { includeMissing: true } })).length).toBe(2);
    expect((await index.facets({ text: '' })).total).toBe(1);
    expect((await index.facets({ text: '', filters: { includeMissing: true } })).total).toBe(2);
  });

  it('rows carry directTags next to the tags that include the implied ones', async () => {
    await index.upsert({ ...makeDoc({ seed: 'a', title: 'Alpha', tags: ['nn', 'ml'] }), directTags: ['nn'] });
    const row = (await index.list({})).items[0];
    expect(row).toMatchObject({ tags: ['nn', 'ml'], directTags: ['nn'] });
    expect((await index.search({ text: 'alpha' }))[0]).toMatchObject({ tags: ['nn', 'ml'], directTags: ['nn'] });
    await index.upsert(makeDoc({ seed: 'b', title: 'Beta', tags: ['q'] }));
    expect((await index.search({ text: 'beta' }))[0]?.directTags).toEqual(['q']);
  });

  it('the stamp carries the taxonomy fingerprint', async () => {
    const d = makeDoc({ seed: 'a', title: 'A' });
    await index.upsert({ ...d, stampSuffix: 'abc' });
    expect([...(await index.indexedState()).values()][0]?.stamp).toBe(`${d.record.revision}:${d.record.updatedAt}|abc`);
  });
});
