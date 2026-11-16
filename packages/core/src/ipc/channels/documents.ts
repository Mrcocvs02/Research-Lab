import { z } from 'zod';
import { documentIdSchema, isoDateSchema, relativePathSchema } from '../../common.js';
import { documentRecordSchema, studyStateSchema } from '../../model/document.js';
import { defineChannels } from '../registry.js';
import { listSortSchema, searchFiltersSchema, SEARCH_LIMITS } from './search.js';

export const documentSummarySchema = z.object({
  docId: documentIdSchema,
  title: z.string().nullable(),
  authors: z.array(z.string()),
  year: z.number().int().nullable(),
  type: z.string().nullable(),
  venue: z.string().nullable(),
  path: relativePathSchema,
  studyState: studyStateSchema,
  tags: z.array(z.string()),
  addedAt: isoDateSchema.or(z.literal('')),
  missing: z.boolean(),
});

/**
 * What the renderer may see of a record: everything except `legacy` (verbatim leftovers of the old index,
 * which can hold absolute paths and other data with no meaning here). D-081.
 */
export const documentViewSchema = documentRecordSchema.omit({ legacy: true });

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
  /** The record of one document, without `legacy` (NOT_FOUND when unknown). */
  get: { request: z.object({ docId: documentIdSchema }), response: documentViewSchema },
});
