import { z } from 'zod';
import { documentIdSchema, isoDateSchema, itemIdSchema } from '../../common.js';
import { isValidDoi } from '../../security.js';
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
  /** Another library document that already has the found DOI: applying the proposal would duplicate it (applying is refused). */
  ownedBy: documentIdSchema.nullable().optional(),
});

/** The long operations that report progress and can be cancelled. */
export const watchOpSchema = z.enum(['check', 'checkPublished']);

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
   * seen, and returns how many are new. A source that cannot be reached is listed in `failed` (the others still run);
   * after 3 failures in a row the rest is not tried and each is listed with code `STOPPED`; a source with more
   * works than one check reads is listed with code `PARTIAL` (check again to continue). Reports `watch:progress` and
   * can be stopped with `watch:cancel` (the result then covers what was checked).
   */
  check: {
    request: z.object({ sourceIds: z.array(itemIdSchema).max(200).optional() }),
    response: z.object({ checked: z.number().int().nonnegative(), newItems: z.number().int().nonnegative(), failed: z.array(z.object({ sourceId: itemIdSchema, code: z.string() })) }),
  },
  /** Stops the running `check` or `checkPublished` after the request in flight; `cancelled` is false when none runs. */
  cancel: { request: z.object({ op: watchOpSchema }), response: z.object({ cancelled: z.boolean() }) },
  /**
   * Sets a damaged `watch.json` aside as `watch.json.corrupt` (replacing an earlier copy) and starts with no sources.
   * Offered when `list` fails with SCHEMA_INVALID. `backedUp` is false when there was no file to set aside.
   */
  reset: { request: z.object({}), response: z.object({ backedUp: z.boolean() }) },
  /** Items found, newest first. */
  items: {
    request: z.object({ sourceId: itemIdSchema.optional(), includeDismissed: z.boolean().default(false), limit: z.number().int().min(1).max(200).default(100), offset: z.number().int().nonnegative().default(0) }),
    response: z.object({ items: z.array(watchSeenSchema.extend({ inLibrary: documentIdSchema.nullable() })), total: z.number().int().nonnegative() }),
  },
  dismiss: { request: z.object({ sourceId: itemIdSchema, externalId: z.string().max(2000) }), response: z.object({ ok: z.literal(true) }) },
  /**
   * Looks for published versions of the library's preprints (documents with `publication.status` 'preprint', or an
   * arXiv id and no DOI/venue; with `ownOnly`, only the user's own papers by the profile's author variants). Reports
   * `watch:progress`, can be stopped with `watch:cancel`, and stops after 3 documents in a row whose sources failed
   * (the rest count as failed, `checked` covers what was looked at). A found DOI that another library document has
   * carries `ownedBy`.
   */
  checkPublished: {
    request: z.object({ ownOnly: z.boolean().default(false), docIds: z.array(documentIdSchema).max(5000).optional() }),
    response: z.object({ checked: z.number().int().nonnegative(), proposals: z.array(publishedProposalSchema), failed: z.number().int().nonnegative() }),
  },
  /**
   * Applies a published version after the user's confirmation: DOI, venue, reference, year and
   * `publication = { status: 'published', source, checkedAt }` as the user's own fields, ONE logged change (undoable).
   * CONFLICT when `expectedRevision` is stale, or (`details.reason` 'doi-owned') when another document already has the DOI.
   */
  applyPublished: {
    request: z.object({
      docId: documentIdSchema,
      doi: z.string().trim().max(L.identifier).refine(isValidDoi, 'Not a DOI'),
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
  /** Progress of `check` / `checkPublished` (`done` of `total` looked at, `failed` of those). */
  progress: z.object({ op: watchOpSchema, done: z.number().int().nonnegative(), total: z.number().int().nonnegative(), failed: z.number().int().nonnegative() }),
});
