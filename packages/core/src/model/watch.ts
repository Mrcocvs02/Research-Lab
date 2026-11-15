import { z } from 'zod';
import { isoDateSchema, itemIdSchema, schemaVersionSchema } from '../common.js';

export const watchSourceSchema = z.object({
  id: itemIdSchema,
  kind: z.enum(['author', 'topic', 'venue', 'own-preprint']),
  /** Author id/name, keyword query, venue name, or DOI/arXiv id depending on kind. */
  query: z.string().min(1),
  label: z.string().default(''),
  enabled: z.boolean().default(true),
  lastCheckedAt: isoDateSchema.optional(),
});

export const watchSeenSchema = z.object({
  sourceId: itemIdSchema,
  externalId: z.string(),
  firstSeenAt: isoDateSchema,
  dismissed: z.boolean().default(false),
});

/** `<dataDir>/watch.json` */
export const watchFileSchema = z.object({
  schemaVersion: schemaVersionSchema,
  sources: z.array(watchSourceSchema).default([]),
  seen: z.array(watchSeenSchema).default([]),
});
export type WatchFile = z.infer<typeof watchFileSchema>;
