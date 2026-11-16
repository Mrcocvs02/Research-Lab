import { Readable } from 'node:stream';
import { AppError, documentIdSchema } from '@rl/core';
import { openPdfHandle } from './ipc/handlers/doc-files.js';

export interface DocProtocolDeps {
  /** Absolute path of the present PDF of the ACTIVE library, looked up at every request; throws an AppError otherwise. */
  resolve(docId: string): Promise<{ abs: string; root?: string }>;
  /** The one origin the renderer is loaded from (`rl-app://app` in the packaged app). */
  allowedOrigin(): string;
}

const text = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

type RangeResult = { kind: 'none' } | { kind: 'unsatisfiable' } | { kind: 'range'; start: number; end: number };

/** One `bytes=` range. Anything else (several ranges, bad syntax) is ignored and the whole file is sent, as HTTP allows. */
export function parseRange(header: string | null, size: number): RangeResult {
  if (header === null) return { kind: 'none' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return { kind: 'none' };
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0 || size === 0) return { kind: 'unsatisfiable' };
    return { kind: 'range', start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const last = m[2] === '' ? size - 1 : Number(m[2]);
  if (m[2] !== '' && last < start) return { kind: 'none' };
  if (!Number.isSafeInteger(start) || start >= size) return { kind: 'unsatisfiable' };
  return { kind: 'range', start, end: Math.min(last, size - 1) };
}

/**
 * Handler of `rl-doc://doc/<docId>?v=<hash8>`: streams a PDF of the active library, byte ranges included (pdf.js
 * loads lazily). `v` only makes the URL change with the content; it is not checked. A refusal is 403/404 with a
 * fixed text: never a path, never a reason beyond that.
 */
export function createDocHandler(deps: DocProtocolDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const origin = request.headers.get('origin');
    const allowed = deps.allowedOrigin();
    // Only the renderer asks for documents. A request from any other origin gets nothing.
    if (origin !== null && origin !== allowed) return text(403, 'Forbidden');
    const cors: Record<string, string> =
      origin === null ? {} : { 'Access-Control-Allow-Origin': allowed, Vary: 'Origin', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges' };

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Max-Age': '600', 'Cache-Control': 'no-store' },
      });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed', { ...cors, Allow: 'GET, HEAD, OPTIONS' });

    let docId: string;
    try {
      const url = new URL(request.url);
      const m = /^\/([0-9a-f]{16})$/.exec(url.pathname);
      if (url.hostname !== 'doc' || !m || url.username || url.password) return text(404, 'Not found', cors);
      docId = documentIdSchema.parse(m[1]);
    } catch {
      return text(404, 'Not found', cors);
    }

    let abs: string;
    let root: string | undefined;
    try {
      ({ abs, root } = await deps.resolve(docId));
    } catch (e) {
      const code = e instanceof AppError ? e.code : '';
      return code === 'PERMISSION_DENIED' || code === 'PATH_OUTSIDE_ROOT' || code === 'INVALID_PATH' ? text(403, 'Forbidden', cors) : text(404, 'Not found', cors);
    }
    const opened = await openPdfHandle(abs, root);
    if (opened === 'missing') return text(404, 'Not found', cors);
    if (opened === 'not-pdf' || opened === 'outside') return text(403, 'Forbidden', cors);
    const { fh, size } = opened;

    const range = parseRange(request.headers.get('range'), size);
    const base: Record<string, string> = { ...cors, 'Content-Type': 'application/pdf', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (range.kind === 'unsatisfiable') {
      await fh.close().catch(() => {});
      return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
    }
    const [start, end, status] = range.kind === 'range' ? [range.start, range.end, 206] : [0, size - 1, 200];
    const length = size === 0 ? 0 : end - start + 1;
    const headers: Record<string, string> = { ...base, 'Content-Length': String(length), ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) };
    if (request.method === 'HEAD' || length === 0) {
      await fh.close().catch(() => {});
      return new Response(null, { status, headers });
    }
    // The stream closes the handle when it ends or when the reader goes away.
    const body = Readable.toWeb(fh.createReadStream({ start, end, autoClose: true })) as unknown as ReadableStream<Uint8Array>;
    return new Response(body, { status, headers });
  };
}
