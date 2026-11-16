/**
 * Plain constants shared by the schemas and the renderer. No imports: the renderer reads them without pulling zod
 * into its first screen (D-172).
 */

/** Upper bounds of the free text of a project, and of its members. */
export const PROJECT_LIMITS = { name: 200, description: 5000, notes: 200_000, note: 2000, members: 20_000 } as const;

/** Upper bounds of search requests; `idsMax` is also the most documents one selection (Ctrl+A) and one bulk action can hold. */
export const SEARCH_LIMITS = { text: 500, listMax: 200, filterValues: 50, idsMax: 50_000 } as const;

/**
 * Upper bounds of the study data (phase 3): notes per file and per page, PDF annotations.
 * `pageMax` bounds a page number; `excerpt` is the length of a note preview in lists.
 */
export const STUDY_LIMITS = {
  noteBody: 200_000,
  pageMax: 100_000,
  excerpt: 200,
  annotationsPerDoc: 10_000,
  rectsPerAnnotation: 200,
  annotationText: 10_000,
  annotationComment: 5_000,
  /** Largest annotations file `annotations:save` writes (the store reads files up to twice this). */
  annotationsFileBytes: 16 * 1024 * 1024,
} as const;

/** Colours an annotation can take: the renderer maps each name to its own style (never raw CSS from data). */
export const ANNOTATION_COLORS = ['yellow', 'green', 'blue', 'pink', 'orange'] as const;

/**
 * Custom scheme that serves the bytes of a document to the in-app reader: `rl-doc://doc/<docId>?v=<first 8 hex of the
 * hash>`. Main resolves the id to a present PDF of the active library, confined to its root, and answers byte ranges.
 */
export const DOC_SCHEME = 'rl-doc';

/**
 * First-page thumbnails of the grid (phase 3, wave 3.2). Drawn by the renderer with pdf.js, kept by main in the local
 * cache of the app (never in the synced data folder), served as `rl-thumb://thumb/<docId>?v=<first 8 hex of the hash>`.
 */
export const THUMB_SCHEME = 'rl-thumb';
export const THUMB_LIMITS = {
  /** Largest WebP image accepted from the renderer. */
  maxBytes: 96 * 1024,
  /** Largest side of a thumbnail, in pixels. */
  maxSide: 512,
  /** Documents asked about in one `thumbs:list`. */
  batch: 200,
} as const;
