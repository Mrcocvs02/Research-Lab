import { AppError, type DocumentRecord } from '@rl/core';
import { describe, expect, it } from 'vitest';
import { buildOwnedIndex, linkKey, matchLinks } from './match.js';
import { createNet } from './net.js';
import { createCitationService, createCitationSources } from './service.js';
import { createOpenAlex } from './sources.js';
import { createWatchFetcher } from './watch.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Route = (url: URL) => Response | undefined;
function fake(...routes: Route[]) {
  const urls: string[] = [];
  const f = (async (u: string) => {
    urls.push(u);
    for (const r of routes) {
      const res = r(new URL(u));
      if (res) return res;
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, urls };
}
const noSleep = { sleep: async () => undefined };
const W = (n: number, extra: object = {}) => ({
  id: `https://openalex.org/W${n}`,
  doi: `https://doi.org/10.1001/W${n}`,
  title: `Work number ${n} about things`,
  publication_year: 2020,
  authorships: [{ author: { display_name: `Ada Person${n}` } }],
  primary_location: { source: { display_name: 'Journal X' } },
  ...extra,
});
const oaWork = (id: string) => (u: URL) => (u.host === 'api.openalex.org' && u.pathname === `/works/${id}` ? json(W(1, { cited_by_count: 7, referenced_works: ['https://openalex.org/W2', 'https://openalex.org/W3', 'https://openalex.org/W9'] })) : undefined);

describe('OpenAlex source', () => {
  const routes = [
    (u: URL) => (u.pathname === '/works/doi:10.1001/w1' ? json(W(1, { cited_by_count: 7, referenced_works: ['https://openalex.org/W2', 'https://openalex.org/W3', 'https://openalex.org/W9'] })) : undefined),
    (u: URL) => {
      const f = u.searchParams.get('filter') ?? '';
      if (f.startsWith('openalex_id:')) return json({ results: [W(3), W(2)] });
      if (f === 'cites:W1') return json(u.searchParams.get('cursor') === '*' ? { results: [W(10), W(11)], meta: { next_cursor: 'c2' } } : { results: [W(12)], meta: { next_cursor: null } });
      return undefined;
    },
  ];
  it('resolves by DOI, keeps the order of the references and counts citations; no email unless given', async () => {
    const { f, urls } = fake(...routes);
    const src = createOpenAlex(createNet({ fetch: f, ...noSleep }), () => new Date('2024-01-01T00:00:00Z'));
    const meta = await src.lookup({ doi: 'https://doi.org/10.1001/W1' });
    expect(meta).toMatchObject({ title: 'Work number 1 about things', year: 2020, externalId: 'W1', citedByCount: 7, source: 'openalex' });
    const refs = await src.fetchReferences({ doi: '10.1001/W1' });
    expect(refs.map((r) => r.externalId)).toEqual(['W2', 'W3', 'W9']);
    expect(refs[0]).toMatchObject({ doi: '10.1001/w2', authors: ['Ada Person2'], matchedDocId: null, checkedAt: '2024-01-01T00:00:00.000Z' });
    expect(refs[2]?.title).toBeUndefined();
    const cites = await src.fetchCitedBy({ doi: '10.1001/W1' });
    expect(cites.map((c) => c.externalId)).toEqual(['W10', 'W11', 'W12']);
    expect(urls.some((u) => /mailto|@/.test(u))).toBe(false);
    expect(urls.every((u) => u.startsWith('https://api.openalex.org/'))).toBe(true);
    expect(urls.find((u) => u.includes('openalex_id'))).toContain('per-page=50');
    expect(urls.find((u) => u.includes('openalex_id'))).toContain('select=');
  });

  it('adds the email only when one is supplied', async () => {
    const { f, urls } = fake(...routes);
    const on = createOpenAlex(createNet({ fetch: f, email: () => 'me@example.org', ...noSleep }), () => new Date());
    await on.lookup({ doi: '10.1001/w1' });
    expect(urls[0]).toContain('mailto=me%40example.org');
    const off = fake(...routes);
    await createOpenAlex(createNet({ fetch: off.f, email: () => null, ...noSleep }), () => new Date()).lookup({ doi: '10.1001/w1' });
    expect(off.urls[0]).not.toContain('mailto');
  });

  it('resolves an arXiv id through its DOI and a title only with a confident match', async () => {
    const { f, urls } = fake(
      (u) => (u.pathname === '/works/doi:10.48550/arxiv.2401.01234' ? json(W(5, { doi: 'https://doi.org/10.48550/arxiv.2401.01234', type: 'preprint' })) : undefined),
      (u) => (u.pathname === '/works' && u.searchParams.has('search') ? json({ results: [W(7, { title: 'Something quite different here', publication_year: 2020 }), W(8, { title: 'A long enough Title about Things', publication_year: 2020, authorships: [{ author: { display_name: 'Grace Hopper' } }] })] }) : undefined),
    );
    const src = createOpenAlex(createNet({ fetch: f, ...noSleep }), () => new Date());
    expect(await src.lookup({ arxivId: 'arXiv:2401.01234v2' })).toMatchObject({ arxivId: '2401.01234', publicationStatus: 'preprint' });
    expect(await src.lookup({ title: 'A long enough title about things', year: 2021, authors: ['G. Hopper'] })).toMatchObject({ externalId: 'W8' });
    expect(await src.lookup({ title: 'A long enough title about things', year: 2021, authors: ['Someone Else'] })).toBeNull();
    expect(urls.some((u) => u.includes('publication_year%3A2020%7C2021%7C2022'))).toBe(true);
  });

  it('finds the published version of a preprint in the locations', async () => {
    const { f } = fake(
      (u) =>
        u.pathname === '/works/doi:10.48550/arxiv.2401.01234'
          ? json(W(5, { doi: 'https://doi.org/10.48550/arxiv.2401.01234', type: 'preprint', locations: [{ source: { type: 'repository' }, landing_page_url: 'https://arxiv.org/abs/2401.01234' }, { version: 'publishedVersion', source: { type: 'journal', display_name: 'Journal Y' }, landing_page_url: 'https://doi.org/10.1002/pub' }] }))
          : undefined,
      (u) => (u.pathname === '/works/doi:10.1002/pub' ? json(W(6, { doi: 'https://doi.org/10.1002/pub', publication_year: 2024, primary_location: { source: { display_name: 'Journal Y' } }, biblio: { volume: '12', issue: '3', first_page: '45', last_page: '67' } })) : undefined),
    );
    const src = createOpenAlex(createNet({ fetch: f, ...noSleep }), () => new Date());
    expect(await src.findPublished!({ arxivId: '2401.01234' })).toEqual({ doi: '10.1002/pub', venue: 'Journal Y', venueRef: '12(3):45-67', year: 2024, source: 'openalex' });
  });
});

describe('network layer', () => {
  it('spaces requests per host (OpenAlex 200 ms, Semantic Scholar 1 s)', async () => {
    let t = 1000;
    const waits: number[] = [];
    const { f } = fake(() => json({}));
    const net = createNet({ fetch: f, now: () => t, sleep: async (ms) => void (waits.push(ms), (t += ms)) });
    await Promise.all([net.json('https://api.openalex.org/a'), net.json('https://api.openalex.org/b'), net.json('https://api.openalex.org/c')]);
    expect(waits).toEqual([200, 200]);
    waits.length = 0;
    await Promise.all([net.json('https://api.semanticscholar.org/a'), net.json('https://api.semanticscholar.org/b')]);
    expect(waits).toEqual([1000]);
  });

  it('retries 429 and 5xx twice with backoff, then reports the reason', async () => {
    let n = 0;
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    const flaky = fake(() => (++n < 3 ? new Response('', { status: 503 }) : json({ ok: 1 })));
    await expect(createNet({ fetch: flaky.f, sleep }).json('https://api.openalex.org/x')).resolves.toEqual({ ok: 1 });
    expect(n).toBe(3);
    expect(waits.filter((w) => w >= 500)).toEqual([500, 1000]);
    const limited = fake(() => new Response('', { status: 429, headers: { 'retry-after': '2' } }));
    const err = await createNet({ fetch: limited.f, sleep }).json('https://api.openalex.org/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'NETWORK_ERROR', details: { reason: 'rate-limited' } });
    expect(limited.urls).toHaveLength(3);
    const bad = await createNet({ fetch: fake(() => new Response('', { status: 400 })).f, sleep }).json('https://api.openalex.org/x').catch((e: unknown) => e);
    expect(bad).toMatchObject({ details: { reason: 'http', status: 400 } });
  });

  it('reports offline when the request cannot be made, and refuses hosts and redirects', async () => {
    const down = (async () => {
      throw new TypeError('failed');
    }) as unknown as typeof fetch;
    expect(await createNet({ fetch: down, ...noSleep }).json('https://api.openalex.org/x').catch((e: unknown) => e)).toMatchObject({ code: 'NETWORK_ERROR', details: { reason: 'offline' } });
    expect(await createNet({ fetch: fake(() => new Response('', { status: 302 })).f, ...noSleep }).json('https://api.openalex.org/x').catch((e: unknown) => e)).toMatchObject({ code: 'NETWORK_ERROR', details: { reason: 'http' } });
    const offHost = fake(() => json({}));
    expect(await createNet({ fetch: offHost.f, ...noSleep }).json('https://example.org/x').catch((e: unknown) => e)).toBeDefined();
    expect(offHost.urls).toHaveLength(0); // the host is checked before anything is sent
    const ctl = new AbortController();
    ctl.abort();
    expect(await createNet({ fetch: down }).json('https://api.openalex.org/x', ctl.signal).catch((e: unknown) => e)).toMatchObject({ code: 'CANCELLED' });
  });
});

const doc = (over: Partial<DocumentRecord>): DocumentRecord => ({ id: '0123456789abcdef', doi: null, arxivId: null, title: null, year: null, authors: [], ...over }) as DocumentRecord;

describe('matching', () => {
  const owned = buildOwnedIndex([
    doc({ id: 'aaaaaaaaaaaaaaaa', doi: 'https://doi.org/10.1001/ABC' }),
    doc({ id: 'bbbbbbbbbbbbbbbb', arxivId: '2401.01234v3' }),
    doc({ id: 'cccccccccccccccc', title: 'Évaluation of Small Things, Revisited', year: 2019, authors: ['Doe, Jane'] }),
    doc({ id: 'dddddddddddddddd', title: 'Unattributed note on things', year: null, authors: [] }),
  ]);
  const link = (o: object) => ({ authors: [], matchedDocId: null, source: 'openalex' as const, checkedAt: '2024-01-01T00:00:00.000Z', ...o });
  it('matches by DOI, arXiv base id (also through the arXiv DOI), then title + year + first author', () => {
    const m = matchLinks(
      [
        link({ doi: '10.1001/abc' }),
        link({ arxivId: 'arXiv:2401.01234v1' }),
        link({ doi: '10.48550/arXiv.2401.01234' }),
        link({ title: 'Evaluation of small things revisited', year: 2020, authors: ['Jane Doe'] }),
        link({ title: 'Evaluation of small things revisited', year: 2022, authors: ['Jane Doe'] }),
        link({ title: 'Evaluation of small things revisited', year: 2019, authors: ['Jane Smith'] }),
        link({ title: 'Unattributed note on things' }),
        link({ title: 'short' }),
      ],
      owned,
    );
    expect(m.map((l) => l.matchedDocId)).toEqual(['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'bbbbbbbbbbbbbbbb', 'cccccccccccccccc', null, null, null, null]);
  });
  it('never matches a document to itself and builds keys doi > arxiv > oa', () => {
    expect(matchLinks([link({ doi: '10.1001/abc' })], owned, 'aaaaaaaaaaaaaaaa')[0]?.matchedDocId).toBeNull();
    expect(linkKey({ doi: '10.1001/X', arxivId: '2401.1v2' })).toBe('doi:10.1001/x');
    expect(linkKey({ doi: '10.48550/arXiv.2401.01234' })).toBe('arxiv:2401.01234');
    expect(linkKey({ arxivId: 'arXiv:2401.01234v2', externalId: 'W5' })).toBe('arxiv:2401.01234');
    expect(linkKey({ externalId: 'W5' })).toBe('oa:W5');
    expect(linkKey({ title: 'x' })).toBeNull();
  });
});

describe('citation service', () => {
  const routes = [
    (u: URL) => (u.pathname === '/works/doi:10.1001/w1' ? json(W(1, { cited_by_count: 2, referenced_works: ['https://openalex.org/W2'] })) : undefined),
    (u: URL) => {
      const f = u.searchParams.get('filter') ?? '';
      if (f.startsWith('openalex_id:')) return json({ results: [W(2)] });
      if (f === 'cites:W1') return json({ results: [W(10), W(11)], meta: { next_cursor: null } });
      return undefined;
    },
  ];
  const owned = [doc({ id: 'aaaaaaaaaaaaaaaa', doi: '10.1001/w2' }), doc({ id: '0123456789abcdef', doi: '10.1001/w1' })];
  it('refreshes both halves, matches to the library, and refreshes one half keeping the other', async () => {
    const { f } = fake(...routes);
    const svc = createCitationService(createCitationSources({ fetch: f, ...noSleep }), () => new Date('2024-02-02T00:00:00Z'));
    const file = await svc.refresh(doc({ id: '0123456789abcdef', doi: '10.1001/w1' }), owned);
    expect(file).toMatchObject({ externalId: 'W1', citedByCount: 2, referencesCheckedAt: '2024-02-02T00:00:00.000Z', citedByCheckedAt: '2024-02-02T00:00:00.000Z' });
    expect(file.references.map((r) => r.matchedDocId)).toEqual(['aaaaaaaaaaaaaaaa']);
    expect(file.citedBy).toHaveLength(2);
    const later = createCitationService(createCitationSources({ fetch: f, ...noSleep }), () => new Date('2024-03-03T00:00:00Z'));
    const half = await later.refresh(doc({ id: '0123456789abcdef', doi: '10.1001/w1' }), owned, undefined, { what: ['citedBy'], previous: file });
    expect(half.references).toEqual(file.references);
    expect(half.referencesCheckedAt).toBe('2024-02-02T00:00:00.000Z');
    expect(half.citedByCheckedAt).toBe('2024-03-03T00:00:00.000Z');
  });

  it('falls back to Semantic Scholar when OpenAlex does not know the work', async () => {
    const s2 = (id: Record<string, unknown>) => ({ paperId: 'p'.repeat(40).replace(/p/g, 'a'), title: 'Fallback work about things', year: 2018, authors: [{ name: 'Ada Person' }], externalIds: id, citationCount: 3 });
    const { f, urls } = fake((u) => {
      if (u.host !== 'api.semanticscholar.org') return undefined;
      if (u.pathname.endsWith('/references')) return json({ data: [{ citedPaper: { ...s2({ DOI: '10.1009/R' }), paperId: 'r1' } }], next: undefined });
      if (u.pathname.endsWith('/citations')) return json({ data: [{ citingPaper: { ...s2({ ArXiv: '2501.00001' }), paperId: 'c1' } }] });
      return json(s2({ DOI: '10.1001/w1' }));
    });
    const svc = createCitationService(createCitationSources({ fetch: f, ...noSleep }));
    const file = await svc.refresh(doc({ id: '0123456789abcdef', doi: '10.1001/w1' }), []);
    expect(file.references[0]).toMatchObject({ doi: '10.1009/r', source: 'semanticscholar' });
    expect(file.citedBy[0]).toMatchObject({ arxivId: '2501.00001' });
    expect(file.citedByCount).toBe(3);
    expect(urls.some((u) => u.includes('/paper/DOI:10.1001/w1'))).toBe(true);
  });

  it('is NOT_FOUND when no source knows the work and passes a network error on', async () => {
    const none = createCitationService(createCitationSources({ fetch: fake().f, ...noSleep }));
    await expect(none.refresh(doc({ doi: '10.1001/zzz' }), [])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const down = createCitationService(createCitationSources({ fetch: fake(() => new Response('', { status: 400 })).f, ...noSleep }));
    await expect(down.refresh(doc({ doi: '10.1001/zzz' }), [])).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

describe('watch queries', () => {
  const since = '2024-01-01';
  it('author by id, author by name, topic, venue by id and own preprints', async () => {
    const { f, urls } = fake(
      (u) => (u.pathname === '/authors' ? json({ results: [{ id: 'https://openalex.org/A55' }] }) : undefined),
      (u) => (u.pathname === '/sources' ? json({ results: [{ id: 'https://openalex.org/S77' }] }) : undefined),
      (u) => (u.pathname === '/works' ? json({ results: [W(1)], meta: { next_cursor: null } }) : undefined),
    );
    const fetchResult = createWatchFetcher(createNet({ fetch: f, ...noSleep }));
    const fetchHits = async (q: Parameters<typeof fetchResult>[0]) => (await fetchResult(q)).hits;
    const filterOf = (i: number) => decodeURIComponent(new URL(urls[i]!).searchParams.get('filter') ?? '');
    expect(await fetchHits({ kind: 'author', query: 'a123', since })).toHaveLength(1);
    expect(filterOf(0)).toBe('from_publication_date:2024-01-01,author.id:A123');
    await fetchHits({ kind: 'author', query: 'Some Name', since });
    expect(urls[1]).toContain('/authors?search=Some%20Name');
    expect(filterOf(2)).toContain('author.id:A55');
    await fetchHits({ kind: 'topic', query: 'graph learning', since });
    expect(urls[3]).toContain('search=graph%20learning');
    expect(filterOf(3)).toBe('from_publication_date:2024-01-01');
    await fetchHits({ kind: 'venue', query: 'Journal Name', since });
    expect(filterOf(5)).toContain('primary_location.source.id:S77');
    await fetchHits({ kind: 'venue', query: 'S9', since });
    expect(filterOf(6)).toContain('primary_location.source.id:S9');
    const hits = await fetchHits({ kind: 'own-preprint', query: '', since, openAlexId: 'A9', authorVariants: ['X Y'] });
    expect(filterOf(7)).toBe('from_publication_date:2024-01-01,author.id:A9,type:preprint');
    expect(hits[0]).toMatchObject({ externalId: 'W1', doi: '10.1001/w1', authors: ['Ada Person1'], year: 2020 });
    expect(await fetchHits({ kind: 'topic', query: '  ', since })).toEqual([]);
  });
});
