/**
 * Online metadata of a work (phase 4, wave 4.2, inbox): OpenAlex for a DOI, arXiv for an arXiv id. Only the identifier
 * goes out (in the URL), never anything of the file and no contact data (a generic User-Agent). `fetch` is injected:
 * Electron's `net.fetch` in the app, a fake in tests. No dependency: the Atom feed of arXiv is read with a few
 * bounded regular expressions, over a response that is size-capped first.
 */
export interface WorkRef {
  doi?: string | null | undefined;
  /** With or without version (`2401.01234`, `2401.01234v2`, `hep-th/9901001`). */
  arxivId?: string | null | undefined;
}

export interface WorkMetadata {
  title: string | null;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  arxivId: string | null;
  abstract: string | null;
  publication: 'unknown' | 'preprint' | 'published' | 'withdrawn';
}

export interface WorkLookup {
  source: 'openalex' | 'arxiv';
  metadata: WorkMetadata;
}

export interface FetchWorkOptions {
  fetch: typeof fetch;
  signal?: AbortSignal | undefined;
  timeoutMs?: number;
  /** Largest response read, in bytes. */
  maxBytes?: number;
}

export class WorkLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkLookupError';
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const ABSTRACT_MAX = 20_000;
const ENTRY_MAX = 200_000;
const USER_AGENT = 'ResearchLab';

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const clean = (s: unknown, n: number): string | null => {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return t ? clip(t, n) : null;
};

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > maxBytes) throw new WorkLookupError('response too large');
  if (!res.body) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) throw new WorkLookupError('response too large');
    return new TextDecoder().decode(buf);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new WorkLookupError('response too large');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** The only hosts a lookup may talk to, whatever a redirect says. */
const ALLOWED_HOSTS = new Set(['api.openalex.org', 'export.arxiv.org']);

/** GET of an https URL with a timeout, a size cap and no cookies. Null on 404; throws `WorkLookupError` on anything else. Redirects are refused. */
async function get(url: string, accept: string, o: FetchWorkOptions): Promise<string | null> {
  if (!url.startsWith('https://')) throw new WorkLookupError('only https is used');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  o.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    if (o.signal?.aborted) throw new WorkLookupError('cancelled');
    const res = await o.fetch(url, { signal: ctl.signal, headers: { 'User-Agent': USER_AGENT, Accept: accept }, credentials: 'omit', redirect: 'manual' } as RequestInit);
    // No hop is followed (not even to the other fixed host), and a final address that is not a fixed host is refused too.
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) throw new WorkLookupError('redirect refused');
    if (res.url) {
      let host = '';
      try {
        host = new URL(res.url).host;
      } catch {
        /* refused below */
      }
      if (!res.url.startsWith('https://') || !ALLOWED_HOSTS.has(host)) throw new WorkLookupError('answer from an unexpected address');
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new WorkLookupError(`status ${res.status}`);
    return await readCapped(res, o.maxBytes ?? DEFAULT_MAX_BYTES);
  } catch (e) {
    if (e instanceof WorkLookupError) throw e;
    throw new WorkLookupError(ctl.signal.aborted ? 'timeout or cancelled' : 'network error');
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener('abort', onAbort);
  }
}

export const normaliseDoi = (doi: string): string =>
  doi
    .trim()
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '')
    .toLowerCase();

const encodePath = (s: string) => encodeURI(s).replace(/#/g, '%23').replace(/\?/g, '%3F');

/** Abstract of OpenAlex's `abstract_inverted_index` ({ word: [positions] }) back to text. */
export function abstractFromInverted(index: unknown): string | null {
  if (!index || typeof index !== 'object') return null;
  const words: string[] = [];
  let total = 0;
  for (const [word, positions] of Object.entries(index as Record<string, unknown>)) {
    if (!Array.isArray(positions)) continue;
    for (const p of positions) {
      if (typeof p !== 'number' || !Number.isInteger(p) || p < 0 || p > 100_000) continue;
      if (words[p] === undefined) total++;
      words[p] = word;
    }
    if (total > 50_000) break;
  }
  return clean(words.filter((w) => w !== undefined).join(' '), ABSTRACT_MAX);
}

const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function parseOpenAlex(json: unknown, doi: string): WorkMetadata | null {
  const w = asObj(json);
  const title = clean(w['title'] ?? w['display_name'], 2000);
  if (!title) return null;
  const authors = (Array.isArray(w['authorships']) ? w['authorships'] : [])
    .map((a) => clean(asObj(asObj(a)['author'])['display_name'], 300))
    .filter((a): a is string => a !== null)
    .slice(0, 100);
  const py = w['publication_year'];
  const year = typeof py === 'number' && Number.isInteger(py) && py >= 1000 && py <= 3000 ? py : null;
  const venue = clean(asObj(asObj(w['primary_location'])['source'])['display_name'] ?? asObj(w['host_venue'])['display_name'], 500);
  const type = typeof w['type'] === 'string' ? w['type'] : '';
  const publication = w['is_retracted'] === true ? 'withdrawn' : type === 'preprint' ? 'preprint' : 'published';
  const rawDoi = typeof w['doi'] === 'string' ? normaliseDoi(w['doi']) : doi;
  return { title, authors, year, venue, doi: clip(rawDoi || doi, 300), arxivId: null, abstract: abstractFromInverted(w['abstract_inverted_index']), publication };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,5});/gi, (m, e: string) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? decode(m[1]!) : null;
};

/** The first `<entry>` of an arXiv Atom answer; null when there is none or it is an error entry. */
export function parseArxivAtom(xml: string): WorkMetadata | null {
  const raw = /<entry>([\s\S]*?)<\/entry>/.exec(xml)?.[1];
  if (!raw) return null;
  // A real entry is a few KB; capping it keeps the tag scans below cheap on a hostile answer.
  const entry = raw.length > ENTRY_MAX ? raw.slice(0, ENTRY_MAX) : raw;
  const idUrl = tag(entry, 'id') ?? '';
  const idMatch = /arxiv\.org\/abs\/([^\s<]+)$/.exec(idUrl.trim());
  if (!idMatch) return null;
  const title = clean(tag(entry, 'title'), 2000);
  if (!title) return null;
  const authors = [...entry.matchAll(/<author>([\s\S]*?)<\/author>/g)]
    .map((m) => clean(tag(m[1]!, 'name'), 300))
    .filter((a): a is string => a !== null)
    .slice(0, 100);
  const published = tag(entry, 'published') ?? '';
  const y = Number(/^(\d{4})-/.exec(published)?.[1]);
  const doi = clean(tag(entry, 'arxiv:doi'), 300);
  const journal = clean(tag(entry, 'arxiv:journal_ref'), 500);
  return {
    title,
    authors,
    year: Number.isInteger(y) && y >= 1000 ? y : null,
    venue: journal,
    doi: doi ? normaliseDoi(doi) : null,
    arxivId: clip(idMatch[1]!, 300),
    abstract: clean(tag(entry, 'summary'), ABSTRACT_MAX),
    publication: doi || journal ? 'published' : 'preprint',
  };
}

/**
 * Looks a work up: OpenAlex by DOI first, then arXiv by id. Null when nothing was found; throws `WorkLookupError` when
 * every source that was tried failed (network, status, size) so the caller can say "offline/error" and retry later.
 */
export async function fetchWorkMetadata(ref: WorkRef, o: FetchWorkOptions): Promise<WorkLookup | null> {
  let failed: WorkLookupError | null = null;
  let tried = 0;
  const doi = ref.doi ? normaliseDoi(ref.doi) : '';
  if (doi) {
    tried++;
    try {
      const text = await get(`https://api.openalex.org/works/doi:${encodePath(doi)}`, 'application/json', o);
      if (text !== null) {
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch {
          throw new WorkLookupError('invalid answer');
        }
        const metadata = parseOpenAlex(json, doi);
        if (metadata) return { source: 'openalex', metadata };
      }
    } catch (e) {
      if (!(e instanceof WorkLookupError) || o.signal?.aborted) throw e;
      failed = e;
    }
  }
  const arxiv = ref.arxivId?.trim().replace(/^arxiv:\s*/i, '');
  if (arxiv && /^[a-z0-9.\-/]{4,60}$/i.test(arxiv)) {
    tried++;
    try {
      const text = await get(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxiv.replace(/v\d+$/i, ''))}`, 'application/atom+xml', o);
      const metadata = text === null ? null : parseArxivAtom(text);
      if (metadata) return { source: 'arxiv', metadata };
      // Not found there: an earlier OpenAlex ERROR stays the outcome (retryable), not a sticky not-found.
    } catch (e) {
      if (!(e instanceof WorkLookupError) || o.signal?.aborted) throw e;
      failed = e;
    }
  }
  if (tried > 0 && failed) throw failed;
  return null;
}
