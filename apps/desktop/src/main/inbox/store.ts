import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { aiMetaSchema, aiNewTagSchema, documentIdSchema, inboxMetadataSchema, isoDateSchema, itemIdSchema } from '@rl/core';
import { atomicWriteJson, readJsonFile } from '@rl/core/node';
import { KeyedQueue } from '../keyed-queue.js';

/**
 * What the inbox keeps for each item, in the LOCAL app data (`<localData>/inbox/<libraryId>.json`), never in the synced
 * data folder: dropped files hold the absolute path of the original (it never reaches the renderer), library items
 * only the cached lookup and proposals.
 */
export const entrySchema = z.object({
  lookup: z.object({ state: z.enum(['pending', 'found', 'not-found', 'offline', 'error', 'skipped']), source: z.enum(['openalex', 'arxiv']).optional(), checkedAt: isoDateSchema.optional() }),
  metadata: inboxMetadataSchema.nullable(),
  /** Tags of the most similar documents of the library (no AI). */
  similar: z.array(itemIdSchema).max(100).default([]),
  /** Folder of the most similar document (the fallback folder proposal). */
  nearFolder: z.string().max(4096).optional(),
  /** The last AI tag proposal. */
  ai: z.object({ tagIds: z.array(itemIdSchema).max(100), newTags: z.array(aiNewTagSchema).max(20), meta: aiMetaSchema }).optional(),
});
export type Entry = z.infer<typeof entrySchema>;

export const droppedSchema = z.object({
  id: documentIdSchema,
  /** Real path of the original; read only, never modified, moved or deleted. */
  srcPath: z.string().min(1).max(4096),
  fileName: z.string().min(1).max(260),
  size: z.number().int().nonnegative(),
  addedAt: isoDateSchema,
  /** SHA-256 of the original at the time it was added. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  detected: inboxMetadataSchema.partial(),
  entry: entrySchema,
});
export type Dropped = z.infer<typeof droppedSchema>;

const fileSchema = z.object({
  version: z.literal(1),
  items: z.array(droppedSchema).max(2000),
  cache: z.record(z.string(), entrySchema),
  /** Flagged library files at the last listing or recount: the badge needs a number without reading any document. */
  flagged: z.number().int().nonnegative().optional(),
});
export type InboxFile = z.infer<typeof fileSchema>;

const empty = (): InboxFile => ({ version: 1, items: [], cache: {} });
const queue = new KeyedQueue();

/** One JSON file per library, read and written one operation at a time, atomically. */
export class InboxStore {
  private readonly file: string;
  constructor(localDataDir: string, private readonly libraryId: string) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(libraryId)) throw new Error('invalid library id');
    this.file = path.join(localDataDir, 'inbox', `${libraryId}.json`);
  }

  async read(): Promise<InboxFile> {
    try {
      return await readJsonFile(this.file, fileSchema, { maxBytes: 64 * 1024 * 1024 });
    } catch (e) {
      const code = (e as { code?: string }).code;
      // Missing: an empty inbox. Unreadable (a version this app does not know, a damaged file): empty too, but the file is
      // kept as `.bad` first, because the next update would overwrite the queue (the originals stay where they are either way).
      if (code === 'NOT_FOUND') return empty();
      if (code === 'SCHEMA_INVALID' || code === 'INVALID_REQUEST') {
        await copyFile(this.file, `${this.file}.bad`).catch(() => undefined);
        return empty();
      }
      throw e;
    }
  }

  /** Read-modify-write under a per-library queue. The mutator may change the draft in place. */
  update<T>(fn: (draft: InboxFile) => T | Promise<T>): Promise<T> {
    const run = async () => {
      const draft = await this.read();
      const out = await fn(draft);
      await atomicWriteJson(this.file, draft);
      return out;
    };
    return queue.run(this.libraryId, run);
  }
}
