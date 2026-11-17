import { readFile } from 'node:fs/promises';

/**
 * Test hook (development run with `RL_E2E=1` only, see `runtime.ts`): a JSON file of canned answers that replaces `fetch`
 * for every online source (OpenAlex, Semantic Scholar, arXiv). Keys are URLs without the `mailto` parameter, tried in
 * this order: the URL with its query parameters decoded and sorted by name (`https://host/path?a=1&b=2`), then the URL
 * without a query (`https://host/path`). A value is the JSON body, a string (sent as is, for arXiv's Atom), or
 * `{ "status": 404 }` for an empty answer with that status. Any URL not listed answers 404. The file is read at every call.
 */
export function fixtureFetch(file: string): typeof fetch {
  return (async (input: string | URL | Request) => {
    const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    let table: Record<string, unknown> = {};
    try {
      table = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    } catch {
      return new Response(null, { status: 500 });
    }
    const pairs = [...u.searchParams.entries()].filter(([k]) => k !== 'mailto').sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const base = `${u.origin}${decodeURIComponent(u.pathname)}`;
    const key = [pairs.length > 0 ? `${base}?${pairs.map(([k, v]) => `${k}=${v}`).join('&')}` : null, base].find((k) => k !== null && Object.hasOwn(table, k));
    if (!key) return new Response(null, { status: 404 });
    const v = table[key];
    if (typeof v === 'string') return new Response(v, { status: 200, headers: { 'content-type': 'application/atom+xml' } });
    const o = v as { status?: unknown } | null;
    if (o && typeof o === 'object' && Object.keys(o).length === 1 && typeof o.status === 'number') return new Response(null, { status: o.status });
    return new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}
