import { z } from 'zod';
import { isoDateSchema, itemIdSchema, schemaVersionSchema } from '../common.js';

/** Upper bounds of `watch.json` (synced, untrusted). */
export const WATCH_FILE_LIMITS = { sources: 200, seen: 5000, dismissedRecommendations: 5000, text: 2000 } as const;
const L = WATCH_FILE_LIMITS;

/**
 * Something the user follows (plan §4 phase 5, "Monitoraggio"): an author (OpenAlex author id `A123` or a name), a topic
 * (keyword query), a venue (name or OpenAlex source id `S123`), or `own-preprint` (the user's own preprints, found from
 * the profile's author variants; `query` is unused).
 */
export const watchSourceSchema = z.object({
  id: itemIdSchema,
  kind: z.enum(['author', 'topic', 'venue', 'own-preprint']),
  query: z.string().max(L.text),
  label: z.string().max(200).default(''),
  enabled: z.boolean().default(true),
  lastCheckedAt: isoDateSchema.optional(),
});
export type WatchSource = z.infer<typeof watchSourceSchema>;

/** A work found by a source, remembered so it is shown as new only once. */
export const watchSeenSchema = z.object({
  sourceId: itemIdSchema,
  externalId: z.string().max(L.text),
  firstSeenAt: isoDateSchema,
  dismissed: z.boolean().default(false),
  title: z.string().max(L.text).optional(),
  authors: z.array(z.string().max(300)).max(100).default([]),
  year: z.number().int().min(1000).max(3000).optional(),
  doi: z.string().max(L.text).optional(),
  arxivId: z.string().max(L.text).optional(),
  venue: z.string().max(L.text).optional(),
  /** Publication date reported by the source (YYYY-MM-DD). */
  publishedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type WatchSeen = z.infer<typeof watchSeenSchema>;

/** `<dataDir>/watch.json` */
export const watchFileSchema = z.object({
  schemaVersion: schemaVersionSchema,
  sources: z.array(watchSourceSchema).max(L.sources).default([]),
  seen: z.array(watchSeenSchema).max(L.seen).default([]),
  /** Work keys (`doi:…`, `arxiv:…`, `oa:W…`) the user hid from "read next". */
  dismissedRecommendations: z.array(z.string().max(L.text)).max(L.dismissedRecommendations).default([]),
});
export type WatchFile = z.infer<typeof watchFileSchema>;
