import {
  documentIdFromHash,
  documentRecordSchema,
  DOCUMENT_LIMITS,
  type DocumentId,
  type DocumentRecord,
  type ExtractedText,
  type LibraryStore,
  type ScanResult,
} from '@rl/core';

/**
 * Applies a scan result to the library data: new files become documents (id from the content hash, D-006),
 * changed files keep their id and remember the old hash, moved files record their old path, vanished
 * files are flagged `missing` (never deleted). Only the data folder is written, never the originals.
 *
 * TODO(integration): if `@rl/data` grows its own "apply scan result" helper, call it from here instead.
 */
export interface IngestOutcome {
  added: DocumentId[];
  changed: DocumentId[];
  moved: DocumentId[];
  missing: DocumentId[];
  /** Files the scanner reported without the hash the record needs. */
  skipped: number;
}

type Store = Pick<LibraryStore, 'documents'>;

/** Runs `fn` over `items` with at most `n` in flight. */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}

const withoutDup = <T>(list: T[], v: T): T[] => (list.includes(v) ? list : [...list, v]);

export async function ingestScan(store: Store, result: ScanResult, now: () => string): Promise<IngestOutcome> {
  const out: IngestOutcome = { added: [], changed: [], moved: [], missing: [], skipped: 0 };
  const L = DOCUMENT_LIMITS;

  // Added files are applied one after the other: two copies of the same new file must become one record with an alias.
  for (const file of result.added) {
    if (!file.hash) {
      out.skipped++;
      continue;
    }
    const id = documentIdFromHash(file.hash);
    const stamp = now();
    await store.documents.update(id, (cur) => {
      if (cur) {
        // Same content already known: another path to it.
        if (cur.path === file.path) return cur;
        return { ...cur, aliasPaths: withoutDup(cur.aliasPaths, file.path).slice(0, L.paths), missing: false, updatedAt: stamp };
      }
      return documentRecordSchema.parse({
        id,
        hash: file.hash,
        path: file.path,
        size: file.size,
        mtimeMs: file.mtimeMs,
        addedAt: stamp,
        updatedAt: stamp,
      });
    });
    out.added.push(id);
  }

  await pool(result.changed, 8, async ({ docId, file }) => {
    const stamp = now();
    await store.documents.update(docId, (cur) => {
      if (!cur) throw new Error('document vanished');
      const hash = file.hash ?? cur.hash;
      return {
        ...cur,
        hash,
        previousHashes: hash === cur.hash ? cur.previousHashes : withoutDup(cur.previousHashes, cur.hash).slice(-L.hashes),
        size: file.size,
        mtimeMs: file.mtimeMs,
        missing: false,
        updatedAt: stamp,
      };
    });
    out.changed.push(docId);
  });

  await pool(result.moved, 8, async ({ docId, from, file }) => {
    const stamp = now();
    await store.documents.update(docId, (cur) => {
      if (!cur) throw new Error('document vanished');
      const next: DocumentRecord = { ...cur, size: file.size, mtimeMs: file.mtimeMs, missing: false, updatedAt: stamp };
      if (cur.path === from) {
        next.path = file.path;
        next.pathHistory = [...cur.pathHistory, { path: from, seenUntil: stamp }].slice(-L.pathHistory);
        next.aliasPaths = cur.aliasPaths.filter((p) => p !== file.path);
      } else {
        // The file that moved was one of the other copies: the main path stays.
        next.aliasPaths = withoutDup(cur.aliasPaths.filter((p) => p !== from), file.path).slice(0, L.paths);
      }
      return next;
    });
    out.moved.push(docId);
  });

  await pool(result.missing, 8, async (docId) => {
    const cur = await store.documents.get(docId);
    if (!cur || cur.missing) return;
    await store.documents.update(docId, (c) => ({ ...(c ?? cur), missing: true, updatedAt: now() }));
    out.missing.push(docId);
  });
  return out;
}

const stem = (p: string) => {
  const name = p.slice(p.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? name.slice(0, dot) : name).replace(/[_]+/g, ' ').trim();
};

/**
 * Fills the EMPTY fields of a record from what the file itself says (never overwrites what the user or
 * an import already set). Without a title it falls back to the file name. Returns null when nothing changes.
 */
export function enrichFromExtraction(cur: DocumentRecord, meta: ExtractedText['meta'] | undefined): DocumentRecord | null {
  const L = DOCUMENT_LIMITS;
  const next: DocumentRecord = { ...cur };
  let changed = false;
  const title = cur.title ?? (meta?.title?.trim() || stem(cur.path) || null);
  if (title && cur.title === null) {
    next.title = title.slice(0, L.title);
    changed = true;
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
  return changed ? { ...next, updatedAt: new Date().toISOString() } : null;
}
