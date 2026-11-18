import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DownloadError, downloadArxivPdf } from './download.js';
import { parseLine, parseLines } from './parse.js';

describe('parseLine', () => {
  it.each([
    ['10.1000/xyz123', 'doi', '10.1000/xyz123'],
    ['doi:10.1000/XYZ123.', 'doi', '10.1000/xyz123'],
    ['https://doi.org/10.1000/xyz123', 'doi', '10.1000/xyz123'],
    ['https://dx.doi.org/10.1000%2Fxyz123', 'doi', '10.1000/xyz123'],
    ['https://publisher.example/doi/full/10.1000/xyz123?x=1', 'doi', '10.1000/xyz123'],
    ['arXiv:2401.01234v2', 'arxiv', '2401.01234v2'],
    ['2401.01234', 'arxiv', '2401.01234'],
    ['hep-th/9901001', 'arxiv', 'hep-th/9901001'],
    ['https://arxiv.org/abs/2401.01234v1', 'arxiv', '2401.01234v1'],
    ['https://arxiv.org/pdf/2401.01234.pdf', 'arxiv', '2401.01234'],
    ['https://export.arxiv.org/abs/hep-th/9901001', 'arxiv', 'hep-th/9901001'],
  ])('reads %s', (input, kind, id) => {
    expect(parseLine(input)).toMatchObject({ kind, id });
  });

  it.each([
    ['file:///C:/x.pdf', 'not-http'],
    ['javascript:alert(1)', 'not-http'],
    ['ftp://example.org/x', 'not-http'],
    ['http://localhost:8080/paper', 'private-host'],
    ['http://127.0.0.1/doi/10.1000/abc', 'private-host'],
    ['http://192.168.1.4/x', 'private-host'],
    ['https://user:pw@example.org/10.1000/abc', 'credentials'],
    ['https://example.org/blog/post', 'no-id'],
    ['some words', 'no-id'],
    ['arxiv:nonsense', 'shape'],
  ])('refuses %s (%s)', (input, reason) => {
    expect(parseLine(input)).toMatchObject({ kind: null, id: null, reason });
  });

  it('refuses a very long line', () => {
    expect(parseLine(`10.1000/${'a'.repeat(500)}`)).toMatchObject({ kind: null, reason: 'too-long' });
  });
});

describe('parseLines', () => {
  it('takes one identifier per line, drops blanks and repeats, and caps the batch', () => {
    const r = parseLines('10.1000/a\n\n10.1000/A\r\n2401.01234\n');
    expect(r.map((x) => x.id)).toEqual(['10.1000/a', '2401.01234']);
    const many = Array.from({ length: 40 }, (_, i) => `10.1000/x${i}`).join('\n');
    expect(parseLines(many)).toHaveLength(20);
  });
});

describe('downloadArxivPdf', () => {
  let dir = '';
  afterEach(() => rm(dir, { recursive: true, force: true }));
  const make = async () => (dir = await mkdtemp(path.join(os.tmpdir(), 'rl-dl-')));
  const pdf = (body: string, init: ResponseInit = {}) => (async () => new Response(body, { status: 200, ...init })) as unknown as typeof fetch;

  it('saves a PDF from the fixed host and nothing else', async () => {
    const d = await make();
    const seen: string[] = [];
    const f = (async (u: string, init: RequestInit) => {
      seen.push(`${u}|${init.credentials}|${init.redirect}`);
      return new Response('%PDF-1.7 body');
    }) as unknown as typeof fetch;
    const file = await downloadArxivPdf('2401.01234v2', d, f);
    expect(path.dirname(file)).toBe(d);
    expect(await readFile(file, 'latin1')).toBe('%PDF-1.7 body');
    expect(seen).toEqual(['https://export.arxiv.org/pdf/2401.01234v2|omit|manual']);
  });

  it('refuses a redirect to another host, a body that is not a PDF and an oversized one, leaving no file', async () => {
    const d = await make();
    const redirect = (async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/x.pdf' } })) as unknown as typeof fetch;
    await expect(downloadArxivPdf('2401.01234', d, redirect)).rejects.toMatchObject({ reason: 'redirect' });
    await expect(downloadArxivPdf('2401.01234', d, pdf('<html>not a pdf</html>'))).rejects.toMatchObject({ reason: 'not-pdf' });
    await expect(downloadArxivPdf('2401.01234', d, pdf('%PDF-' + 'x'.repeat(100)), 50)).rejects.toBeInstanceOf(DownloadError);
    await expect(downloadArxivPdf('2401.01234', d, pdf('%PDF-x', { headers: { 'content-length': '999999' } }), 50)).rejects.toMatchObject({ reason: 'too-large' });
    await expect(downloadArxivPdf('../../etc/passwd', d, pdf('%PDF-'))).rejects.toMatchObject({ reason: 'shape' });
    expect(await readdir(d)).toEqual([]);
  });
});
