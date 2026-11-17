import { describe, expect, it } from 'vitest';
import { abstractFromInverted, fetchWorkMetadata, parseArxivAtom, parseOpenAlex, WorkLookupError } from './metadata.js';

const openAlex = {
  id: 'https://openalex.org/W1',
  doi: 'https://doi.org/10.1234/ABC.5',
  title: '  A study of  things ',
  publication_year: 2021,
  type: 'article',
  authorships: [{ author: { display_name: 'Ada Example' } }, { author: { display_name: 'Bo Sample' } }],
  primary_location: { source: { display_name: 'Journal of Tests' } },
  abstract_inverted_index: { Things: [0], are: [1], studied: [2, 4], here: [3] },
};

const atom = (entry: string) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><title>query</title>${entry}</feed>`;
const arxivEntry = `<entry>
  <id>http://arxiv.org/abs/2401.01234v2</id>
  <published>2024-01-02T10:00:00Z</published>
  <title>Learning &amp; planning
    in  games</title>
  <summary>We study <![CDATA[x < y]]> &#233;.</summary>
  <author><name>Ada Example</name></author>
  <author><name>Bo Sample</name></author>
</entry>`;

const reply = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, ...init });
const fakeFetch = (routes: Record<string, () => Response | Promise<Response>>) => {
  const seen: Array<{ url: string; init: RequestInit | undefined }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) throw new Error('unexpected url');
    return routes[key]!();
  }) as unknown as typeof fetch;
  return { f, seen };
};

describe('parsers', () => {
  it('rebuilds an abstract from the inverted index and ignores junk positions', () => {
    expect(abstractFromInverted(openAlex.abstract_inverted_index)).toBe('Things are studied here studied');
    expect(abstractFromInverted({ a: [-1, 1.5, 'x', 1e9], b: 'no' })).toBeNull();
    expect(abstractFromInverted(null)).toBeNull();
  });

  it('reads an OpenAlex work', () => {
    expect(parseOpenAlex(openAlex, '10.1234/abc.5')).toEqual({
      title: 'A study of things',
      authors: ['Ada Example', 'Bo Sample'],
      year: 2021,
      venue: 'Journal of Tests',
      doi: '10.1234/abc.5',
      arxivId: null,
      abstract: 'Things are studied here studied',
      publication: 'published',
    });
    expect(parseOpenAlex({ ...openAlex, type: 'preprint' }, 'x')!.publication).toBe('preprint');
    expect(parseOpenAlex({ ...openAlex, is_retracted: true }, 'x')!.publication).toBe('withdrawn');
    expect(parseOpenAlex({ title: null }, 'x')).toBeNull();
  });

  it('reads an arXiv Atom entry: entities, CDATA, whitespace, preprint vs published', () => {
    const m = parseArxivAtom(atom(arxivEntry))!;
    expect(m).toMatchObject({ title: 'Learning & planning in games', authors: ['Ada Example', 'Bo Sample'], year: 2024, arxivId: '2401.01234v2', doi: null, venue: null, publication: 'preprint' });
    expect(m.abstract).toBe('We study x < y é.');
    const pub = parseArxivAtom(atom(arxivEntry.replace('</entry>', '<arxiv:doi>10.5555/XYZ</arxiv:doi><arxiv:journal_ref>Proc. Tests 3</arxiv:journal_ref></entry>')))!;
    expect(pub).toMatchObject({ doi: '10.5555/xyz', venue: 'Proc. Tests 3', publication: 'published' });
    expect(parseArxivAtom(atom('<entry><id>http://arxiv.org/api/errors#x</id><title>Error</title></entry>'))).toBeNull();
    expect(parseArxivAtom(atom(''))).toBeNull();
  });
});

describe('fetchWorkMetadata', () => {
  it('asks OpenAlex for a DOI with a generic user agent and nothing else', async () => {
    const { f, seen } = fakeFetch({ 'https://api.openalex.org/works/doi:': () => reply(JSON.stringify(openAlex)) });
    const r = await fetchWorkMetadata({ doi: 'https://doi.org/10.1234/ABC.5' }, { fetch: f });
    expect(r?.source).toBe('openalex');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://api.openalex.org/works/doi:10.1234/abc.5');
    expect(JSON.stringify(seen[0]!.init?.headers)).not.toMatch(/@|mailto/);
    expect((seen[0]!.init?.headers as Record<string, string>)['User-Agent']).toBe('ResearchLab');
  });

  it('falls back to arXiv, asking for the id without its version', async () => {
    const { f, seen } = fakeFetch({
      'https://api.openalex.org/': () => reply('{}', { status: 404 }),
      'https://export.arxiv.org/api/query?id_list=': () => reply(atom(arxivEntry)),
    });
    const r = await fetchWorkMetadata({ doi: '10.1001/none', arxivId: 'arXiv:2401.01234v2' }, { fetch: f });
    expect(r?.source).toBe('arxiv');
    expect(seen.map((x) => x.url)).toEqual(['https://api.openalex.org/works/doi:10.1001/none', 'https://export.arxiv.org/api/query?id_list=2401.01234']);
  });

  it('returns null when nothing is found and throws when the sources fail', async () => {
    const nf = fakeFetch({ 'https://api.openalex.org/': () => reply('', { status: 404 }) });
    expect(await fetchWorkMetadata({ doi: '10.1001/none' }, { fetch: nf.f })).toBeNull();
    expect(await fetchWorkMetadata({}, { fetch: nf.f })).toBeNull();
    const down = fakeFetch({ 'https://api.openalex.org/': () => reply('', { status: 503 }) });
    await expect(fetchWorkMetadata({ doi: '10.1001/x' }, { fetch: down.f })).rejects.toBeInstanceOf(WorkLookupError);
    const broken = fakeFetch({ 'https://api.openalex.org/': () => reply('not json') });
    await expect(fetchWorkMetadata({ doi: '10.1001/x' }, { fetch: broken.f })).rejects.toThrow('invalid answer');
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(fetchWorkMetadata({ doi: '10.1001/x' }, { fetch: offline })).rejects.toThrow('network error');
  });

  it('caps the response size and the time, and honours an abort', async () => {
    const big = fakeFetch({ 'https://api.openalex.org/': () => reply('x'.repeat(5000)) });
    await expect(fetchWorkMetadata({ doi: '10.1001/x' }, { fetch: big.f, maxBytes: 1000 })).rejects.toThrow('too large');
    const hang = (async (_u: string, init?: RequestInit) =>
      new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch;
    await expect(fetchWorkMetadata({ doi: '10.1001/x' }, { fetch: hang, timeoutMs: 20 })).rejects.toThrow('timeout');
    const ctl = new AbortController();
    const p = fetchWorkMetadata({ doi: '10.1001/x' }, { fetch: hang, signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toBeInstanceOf(WorkLookupError);
  });

  it('refuses a redirect to a non-https address', async () => {
    const f = (async () => ({ ok: true, status: 200, url: 'http://evil.example/', headers: new Headers(), text: async () => '{}' })) as unknown as typeof fetch;
    await expect(fetchWorkMetadata({ doi: '10.1001/x' }, { fetch: f })).rejects.toThrow('unexpected address');
  });

  it('does not follow redirects, not even to another https host or the other fixed host, and asks for manual redirects', async () => {
    const seen: Array<RequestInit | undefined> = [];
    const redirect = (async (_u: string, init?: RequestInit) => {
      seen.push(init);
      return new Response('', { status: 302, headers: { location: 'https://export.arxiv.org/x' } });
    }) as unknown as typeof fetch;
    await expect(fetchWorkMetadata({ doi: '10.1001/x' }, { fetch: redirect })).rejects.toThrow('redirect refused');
    expect(seen[0]?.redirect).toBe('manual');
    const elsewhere = (async () => ({ ok: true, status: 200, url: 'https://evil.example/works', headers: new Headers(), text: async () => '{}' })) as unknown as typeof fetch;
    await expect(fetchWorkMetadata({ doi: '10.1001/x' }, { fetch: elsewhere })).rejects.toThrow('unexpected address');
    const opaque = (async () => ({ ok: false, status: 0, type: 'opaqueredirect', url: '', headers: new Headers() })) as unknown as typeof fetch;
    await expect(fetchWorkMetadata({ doi: '10.1001/x' }, { fetch: opaque })).rejects.toThrow('redirect refused');
  });

  it('caps a body-less answer, and an arXiv entry is capped before parsing', async () => {
    const noBody = (async () => ({ ok: true, status: 200, url: 'https://api.openalex.org/x', headers: new Headers(), body: null, arrayBuffer: async () => new ArrayBuffer(5000) })) as unknown as typeof fetch;
    await expect(fetchWorkMetadata({ doi: '10.1001/x' }, { fetch: noBody, maxBytes: 1000 })).rejects.toThrow('too large');
    const hostile = `<entry><id>http://arxiv.org/abs/2401.01234</id><title>T</title>${'<id '.repeat(400_000)}</entry>`;
    const t0 = Date.now();
    expect(parseArxivAtom(atom(hostile))?.title).toBe('T');
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('an OpenAlex error followed by an arXiv not-found stays an error (retryable), not a sticky not-found', async () => {
    const { f } = fakeFetch({
      'https://api.openalex.org/': () => reply('', { status: 503 }),
      'https://export.arxiv.org/': () => reply(atom('')),
    });
    await expect(fetchWorkMetadata({ doi: '10.1001/x', arxivId: '2401.01234' }, { fetch: f })).rejects.toBeInstanceOf(WorkLookupError);
  });
});
