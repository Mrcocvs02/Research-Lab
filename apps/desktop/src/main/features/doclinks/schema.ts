import { z } from 'zod';
import { documentIdSchema, isoDateSchema } from '@rl/core';

/** Why two documents are linked (§18.2): shared words, a citation (with the direction), shared references, shared tags and authors. */
export const linkReasonsSchema = z.object({
  terms: z.array(z.string().max(100)).max(5).optional(),
  /** `to`: the first document cites the second; `from`: the second cites the first. */
  cites: z.enum(['to', 'from', 'both']).optional(),
  shared: z.number().int().nonnegative().optional(),
  tags: z.array(z.string().max(200)).max(3).optional(),
  authors: z.array(z.string().max(300)).max(3).optional(),
});
export type LinkReasons = z.infer<typeof linkReasonsSchema>;

export const docLinkSchema = z.object({
  id: z.string().min(1).max(40),
  a: documentIdSchema,
  b: documentIdSchema,
  weight: z.number().min(0).max(1),
  reasons: linkReasonsSchema,
  origin: z.enum(['finder', 'user']),
  runId: z.string().max(40),
  at: isoDateSchema,
});
export type DocLink = z.infer<typeof docLinkSchema>;

/** `<dataDir>/links/doc-links.json` */
export const docLinksFileSchema = z.object({
  schemaVersion: z.literal(1),
  links: z.array(docLinkSchema).max(50_000),
  dismissed: z.array(z.object({ a: documentIdSchema, b: documentIdSchema, at: isoDateSchema })).max(50_000),
});
export type DocLinksFile = z.infer<typeof docLinksFileSchema>;
