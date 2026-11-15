import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { isInside } from '@rl/core/node';
import { APP_ORIGIN, APP_SCHEME } from './app-info.js';

/** Node's `URL.origin` is "null" for custom schemes, so build the origin by hand. */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * True when `url` belongs to the renderer: the built app origin or, in a development run, the
 * validated dev-server origin (`devOrigin`, see `parseDevServerUrl`). Credentials in the URL
 * (`rl-app://x@app/`) are never trusted.
 */
export function isTrustedUrlFor(url: string, devOrigin: string | null): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  return originOf(url) === (devOrigin ?? APP_ORIGIN);
}

const BACKSLASH = String.fromCharCode(92);

export type RendererResolution = { status: 200; file: string } | { status: 400 | 403 | 404 };

/**
 * Maps a request for `rl-app://app/<path>` to a file under `rendererDir`, or to a refusal.
 * Refused: other hosts and schemes (404), undecodable or NUL-containing paths (400), `..`
 * segments, backslashes, `:` (drive letters, NTFS alternate data streams) and anything that
 * resolves, also through links, outside `rendererDir` (403); directories and missing files (404).
 */
export async function resolveRendererFile(rendererDir: string, requestUrl: string): Promise<RendererResolution> {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return { status: 400 };
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== 'app' || url.username || url.password) return { status: 404 };
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return { status: 400 };
  }
  if (rel.includes('\0')) return { status: 400 };
  if (rel.includes(BACKSLASH) || rel.includes(':') || rel.split('/').includes('..')) return { status: 403 };
  const file = path.resolve(rendererDir, `.${rel === '/' ? '/index.html' : rel}`);
  if (!isInside(rendererDir, file)) return { status: 403 };
  const st = await stat(file).catch(() => null);
  if (!st?.isFile()) return { status: 404 };
  const [realFile, realDir] = await Promise.all([realpath(file), realpath(rendererDir)]).catch(() => [null, null] as const);
  if (!realFile || !realDir || !isInside(realDir, realFile)) return { status: 403 };
  return { status: 200, file };
}
