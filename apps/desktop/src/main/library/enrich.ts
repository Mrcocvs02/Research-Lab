import { DOCUMENT_LIMITS, type DocumentRecord, type ExtractedFields, type ExtractedMeta } from '@rl/core';

type Field = keyof ExtractedFields;
const FIELDS: Field[] = ['title', 'authors', 'year', 'doi', 'arxivId'];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What the extractor found, cleaned and clipped to the record's limits (a missing or implausible value is absent). */
function proposals(meta: ExtractedMeta | undefined): ExtractedFields {
  const L = DOCUMENT_LIMITS;
  const out: ExtractedFields = {};
  if (!meta) return out;
  const title = meta.title?.trim();
  if (title) out.title = title.slice(0, L.title);
  if (meta.authors?.length) out.authors = meta.authors.map((a) => a.slice(0, L.author)).slice(0, L.authors);
  if (meta.year && Number.isInteger(meta.year) && meta.year >= 1000 && meta.year <= 3000) out.year = meta.year;
  if (meta.doi) out.doi = meta.doi.slice(0, L.identifier);
  if (meta.arxivId) out.arxivId = meta.arxivId.slice(0, L.identifier);
  return out;
}

const isEmpty = (cur: DocumentRecord, f: Field): boolean => (f === 'authors' ? cur.authors.length === 0 : cur[f] === null);

/**
 * Fills the EMPTY fields of a record from what the file itself says, and remembers what it wrote in
 * `record.extracted` (D-071), so that:
 * - a value of the user or of an import is never overwritten;
 * - a field the extractor filled and the user then emptied is not filled again;
 * - a field still holding the extracted value is known to be a guess (not the user's) and follows the file when
 *   the file changes and the extractor finds something else.
 * The file name is NOT written as a title: showing it when there is no title is the interface's job.
 * Returns null when nothing changes.
 */
export function enrichFromExtraction(cur: DocumentRecord, meta: ExtractedMeta | undefined, now: () => string = () => new Date().toISOString()): DocumentRecord | null {
  const found = proposals(meta);
  const extracted: ExtractedFields = { ...cur.extracted };
  const next: DocumentRecord = { ...cur };
  let changed = false;
  for (const f of FIELDS) {
    const v = found[f];
    if (v === undefined) continue;
    const written = extracted[f];
    // Filled by us before and still ours (the user did not touch it): follow the file.
    const mayWrite = written === undefined ? isEmpty(cur, f) : same(cur[f], written) && !same(written, v);
    if (!mayWrite) continue;
    (next as Record<Field, unknown>)[f] = v;
    (extracted as Record<Field, unknown>)[f] = v;
    changed = true;
  }
  if (!changed) return null;
  return { ...next, extracted, updatedAt: now() };
}

/** True while the record's value of `field` is the one the extractor wrote (a guess), not set by the user or an import. */
export function isExtractedValue(rec: DocumentRecord, field: Field): boolean {
  const written = rec.extracted?.[field];
  return written !== undefined && same(rec[field], written);
}
