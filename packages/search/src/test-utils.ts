import { createHash } from 'node:crypto';
import { documentRecordSchema, type DocumentRecord, type IndexableDocument } from '@rl/core';

export function docId(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

export interface RecordInit {
  seed: string;
  title?: string | null;
  authors?: string[];
  year?: number | null;
  type?: string | null;
  venue?: string;
  path?: string;
  tags?: string[];
  state?: 'to-read' | 'reading' | 'read';
  addedAt?: string;
}

export function makeRecord(init: RecordInit): DocumentRecord {
  const hash = createHash('sha256').update(init.seed).digest('hex');
  return documentRecordSchema.parse({
    id: hash.slice(0, 16),
    hash,
    path: init.path ?? `papers/${init.seed}.pdf`,
    size: 100,
    mtimeMs: 1,
    type: init.type ?? null,
    title: init.title === undefined ? `Title ${init.seed}` : init.title,
    authors: init.authors ?? [],
    year: init.year ?? null,
    ref: init.venue ? { venue: init.venue } : {},
    tags: init.tags ?? [],
    study: { state: init.state ?? 'to-read' },
    addedAt: init.addedAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

export function makeDoc(init: RecordInit, extra: Omit<IndexableDocument, 'record'> = {}): IndexableDocument {
  return { record: makeRecord(init), ...extra };
}
