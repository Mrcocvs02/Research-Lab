import { ARXIV_SHAPE, isValidDoi } from '@rl/core';
import { checkPublicUrl } from '../resources/guard.js';

export interface ParsedLine {
  input: string;
  kind: 'doi' | 'arxiv' | null;
  id: string | null;
  /** Set when `kind` is null: why nothing could be taken from the line. */
  reason?: 'not-http' | 'private-host' | 'credentials' | 'no-id' | 'shape' | 'too-long';
}

export const MAX_LINES = 20;
const MAX_LINE = 400;

const DOI_IN_TEXT = /10\.\d{4,9}\/[^\s"'<>?#]+/;
const clean = (doi: string) => doi.replace(/[.,;:)\]}>]+$/, '').toLowerCase();
const arxivBase = (id: string) => id.replace(/^arxiv:\s*/i, '').replace(/\.pdf$/i, '');

/** An arXiv id or a DOI from a bare identifier ("10.1000/x", "doi:10.1000/x", "arXiv:2401.01234v2", "hep-th/9901001"). */
function bare(text: string): { kind: 'doi' | 'arxiv'; id: string } | null {
  const t = text.trim();
  const doi = /^(?:doi:\s*)?(10\.\d{4,9}\/\S+)$/i.exec(t)?.[1];
  if (doi && isValidDoi(clean(doi))) return { kind: 'doi', id: clean(doi) };
  const ax = arxivBase(t);
  if (ARXIV_SHAPE.test(ax)) return { kind: 'arxiv', id: ax };
  return null;
}

/**
 * One identifier or address per line. A URL is not fetched here: the identifier in it (doi.org, arxiv.org, a DOI in the
 * path of a publisher page) is all that is used, and everything after goes to OpenAlex or arXiv. Anything that is not
 * http(s), has credentials, or points at the machine or a private network is refused.
 */
export function parseLine(raw: string): ParsedLine {
  const input = raw.trim().slice(0, MAX_LINE);
  if (raw.trim().length > MAX_LINE) return { input, kind: null, id: null, reason: 'too-long' };
  const b = bare(input);
  if (b) return { input, ...b };
  if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !/^https?:/i.test(input)) {
    // `doi:` and `arxiv:` are handled above; any other scheme (file:, javascript:, ftp:...) is not an address we use.
    return { input, kind: null, id: null, reason: /^(?:doi|arxiv):/i.test(input) ? 'shape' : 'not-http' };
  }
  const v = checkPublicUrl(input.includes('://') ? input : `https://${input}`);
  // Text without a scheme that is not an address either (a word, a title) is simply not an identifier.
  if (!v.ok) return { input, kind: null, id: null, reason: !input.includes('://') ? 'no-id' : v.reason === 'invalid' ? 'shape' : v.reason };
  const host = v.url.hostname.replace(/^www\./, '').toLowerCase();
  let path: string;
  try {
    path = decodeURIComponent(v.url.pathname).replace(/^\/+/, '');
  } catch {
    return { input, kind: null, id: null, reason: 'shape' };
  }
  if (host === 'doi.org' || host === 'dx.doi.org') {
    const d = clean(path);
    return isValidDoi(d) ? { input, kind: 'doi', id: d } : { input, kind: null, id: null, reason: 'shape' };
  }
  if (host === 'arxiv.org' || host === 'export.arxiv.org') {
    const m = /^(?:abs|pdf)\/(.+)$/.exec(path);
    const id = m ? arxivBase(m[1]!) : '';
    return ARXIV_SHAPE.test(id) ? { input, kind: 'arxiv', id } : { input, kind: null, id: null, reason: 'shape' };
  }
  const inPath = DOI_IN_TEXT.exec(path)?.[0];
  if (inPath && isValidDoi(clean(inPath))) return { input, kind: 'doi', id: clean(inPath) };
  return { input, kind: null, id: null, reason: 'no-id' };
}

/** The lines of the field (blank ones dropped, duplicates of the same identifier kept once), at most `MAX_LINES`. */
export function parseLines(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n|[;,]\s+/)) {
    if (line.trim() === '') continue;
    const p = parseLine(line);
    const key = p.kind ? `${p.kind}:${p.id!.toLowerCase()}` : '';
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(p);
    if (out.length >= MAX_LINES) break;
  }
  return out;
}
