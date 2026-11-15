import { z } from 'zod';
import { documentIdSchema, isoDateSchema, schemaVersionSchema } from '../common.js';

export const citationSourceIdSchema = z.enum(['openalex', 'arxiv', 'semanticscholar', 'pdf', 'manual']);
export type CitationSourceId = z.infer<typeof citationSourceIdSchema>;

/** One edge: a work cited by, or citing, the document. */
export const citationLinkSchema = z.object({
  /** Provider-specific id (e.g. OpenAlex work id). */
  externalId: z.string().optional(),
  doi: z.string().optional(),
  arxivId: z.string().optional(),
  title: z.string().optional(),
  authors: z.array(z.string()).default([]),
  year: z.number().int().optional(),
  venue: z.string().optional(),
  /** Id of the library document this work was matched to, if owned. */
  matchedDocId: documentIdSchema.nullable().default(null),
  source: citationSourceIdSchema,
  /** When the source was queried. */
  checkedAt: isoDateSchema,
});
export type CitationLink = z.infer<typeof citationLinkSchema>;

/** `<dataDir>/citations/<docId>.json` */
export const citationFileSchema = z.object({
  schemaVersion: schemaVersionSchema,
  docId: documentIdSchema,
  /** Works cited by the document. */
  references: z.array(citationLinkSchema).default([]),
  /** Works that cite the document. */
  citedBy: z.array(citationLinkSchema).default([]),
  referencesCheckedAt: isoDateSchema.optional(),
  citedByCheckedAt: isoDateSchema.optional(),
});
export type CitationFile = z.infer<typeof citationFileSchema>;
