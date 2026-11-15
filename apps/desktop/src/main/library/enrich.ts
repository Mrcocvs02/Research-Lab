import { DOCUMENT_LIMITS, type DocumentRecord, type ExtractedMeta } from '@rl/core';

const stem = (p: string) => {
  const name = p.slice(p.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? name.slice(0, dot) : name).replace(/_+/g, ' ').trim();
};

/**
 * Fills the EMPTY fields of a record from what the file itself says (never overwrites what the user or
 * an import already set). Without any title it falls back to the file name. Returns null when nothing changes.
 */
export function enrichFromExtraction(cur: DocumentRecord, meta: ExtractedMeta | undefined, now: () => string = () => new Date().toISOString()): DocumentRecord | null {
  const L = DOCUMENT_LIMITS;
  const next: DocumentRecord = { ...cur };
  let changed = false;
  if (cur.title === null) {
    const title = meta?.title?.trim() || stem(cur.path);
    if (title) {
      next.title = title.slice(0, L.title);
      changed = true;
    }
  }
  if (meta) {
    if (cur.authors.length === 0 && meta.authors?.length) {
      next.authors = meta.authors.map((a) => a.slice(0, L.author)).slice(0, L.authors);
      changed = true;
    }
    if (cur.doi === null && meta.doi) {
      next.doi = meta.doi.slice(0, L.identifier);
      changed = true;
    }
    if (cur.arxivId === null && meta.arxivId) {
      next.arxivId = meta.arxivId.slice(0, L.identifier);
      changed = true;
    }
    if (cur.year === null && meta.year && meta.year >= 1000 && meta.year <= 3000) {
      next.year = meta.year;
      changed = true;
    }
  }
  return changed ? { ...next, updatedAt: now() } : null;
}
