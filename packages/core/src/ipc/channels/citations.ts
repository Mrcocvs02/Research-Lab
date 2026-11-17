import { z } from 'zod';
import { documentIdSchema, isoDateSchema, relativePathSchema } from '../../common.js';
import { citationLinkSchema } from '../../model/citation.js';
import { defineChannels, defineEvents } from '../registry.js';

/** Upper bounds of the phase 5 channels. */
export const CITATION_LIMITS = { refreshMany: 2000, readNext: 200, citingShown: 20 } as const;

/** A citation edge as the UI shows it: the stored link plus the library document it matches, if any. */
export const citationLinkViewSchema = citationLinkSchema.extend({
  matched: z.object({ docId: documentIdSchema, title: z.string().nullable(), path: relativePathSchema }).nullable(),
});

export const citationViewSchema = z.object({
  docId: documentIdSchema,
  /** False when nothing was ever fetched for this document. */
  fetched: z.boolean(),
  references: z.array(citationLinkViewSchema),
  citedBy: z.array(citationLinkViewSchema),
  citedByCount: z.number().int().nonnegative().nullable(),
  referencesCheckedAt: isoDateSchema.nullable(),
  citedByCheckedAt: isoDateSchema.nullable(),
  /** Counts for the "in library / missing" summary of the references. */
  inLibrary: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
});
export type CitationView = z.infer<typeof citationViewSchema>;

export const citationJobStatusSchema = z.object({
  jobId: z.string().max(100),
  state: z.enum(['queued', 'running', 'done', 'cancelled', 'failed']),
  total: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** Documents left out: no DOI, arXiv id or title good enough to look up, or checked within `skipCheckedDays`. */
  skipped: z.number().int().nonnegative(),
  /** Documents no online source knows (they are not failures). */
  notFound: z.number().int().nonnegative().default(0),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

/**
 * References and "cited by" (plan §4 phase 5): OpenAlex first, arXiv and Semantic Scholar as fallbacks, matched to the
 * library documents (DOI, arXiv id, or title + year + first author). Stored in `<dataDir>/citations/<docId>.json`, so
 * what was fetched once works offline. The network is used ONLY on an explicit refresh; only identifiers and titles
 * of the documents go out (never their text), and the user's email only when the user opted in
 * (`settings.network.openAlexEmail`). NETWORK_ERROR (`details.reason` 'offline' | 'rate-limited' | 'http') when a
 * source cannot be reached; NOT_FOUND when no source knows the work.
 */
export const citationsChannels = defineChannels('citations', {
  /** What is stored for a document (no network). */
  get: { request: z.object({ docId: documentIdSchema }), response: citationViewSchema },
  /** Fetches references and cited-by for one document now, then returns the view. */
  refresh: {
    request: z.object({ docId: documentIdSchema, what: z.array(z.enum(['references', 'citedBy'])).min(1).max(2).default(['references', 'citedBy']) }),
    response: citationViewSchema,
  },
  /** Refreshes many documents in the background, one source call at a time within the sources' rate limits. */
  refreshMany: {
    request: z.object({
      docIds: z.array(documentIdSchema).min(1).max(CITATION_LIMITS.refreshMany),
      /** Documents whose citations were refreshed within this many days are skipped (0: refresh everything). Default 7. */
      skipCheckedDays: z.number().int().min(0).max(365).default(7),
    }),
    response: z.object({ jobId: z.string() }),
  },
  cancel: { request: z.object({ jobId: z.string().max(100) }), response: z.object({ cancelled: z.boolean() }) },
  /**
   * Opens the page of a work in the system browser. The renderer sends the identifier, never a URL: main checks its
   * shape (DOI `10.NNNN/…` without control or bidi characters, arXiv new or old id, OpenAlex `W123`), builds the URL on
   * doi.org, arxiv.org or openalex.org with every path segment encoded, checks it against the allowed external hosts,
   * and opens it. INVALID_REQUEST for an identifier of the wrong shape; PERMISSION_DENIED if the host were refused.
   */
  openExternal: {
    request: z.object({ kind: z.enum(['doi', 'arxiv', 'openalex']), id: z.string().min(1).max(300) }),
    response: z.object({ ok: z.literal(true) }),
  },
});

export const citationsEvents = defineEvents('citations', {
  progress: citationJobStatusSchema,
});

/** A work cited by several library documents and not owned (plan §4 phase 5, "da leggere dopo"). */
export const readNextItemSchema = z.object({
  /** `doi:…`, `arxiv:…` or `oa:W…`: the key to dismiss it. */
  key: z.string(),
  work: citationLinkSchema.omit({ matchedDocId: true, checkedAt: true }),
  /** The reason, shown: the library documents that cite it (at most `citingShown`), and how many in all. */
  citing: z.array(z.object({ docId: documentIdSchema, title: z.string().nullable() })),
  citingCount: z.number().int().positive(),
  /** Of those, how many are in the current scope (project or folder) when one is given. */
  score: z.number(),
});

/**
 * Recommendations computed locally from the stored citation files (offline, no AI): works cited by at least
 * `minCiting` library documents and not in the library, most cited first.
 */
export const recommendChannels = defineChannels('recommend', {
  readNext: {
    request: z.object({
      limit: z.number().int().min(1).max(CITATION_LIMITS.readNext).default(50),
      minCiting: z.number().int().min(1).max(50).default(2),
      /** Restrict the citing documents to a project or a folder (sub-folders included). */
      projectId: z.string().max(100).optional(),
      folder: relativePathSchema.optional(),
    }),
    response: z.object({ items: z.array(readNextItemSchema), documentsWithCitations: z.number().int().nonnegative() }),
  },
  /** Hides a recommendation (stored in `watch.json`, synced). */
  dismiss: { request: z.object({ key: z.string().min(1).max(2000) }), response: z.object({ ok: z.literal(true) }) },
});
