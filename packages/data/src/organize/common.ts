import type { DocumentRecord, LibraryStore, StudyState } from '@rl/core';
import type { ChangeContext } from '../store.js';

/** A store that can credit its changes to one user operation (the file store of `@rl/data`). */
export interface OrganizerStore extends LibraryStore {
  withChange(ctx: ChangeContext): LibraryStore;
}

/** What the organizer keeps in memory about each document (not the whole record). */
export interface DocInfo {
  id: string;
  path: string;
  missing: boolean;
  tags: string[];
  title: string | null;
  authors: string[];
  year: number | null;
  studyState: StudyState;
}

export const toInfo = (r: DocumentRecord): DocInfo => ({
  id: r.id,
  path: r.path,
  missing: r.missing,
  tags: r.tags,
  title: r.title,
  authors: r.authors,
  year: r.year,
  studyState: r.study.state,
});

/** Shared by the parts of the organizer; every mutating call runs under `run` (one at a time). */
export interface OrgCtx {
  store: OrganizerStore;
  deviceId: string;
  now(): Date;
  newChangeId(): string;
  /** Compact view of all documents (cached for a short time; `fresh` bypasses the cache). */
  docInfos(fresh?: boolean): Promise<DocInfo[]>;
  invalidate(): void;
}

export const clip = (s: string, n = 480): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Runs `fn` over `items` with at most `size` at a time. */
export async function inChunks<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}
