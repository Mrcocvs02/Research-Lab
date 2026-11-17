import { z } from 'zod';
import { documentIdSchema, isoDateSchema, itemIdSchema } from '../../common.js';
import { DOCUMENT_LIMITS } from '../../model/document.js';
import { watchSeenSchema, watchSourceSchema } from '../../model/watch.js';
import { defineChannels, defineEvents } from '../registry.js';

const L = DOCUMENT_LIMITS;

export const watchSourceViewSchema = watchSourceSchema.extend({
  /** Items found and not dismissed. */
  newCount: z.number().int().nonnegative(),
});

/** A library preprint for which a published version was found (plan §4 phase 5 criterion). */
export const publishedProposalSchema = z.object({
  docId: documentIdSchema,
  title: z.string().nullable(),
  /** What the document says now. */
  current: z.object({ doi: z.string().nullable(), arxivId: z.string().nullable(), venue: z.string().nullable(), year: z.number().int().nullable() }),
  /** What the source says about the published version. */
  found: z.object({
    doi: z.string().max(L.identifier),
    venue: z.string().max(L.venue).nullable(),
    venueRef: z.string().max(L.venueRef).nullable(),
    year: z.number().int().min(1000).max(3000).nullable(),
    source: z.enum(['openalex', 'arxiv', 'semanticscholar']),
  }),
  revision: z.number().int().nonnegative(),
});

/**
 * Monitoring (plan §4 phase 5): followed authors, topics and venues, and the user's own preprints. Checks run ONLY on
 * request (`check`, `checkPublished`), never in the background or at startup; the network rules of `citations:*`
 * apply. Sources and seen items live in `<dataDir>/watch.json` (synced).
 */
export const watchChannels = defineChannels('watch', {
  list: { request: z.object({}), response: z.object({ sources: z.array(watchSourceViewSchema) }) },
  /** Adds or replaces a source (by id; a new id when absent). INVALID_REQUEST for an empty query (except own-preprint). */
  saveSource: {
    request: z.object({
      id: itemIdSchema.optional(),
      kind: watchSourceSchema.shape.kind,
      query: z.string().trim().max(2000),
      label: z.string().trim().max(200).default(''),
      enabled: z.boolean().default(true),
    }),
    response: watchSourceViewSchema,
  },
  removeSource: { request: z.object({ id: itemIdSchema }), response: z.object({ removed: z.boolean() }) },
  /**
   * Looks for works published since the source was last checked (first check: the last 90 days), remembers them as
   * seen, and returns how many are new. NETWORK_ERROR when a source cannot be reached (the others still run).
   */
  check: {
    request: z.object({ sourceIds: z.array(itemIdSchema).max(200).optional() }),
    response: z.object({ checked: z.number().int().nonnegative(), newItems: z.number().int().nonnegative(), failed: z.array(z.object({ sourceId: itemIdSchema, code: z.string() })) }),
  },
  /** Items found, newest first. */
  items: {
    request: z.object({ sourceId: itemIdSchema.optional(), includeDismissed: z.boolean().default(false), limit: z.number().int().min(1).max(200).default(100), offset: z.number().int().nonnegative().default(0) }),
    response: z.object({ items: z.array(watchSeenSchema.extend({ inLibrary: documentIdSchema.nullable() })), total: z.number().int().nonnegative() }),
  },
  dismiss: { request: z.object({ sourceId: itemIdSchema, externalId: z.string().max(2000) }), response: z.object({ ok: z.literal(true) }) },
  /**
   * Looks for published versions of the library's preprints (documents with `publication.status` 'preprint', or an
   * arXiv id and no DOI/venue; with `ownOnly`, only the user's own papers by the profile's author variants).
   */
  checkPublished: {
    request: z.object({ ownOnly: z.boolean().default(false), docIds: z.array(documentIdSchema).max(5000).optional() }),
    response: z.object({ checked: z.number().int().nonnegative(), proposals: z.array(publishedProposalSchema), failed: z.number().int().nonnegative() }),
  },
  /**
   * Applies a published version after the user's confirmation: DOI, venue, reference, year and
   * `publication = { status: 'published', source, checkedAt }` as the user's own fields, ONE logged change (undoable).
   * CONFLICT when `expectedRevision` is stale.
   */
  applyPublished: {
    request: z.object({
      docId: documentIdSchema,
      doi: z.string().trim().min(1).max(L.identifier),
      venue: z.string().trim().max(L.venue).nullable(),
      venueRef: z.string().trim().max(L.venueRef).nullable(),
      year: z.number().int().min(1000).max(3000).nullable(),
      source: z.enum(['openalex', 'arxiv', 'semanticscholar']),
      expectedRevision: z.number().int().nonnegative(),
    }),
    response: z.object({ changeId: z.string(), checkedAt: isoDateSchema }),
  },
});

/** Pushed when sources or items change (after a check or a dismissal). */
export const watchEvents = defineEvents('watch', {
  changed: z.object({ newItems: z.number().int().nonnegative() }),
});
