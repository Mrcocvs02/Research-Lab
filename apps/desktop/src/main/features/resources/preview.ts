import dns from 'node:dns/promises';
import { checkPublicUrl, checkResolved, type GuardOptions } from './guard.js';

/** What the preview reads of a page: 512 KB at most (17.4.4). */
export const PREVIEW_MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

export interface PreviewResult {
  title: string | null;
  description: string | null;
}

export class PreviewError extends Error {
  constructor(readonly reason: 'refused' | 'unreachable' | 'too-large' | 'not-html') {
    super(reason);
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const point = (n: number) => (n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '');
const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n: string) => point(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => point(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
// Control and bidirectional-override characters become spaces.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;
const tidy = (s: string, n: number) => decode(s).replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim().slice(0, n) || null;

/** Title and description meta of an HTML text. Nothing else is read, nothing is executed. */
export function parseHead(html: string): PreviewResult {
  const head = html.slice(0, PREVIEW_MAX_BYTES);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? null;
  let description: string | null = null;
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = /(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (key !== 'description' && key !== 'og:description') continue;
    const content = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag);
    const value = content?.[1] ?? content?.[2];
    if (!value) continue;
    if (key === 'description') {
      description = value;
      break;
    }
    description ??= value;
  }
  return { title: title ? tidy(title, 300) : null, description: description ? tidy(description, 600) : null };
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > PREVIEW_MAX_BYTES) {
      // The head of a page is in its first bytes: what is read so far is enough; the rest is not downloaded.
      await reader.cancel().catch(() => {});
      chunks.push(value.subarray(0, value.length - (total - PREVIEW_MAX_BYTES)));
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

const sameAddresses = (a: readonly string[], b: readonly string[]): boolean => {
  const x = new Set(a.map((s) => s.toLowerCase()));
  const y = new Set(b.map((s) => s.toLowerCase()));
  return y.size > 0 && x.size === y.size && [...y].every((s) => x.has(s));
};

export interface PreviewDeps extends GuardOptions {
  fetch: typeof fetch;
  /** Resolves a name to its addresses; absent: the system resolver. */
  resolve?: (host: string) => Promise<string[]>;
}

/**
 * "Load the preview" of a link (the user asked, and the dialog says the site is contacted): a GET without cookies or
 * credentials, redirects followed by hand (3 at most, each checked again), http(s) and public hosts only, 512 KB at
 * most, only the title and the description are kept. No image is fetched.
 */
export async function loadPreview(startUrl: string, d: PreviewDeps): Promise<PreviewResult> {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const v = checkPublicUrl(url, d);
    if (!v.ok) throw new PreviewError('refused');
    const lookup = () => (d.resolve ? d.resolve(v.url.hostname) : dns.lookup(v.url.hostname, { all: true }).then((r) => r.map((x) => x.address))).catch(() => [] as string[]);
    let before: string[] = [];
    if (!d.allowLocal) {
      before = await lookup();
      if (!checkResolved(before)) throw new PreviewError(before.length === 0 ? 'unreachable' : 'refused');
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await d.fetch(v.url.href, { signal: ctl.signal, credentials: 'omit', redirect: 'manual', headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'ResearchLab-link-preview' } } as RequestInit);
      // The request resolves the name by itself and cannot be pinned to the address checked above: the name is resolved once
      // more now that the connection is made, and an answer that differs (DNS rebinding) discards the response unread.
      if (!d.allowLocal && !sameAddresses(before, await lookup())) {
        await res.body?.cancel().catch(() => {});
        throw new PreviewError('refused');
      }
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get('location');
        await res.body?.cancel().catch(() => {});
        if (!next) throw new PreviewError('unreachable');
        url = new URL(next, v.url).href;
        continue;
      }
      if (!res.ok) throw new PreviewError('unreachable');
      const type = (res.headers.get('content-type') ?? '').toLowerCase();
      if (type !== '' && !type.includes('html')) throw new PreviewError('not-html');
      // A page that announces more than 4 MB is refused outright; a smaller one is read up to the cap and cut there.
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > 4 * 1024 * 1024) {
        await res.body?.cancel().catch(() => {});
        throw new PreviewError('too-large');
      }
      return parseHead(await readCapped(res));
    } catch (e) {
      throw e instanceof PreviewError ? e : new PreviewError('unreachable');
    } finally {
      clearTimeout(timer);
    }
  }
  throw new PreviewError('unreachable');
}
