import { z } from 'zod';
import { documentIdSchema, itemIdSchema, relativePathSchema } from '../../common.js';
import { studyStateSchema } from '../../model/document.js';
import { defineChannels } from '../registry.js';
import { scanStatusSchema } from './scan.js';

export const SEARCH_LIMITS = { text: 500, listMax: 200, filterValues: 50 } as const;

const value = z.string().min(1).max(300);
export const searchFiltersSchema = z.object({
  tags: z.array(value).max(SEARCH_LIMITS.filterValues).optional(),
  authors: z.array(value).max(SEARCH_LIMITS.filterValues).optional(),
  types: z.array(value).max(SEARCH_LIMITS.filterValues).optional(),
  venues: z.array(value).max(SEARCH_LIMITS.filterValues).optional(),
  studyStates: z.array(studyStateSchema).max(3).optional(),
  folders: z.array(relativePathSchema).max(SEARCH_LIMITS.filterValues).optional(),
  yearFrom: z.number().int().min(1000).max(3000).optional(),
  yearTo: z.number().int().min(1000).max(3000).optional(),
});

export const searchSortSchema = z.enum(['relevance', 'title', 'year-desc', 'year-asc', 'added-desc', 'author']);
export const listSortSchema = z.enum(['title', 'year-desc', 'year-asc', 'added-desc', 'author']);

const limit = z.number().int().min(1).max(SEARCH_LIMITS.listMax);
const offset = z.number().int().min(0).max(1_000_000);

export const searchHitSchema = z.object({
  docId: documentIdSchema,
  title: z.string().nullable(),
  authors: z.array(z.string()),
  year: z.number().int().nullable(),
  type: z.string().nullable(),
  /** Relative to the library root. */
  path: relativePathSchema,
  studyState: studyStateSchema,
  score: z.number(),
  field: z.enum(['title', 'summary', 'note', 'annotation', 'text']),
  /** Match markers are `[[` and `]]`; render them as text, never as HTML. */
  snippet: z.string(),
  /** Best matching page (1-based). */
  page: z.number().int().positive().optional(),
  pages: z.array(z.object({ page: z.number().int().positive(), snippet: z.string() })).optional(),
});

export const facetBucketSchema = z.object({
  value: z.string(),
  /** Display name when it differs from the value (tag and type labels). */
  label: z.string().optional(),
  count: z.number().int().nonnegative(),
});

export const searchFacetsSchema = z.object({
  total: z.number().int().nonnegative(),
  tags: z.array(facetBucketSchema),
  authors: z.array(facetBucketSchema),
  types: z.array(facetBucketSchema),
  venues: z.array(facetBucketSchema),
  studyStates: z.array(facetBucketSchema),
  years: z.array(facetBucketSchema),
  folders: z.array(facetBucketSchema),
});

export const searchChannels = defineChannels('search', {
  /**
   * Offline full-text search of the active library (title, authors, abstract, keywords, tags, notes,
   * page text). Syntax: words, "phrases", prefix*, `a OR b`, `author:` `tag:` `type:` `year:` `venue:`.
   * Any text is valid; empty text lists the documents.
   */
  query: {
    request: z.object({
      text: z.string().max(SEARCH_LIMITS.text),
      filters: searchFiltersSchema.optional(),
      sort: searchSortSchema.optional(),
      limit: limit.optional(),
      offset: offset.optional(),
    }),
    response: z.object({ total: z.number().int().nonnegative(), hits: z.array(searchHitSchema), tookMs: z.number().nonnegative() }),
  },
  /** Counts per tag, author, type, venue, study state, year and top-level folder for the same query. */
  facets: {
    request: z.object({ text: z.string().max(SEARCH_LIMITS.text), filters: searchFiltersSchema.optional() }),
    response: searchFacetsSchema,
  },
});

export const indexChannels = defineChannels('index', {
  /**
   * Drops the search index and refills it from the library data and the text cache
   * (texts missing from the cache are extracted again in the background). Returns the scan status.
   */
  rebuild: { request: z.object({ libraryId: itemIdSchema.optional() }), response: scanStatusSchema },
});
