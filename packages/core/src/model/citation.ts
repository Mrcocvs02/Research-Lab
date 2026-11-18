import { z } from 'zod';
import { documentIdSchema, isoDateSchema, schemaVersionSchema } from '../common.js';

export const citationSourceIdSchema = z.enum(['openalex', 'arxiv', 'semanticscholar', 'pdf', 'manual']);
export type CitationSourceId = z.infer<typeof citationSourceIdSchema>;

/** Upper bounds of a citation file (synced, untrusted): a hostile or corrupt file must not produce unbounded records. */
export const CITATION_FILE_LIMITS = { text: 2000, author: 300, authors: 100, references: 5000, citedBy: 5000 } as const;
const L = CITATION_FILE_LIMITS;

/** One edge: a work cited by, or citing, the document. */
export const citationLinkSchema = z.object({
  /** Provider-specific id (e.g. OpenAlex work id `W123`). */
  externalId: z.string().max(L.text).optional(),
  doi: z.string().max(L.text).optional(),
  arxivId: z.string().max(L.text).optional(),
  title: z.string().max(L.text).optional(),
  authors: z.array(z.string().max(L.author)).max(L.authors).default([]),
  year: z.number().int().min(1000).max(3000).optional(),
  venue: z.string().max(L.text).optional(),
  /** 0-1 relevance to the citing work (mentions in the text, co-citation with the library, similarity with the note; D-446). */
  relevance: z.number().min(0).max(1).optional(),
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
  /** The work as the source knows it (e.g. OpenAlex `W123`), so later refreshes need no new lookup. */
  externalId: z.string().max(L.text).optional(),
  /** Works cited by the document. */
  references: z.array(citationLinkSchema).max(L.references).default([]),
  /** Works that cite the document (most recent first, capped). */
  citedBy: z.array(citationLinkSchema).max(L.citedBy).default([]),
  /** Total "cited by" count reported by the source (may exceed the stored list). */
  citedByCount: z.number().int().nonnegative().optional(),
  referencesCheckedAt: isoDateSchema.optional(),
  citedByCheckedAt: isoDateSchema.optional(),
});
export type CitationFile = z.infer<typeof citationFileSchema>;
