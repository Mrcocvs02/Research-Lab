import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { THUMB_LIMITS } from '@rl/core';

export interface ThumbProtocolDeps {
  /** The thumbnail folder of the ACTIVE library, looked up at every request; `null` when there is none. */
  dir(): Promise<string | null>;
  /** The one origin the renderer is loaded from. */
  allowedOrigin(): string;
}

const text = (status: number, body: string) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

/**
 * Handler of `rl-thumb://thumb/<docId>?v=<hash8>` (D-196): serves `<docId>-<hash8>.webp` (drawn) or `.jpg` (from the system) from the cache folder of the
 * active library, nothing else. Both parts of the name are validated hex, so no path can come from the URL; the
 * renderer never sees a path. Anything else is 404 with a fixed text.
 */
export function createThumbHandler(deps: ThumbProtocolDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== deps.allowedOrigin()) return text(403, 'Forbidden');
    if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed');
    let name: string;
    try {
      const url = new URL(request.url);
      const id = /^\/([0-9a-f]{16})$/.exec(url.pathname)?.[1];
      const v = url.searchParams.get('v');
      if (url.hostname !== 'thumb' || !id || !v || !/^[0-9a-f]{8}$/.test(v) || url.username || url.password) return text(404, 'Not found');
      name = `${id}-${v}`;
    } catch {
      return text(404, 'Not found');
    }
    try {
      const dir = await deps.dir();
      if (dir === null) return text(404, 'Not found');
      for (const [ext, type, max] of [['webp', 'image/webp', THUMB_LIMITS.maxBytes], ['jpg', 'image/jpeg', THUMB_LIMITS.maxBytes * 4]] as const) {
        const file = path.join(dir, `${name}.${ext}`);
        const st = await lstat(file).catch(() => null);
        if (!st) continue;
        if (!st.isFile() || st.size > max) return text(404, 'Not found');
        const body = request.method === 'HEAD' ? null : await readFile(file);
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': type, 'Content-Length': String(st.size), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=86400' },
        });
      }
      return text(404, 'Not found');
    } catch {
      return text(404, 'Not found');
    }
  };
}
