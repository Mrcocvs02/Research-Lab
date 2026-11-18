import { z } from 'zod';
import { documentIdSchema, itemIdSchema, relativePathSchema } from '../../common.js';
import { SCAN_LIMITS, SEARCH_LIMITS } from '../../limits.js';
import { studyStateSchema } from '../../model/document.js';
import { defineChannels } from '../registry.js';
import { scanStatusSchema } from './scan.js';


/**
 * Match markers in snippets: control characters, removed from every indexed text, so document content can
 * never forge them (D-080). Render the text between them as emphasis, still as text.
 */
export const SEARCH_MARK_OPEN = '\u0001';
export const SEARCH_MARK_CLOSE = '\u0002';

const value = z.string().min(1).max(300);
export const searchFiltersSchema = z.object({
  tags: z.array(value).max(SEARCH_LIMITS.filterValues).optional(),
  tagsAny: z.array(value).max(SEARCH_LIMITS.filterValues).optional(),
  tagsExclude: z.array(value).max(SEARCH_LIMITS.filterValues).optional(),
  authors: z.array(value).max(SEARCH_LIMITS.filterValues).optional(),
  types: z.array(value).max(SEARCH_LIMITS.filterValues).optional(),
  venues: z.array(value).max(SEARCH_LIMITS.filterValues).optional(),
  studyStates: z.array(studyStateSchema).max(3).optional(),
  /** Include documents whose file is missing (default false). */
  includeMissing: z.boolean().optional(),
  folders: z.array(relativePathSchema).max(SEARCH_LIMITS.filterValues).optional(),
  /** Restrict the result to an explicit set of documents (the Library filtered on a scan report list, §9). */
  docIds: z.array(documentIdSchema).max(SCAN_LIMITS.reportIds).optional(),
  /** Documents of one topic (a cluster id of the graph model, any level); the main process turns it into `docIds`, so no cap of 500 applies. Nothing matches without a built model. */
  topic: z.string().min(1).max(100).optional(),
  folder: relativePathSchema.optional(),
  includeSubfolders: z.boolean().optional(),
  yearFrom: z.number().int().min(1000).max(3000).optional(),
  yearTo: z.number().int().min(1000).max(3000).optional(),
});

export const searchSortSchema = z.enum(['relevance', 'title', 'year-desc', 'year-asc', 'added-desc', 'author', 'size-desc', 'size-asc']);
export const listSortSchema = z.enum(['title', 'year-desc', 'year-asc', 'added-desc', 'author', 'size-desc', 'size-asc']);

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
  /** File size in bytes. */
  size: z.number().int().nonnegative(),
  /** Tag ids of the document, implied ones included. */
  tags: z.array(z.string()),
  /** Only the tags set on the document itself (no implied ones): the ones the user can remove. */
  directTags: z.array(z.string()).optional(),
  score: z.number(),
  field: z.enum(['title', 'summary', 'note', 'annotation', 'text']),
  /** Match markers are U+0001 (open) and U+0002 (close); render the text between them as emphasis, never as HTML. */
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

const queryRequest = z.object({
  text: z.string().max(SEARCH_LIMITS.text),
  filters: searchFiltersSchema.optional(),
  sort: searchSortSchema.optional(),
  limit: limit.optional(),
  offset: offset.optional(),
});
const queryResponse = z.object({ total: z.number().int().nonnegative(), hits: z.array(searchHitSchema), tookMs: z.number().nonnegative() });

export const searchChannels = defineChannels('search', {
  /**
   * Offline full-text search of the active library (title, authors, abstract, keywords, tags, notes,
   * page text). Syntax: words, "phrases", prefix*, `a OR b`, `author:` `tag:` `type:` `year:` `venue:`.
   * Any text is valid; empty text lists the documents.
   */
  query: { request: queryRequest, response: queryResponse },
  /**
   * `query` and `facets` in one request: the text is matched once and `tookMs` covers all the work.
   * `offset` pages the hits; the facets always describe the whole result set.
   */
  run: { request: queryRequest, response: queryResponse.extend({ facets: searchFacetsSchema }) },
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
