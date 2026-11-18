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

/** Upper bounds of the scan report (§9). */
export const SCAN_LIMITS = {
  /** Ids of each list of the report of the last scan (`scan:report`); beyond that `truncated` is true. */
  reportIds: 500,
} as const;

/** Upper bounds of the AI layer (phase 4). */
export const AI_LIMITS = {
  /** Characters of one chat message of the user. */
  message: 20_000,
  /** Documents given to the chat as context (the selection). */
  contextDocs: 50,
  /** Documents of one preview or one bulk job. */
  jobDocs: 5_000,
  /** Characters of a conversation title. */
  title: 200,
  /** Conversations listed at once. */
  conversations: 500,
  /** New taxonomy nodes the AI may propose for one document. */
  newTags: 20,
  /** Items of one page of the review queue, and of one bulk decision. */
  reviewPage: 200,
  /** Jobs kept in the list of the session (finished ones are dropped oldest first). */
  jobsKept: 50,
} as const;

/** Upper bounds of the inbox (phase 4, wave 4.2). */
export const INBOX_LIMITS = {
  /** Items waiting in the inbox of one library (files dropped from outside plus new files found by the scan). */
  items: 500,
  /** Files of one drop or one dialog choice. */
  addBatch: 50,
  /** Largest PDF accepted from outside the library. */
  fileBytes: 512 * 1024 * 1024,
  /** Characters of a proposed file name (extension included). */
  name: 180,
  /** Characters of an abstract kept from the online record. */
  abstract: 20_000,
} as const;
