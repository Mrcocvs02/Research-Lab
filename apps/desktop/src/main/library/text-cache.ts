import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { sha256Schema, type ExtractedText } from '@rl/core';
import { atomicWriteJson } from '@rl/core/node';

/**
 * Cache of extracted text, one JSON file per file content (`<cacheDir>/<hash[0..2]>/<hash>.json`, keyed by the
 * SHA-256 of the file, so a changed file never reads a stale entry). Machine-local and rebuildable
 * (`<localData>/cache/text`): it lets the index be rebuilt without opening the PDFs again.
 */
const entrySchema = z.object({
  v: z.literal(1),
  hash: sha256Schema,
  pages: z.array(z.object({ page: z.number().int().positive(), text: z.string() })),
  meta: z.object({
    title: z.string().optional(),
    authors: z.array(z.string()).optional(),
    doi: z.string().optional(),
    arxivId: z.string().optional(),
    year: z.number().int().optional(),
    pageCount: z.number().int().nonnegative(),
  }),
  noTextLayer: z.boolean(),
});
export type TextCacheEntry = z.infer<typeof entrySchema>;

function fileFor(dir: string, hash: string): string {
  const h = sha256Schema.parse(hash);
  return path.join(dir, h.slice(0, 2), `${h}.json`);
}

export async function readTextCache(dir: string, hash: string): Promise<TextCacheEntry | null> {
  try {
    const parsed = entrySchema.safeParse(JSON.parse(await readFile(fileFor(dir, hash), 'utf8')));
    return parsed.success && parsed.data.hash === hash ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeTextCache(dir: string, hash: string, text: ExtractedText): Promise<void> {
  const entry: TextCacheEntry = { v: 1, hash, pages: text.pages, meta: text.meta, noTextLayer: text.noTextLayer };
  // Compact JSON: the cache is not meant to be read by hand.
  await atomicWriteJson(fileFor(dir, hash), entry, { space: 0 });
}
