import { blank, cleanAuthors, cleanList, clip, LIMITS, normArxiv, normDoi, yearOf, type BibEntry, type BibRead } from './entry.js';

const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);

function nameOf(a: unknown): string | null {
  if (typeof a !== 'object' || a === null) return null;
  const o = a as Record<string, unknown>;
  const family = str(o['family']);
  const given = str(o['given']);
  if (family !== null) return given ? `${family}, ${given}` : family;
  return str(o['literal']) ?? str(o['name']);
}

function yearIn(v: unknown): number | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const parts = o['date-parts'];
  if (Array.isArray(parts) && Array.isArray(parts[0]) && typeof parts[0][0] !== 'undefined') return yearOf(String(parts[0][0]));
  return yearOf(str(o['raw']) ?? str(o['literal']));
}

/** CSL JSON: an array of items (or `{ items: [...] }`). */
export function readCsl(text: string, base: string): BibRead {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { source: 'csl', entries: [], base, skipped: [{ label: 'file', reason: 'invalid' }] };
  }
  const items = Array.isArray(data) ? data : typeof data === 'object' && data !== null && Array.isArray((data as { items?: unknown }).items) ? (data as { items: unknown[] }).items : [];
  const entries: BibEntry[] = [];
  const skipped: BibRead['skipped'] = [];
  for (const it of items.slice(0, LIMITS.entries)) {
    if (typeof it !== 'object' || it === null) continue;
    const o = it as Record<string, unknown>;
    const e = blank();
    const key = str(o['citation-key']) ?? str(o['id']);
    e.key = key !== null && !/^https?:|\s/.test(key) ? key : null;
    e.title = clip(str(o['title']));
    e.authors = cleanAuthors((Array.isArray(o['author']) ? o['author'] : Array.isArray(o['editor']) ? o['editor'] : []).map(nameOf).filter((x): x is string => x !== null));
    e.year = yearIn(o['issued']);
    e.venue = clip(str(o['container-title']) ?? str(o['collection-title']), 500);
    const vol = str(o['volume']);
    const num = str(o['issue']);
    const page = str(o['page']);
    e.venueRef = clip([vol && `vol. ${vol}`, num && `no. ${num}`, page && `pp. ${page}`].filter(Boolean).join(', '), 500);
    e.doi = normDoi(str(o['DOI']) ?? str(o['URL']));
    e.arxivId = normArxiv(/arxiv/i.test(str(o['publisher']) ?? str(o['container-title']) ?? '') ? (str(o['number']) ?? str(o['URL']) ?? str(o['note'])) : (str(o['arxiv']) ?? null));
    e.tags = cleanList((str(o['keyword']) ?? '').split(/[,;]/));
    const note = clip(str(o['note']), LIMITS.notes);
    if (note !== null) e.notes = [note];
    if (e.title === null && e.authors.length === 0) skipped.push({ label: key ?? 'item', reason: 'empty' });
    else entries.push(e);
  }
  return { source: 'csl', entries, base, skipped: skipped.slice(0, 500) };
}
