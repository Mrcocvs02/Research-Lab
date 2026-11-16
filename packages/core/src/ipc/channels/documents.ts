import { z } from 'zod';
import { documentIdSchema, isoDateSchema, itemIdSchema, relativePathSchema } from '../../common.js';
import { DOCUMENT_LIMITS, documentRecordSchema, studyStateSchema } from '../../model/document.js';
import { defineChannels } from '../registry.js';
import { listSortSchema, searchFiltersSchema, searchSortSchema, SEARCH_LIMITS } from './search.js';

export const documentSummarySchema = z.object({
  docId: documentIdSchema,
  title: z.string().nullable(),
  authors: z.array(z.string()),
  year: z.number().int().nullable(),
  type: z.string().nullable(),
  venue: z.string().nullable(),
  path: relativePathSchema,
  studyState: studyStateSchema,
  /** Tag ids of the document, implied ones included. */
  tags: z.array(z.string()),
  /** Only the tags set on the document itself (no implied ones): the ones the user can remove. */
  directTags: z.array(z.string()).optional(),
  addedAt: isoDateSchema.or(z.literal('')),
  missing: z.boolean(),
  /** File size in bytes. */
  size: z.number().int().nonnegative(),
});

/**
 * What the renderer may see of a record: everything except `legacy` (verbatim leftovers of the old index,
 * which can hold absolute paths and other data with no meaning here). D-081.
 */
export const documentViewSchema = documentRecordSchema.omit({ legacy: true });

const L = DOCUMENT_LIMITS;
const nullableText = (max: number) => z.string().trim().max(max).nullable();

/**
 * The fields of a document the user owns. Strict: any other key (AI fields, tags, path, hash...) is refused.
 * `null` clears a value; an absent key is left alone. A value set here wins over the one extracted from the file.
 */
export const documentPatchSchema = z
  .strictObject({
    title: nullableText(L.title),
    authors: z.array(z.string().trim().min(1).max(L.author)).max(L.authors),
    year: z.number().int().min(1000).max(3000).nullable(),
    /** Id of a document type of the taxonomy. */
    type: z.string().max(L.shortText).nullable(),
    /** Venue as free text. */
    venue: nullableText(L.venue),
    /** Id of a venue of the taxonomy. */
    venueId: itemIdSchema.nullable(),
    /** Volume/pages/identifier of the venue (journal reference). */
    venueRef: nullableText(L.venueRef),
    doi: nullableText(L.identifier),
    arxivId: nullableText(L.identifier),
    /** The user's short description of the file. */
    userDescription: z.string().max(L.userDescription),
    studyState: studyStateSchema,
    /** Manual "underlined" flag. */
    underlined: z.boolean(),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, 'empty patch');
export type DocumentPatch = z.infer<typeof documentPatchSchema>;

export const documentsChannels = defineChannels('documents', {
  /** Paginated, sorted and filtered list of the documents of the active library (from the index; no file is read). */
  list: {
    request: z.object({
      filters: searchFiltersSchema.optional(),
      sort: listSortSchema.optional(),
      limit: z.number().int().min(1).max(SEARCH_LIMITS.listMax).optional(),
      offset: z.number().int().min(0).max(1_000_000).optional(),
    }),
    response: z.object({ total: z.number().int().nonnegative(), items: z.array(documentSummarySchema) }),
  },
  /**
   * Only the ids of the documents that `search:query` (with `text`) or `documents:list` (without) would list for the
   * same filters, in the same order, at most `limit` of them (default and ceiling `SEARCH_LIMITS.idsMax`); `total` is the
   * number of matches. For "select all": no row is built and nothing else is sent.
   */
  ids: {
    request: z.object({
      text: z.string().max(SEARCH_LIMITS.text).optional(),
      filters: searchFiltersSchema.optional(),
      sort: searchSortSchema.optional(),
      limit: z.number().int().min(1).max(SEARCH_LIMITS.idsMax).optional(),
    }),
    response: z.object({ total: z.number().int().nonnegative(), ids: z.array(documentIdSchema) }),
  },
  /** The record of one document, without `legacy` (NOT_FOUND when unknown). */
  get: { request: z.object({ docId: documentIdSchema }), response: documentViewSchema },
  /**
   * Changes user-owned fields of one document (never AI fields). `expectedRevision` = the record revision the caller
   * read (CONFLICT otherwise). Logged and undoable. Errors: NOT_FOUND (document, type or venue id), INVALID_REQUEST.
   */
  update: {
    request: z.object({ docId: documentIdSchema, patch: documentPatchSchema, expectedRevision: z.number().int().nonnegative().optional() }),
    response: z.object({ document: documentViewSchema, changeId: z.string() }),
  },
  /**
   * Adds and/or removes tags (taxonomy node ids) on many documents as ONE change. All-or-nothing validation:
   * an unknown document or tag, or a deprecated tag to add, rejects the whole request.
   * Tags already present / already absent are skipped (`unchanged`).
   */
  tag: {
    request: z.object({
      docIds: z.array(documentIdSchema).min(1).max(5000),
      add: z.array(itemIdSchema).max(100).optional(),
      remove: z.array(itemIdSchema).max(100).optional(),
    }),
    response: z.object({ changeId: z.string().nullable(), changed: z.number().int().nonnegative(), unchanged: z.number().int().nonnegative() }),
  },
  /** Opens the file with the system's default application. The path is resolved in main; only present files (not `missing`). */
  open: { request: z.object({ docId: documentIdSchema }), response: z.object({ ok: z.literal(true) }) },
  /** Shows the file in the system's file manager. Same rules as `open`. */
  reveal: { request: z.object({ docId: documentIdSchema }), response: z.object({ ok: z.literal(true) }) },
});
