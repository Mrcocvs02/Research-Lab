import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ARXIV_SHAPE } from '@rl/core';

/** The metadata host that already serves the open PDF of an arXiv paper (no new host is contacted). */
const HOST = 'export.arxiv.org';
export const MAX_PDF_BYTES = 100 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

export class DownloadError extends Error {
  constructor(readonly reason: 'shape' | 'redirect' | 'status' | 'too-large' | 'not-pdf' | 'network') {
    super(reason);
  }
}

/**
 * Downloads the open PDF of an arXiv paper into `dir` (the app's local data, never the library): https only, the fixed
 * host only, no cookies, redirects refused (one step inside the same host is allowed), a size cap counted on the bytes
 * received, and the `%PDF-` header checked. Returns the path of the new file; a partial file is removed. It is not
 * opened or moved: the inbox takes it from here and copies it only after the user confirms.
 */
export async function downloadArxivPdf(id: string, dir: string, f: typeof fetch, maxBytes = MAX_PDF_BYTES): Promise<string> {
  if (!ARXIV_SHAPE.test(id)) throw new DownloadError('shape');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `arxiv-${id.replace(/[^A-Za-z0-9.-]/g, '_')}-${randomBytes(4).toString('hex')}.pdf`);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    let url = `https://${HOST}/pdf/${id.split('/').map(encodeURIComponent).join('/')}`;
    let res: Response | null = null;
    for (let hop = 0; hop < 2; hop++) {
      res = await f(url, { signal: ctl.signal, credentials: 'omit', redirect: 'manual', headers: { Accept: 'application/pdf', 'User-Agent': 'ResearchLab' } } as RequestInit);
      if (res.status < 300 || res.status >= 400) break;
      const next = res.headers.get('location');
      await res.body?.cancel().catch(() => {});
      const u = next ? new URL(next, url) : null;
      if (!u || u.protocol !== 'https:' || u.host !== HOST) throw new DownloadError('redirect');
      url = u.href;
      res = null;
    }
    if (!res) throw new DownloadError('redirect');
    if (!res.ok || !res.body) throw new DownloadError('status');
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) throw new DownloadError('too-large');
    let total = 0;
    const counted = Readable.fromWeb(res.body as never).on('data', (c: Buffer) => {
      total += c.length;
      if (total > maxBytes) counted.destroy(new DownloadError('too-large'));
    });
    await pipeline(counted, createWriteStream(file, { flags: 'wx' }));
    const fh = await open(file, 'r');
    const head = Buffer.alloc(5);
    await fh.read(head, 0, 5, 0).finally(() => fh.close());
    if (head.toString('latin1') !== '%PDF-') throw new DownloadError('not-pdf');
    return file;
  } catch (e) {
    await rm(file, { force: true }).catch(() => {});
    throw e instanceof DownloadError ? e : new DownloadError('network');
  } finally {
    clearTimeout(timer);
  }
}
