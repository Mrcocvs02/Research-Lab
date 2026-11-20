import { z } from 'zod';
import { documentIdSchema, isoDateSchema, itemIdSchema, legacySchema, relativePathSchema, schemaVersionSchema, sha256Schema } from '../common.js';
import { aiFieldSchema } from './ai-field.js';

/** Upper bounds of the free-text fields: a hostile or corrupt index must not produce unbounded records. */
export const DOCUMENT_LIMITS = {
  title: 2000,
  author: 300,
  authors: 500,
  venue: 500,
  venueRef: 500,
  identifier: 300,
  shortText: 100,
  userDescription: 2000,
  tags: 5000,
  paths: 1000,
  pathHistory: 200,
  hashes: 200,
  aiList: 1000,
  aiText: 20000,
} as const;
const L = DOCUMENT_LIMITS;

export const studyStateSchema = z.enum(['to-read', 'reading', 'read']);
export type StudyState = z.infer<typeof studyStateSchema>;

export const underlinedSchema = z.object({
  value: z.boolean().default(false),
  /** `annotations`: computed from in-app highlights; `manual`: set by hand. */
  origin: z.enum(['annotations', 'manual']).default('manual'),
});

export const studySchema = z.object({
  state: studyStateSchema.default('to-read'),
  underlined: underlinedSchema.prefault({}),
  updatedAt: isoDateSchema.optional(),
  /** Where reading stopped ("Resume", D-414): written when the reader closes or rests on a page. */
  lastPage: z.number().int().min(1).max(100_000).optional(),
  lastOpenedAt: isoDateSchema.optional(),
});
export type Study = z.infer<typeof studySchema>;

export const publicationStatusSchema = z.enum(['unknown', 'preprint', 'published', 'withdrawn']);

export const documentRefSchema = z.object({
  /** Venue as free text and/or id into taxonomy.venues. */
  venue: z.string().max(L.venue).optional(),
  venueId: itemIdSchema.optional(),
  /** Volume/pages/identifier of the venue (journal ref), or arXiv-style reference. */
  venueRef: z.string().max(L.venueRef).optional(),
});

export const aiRelationSchema = z.object({
  docId: documentIdSchema,
  reason: z.string().max(L.aiText),
});

/**
 * A taxonomy node the AI proposes because no existing one fits (plan §5: "alias e acronimi per ogni micro nuovo").
 * Nothing is created until the user accepts it; `parentId` is an existing node (null: a new root).
 */
export const aiNewTagSchema = z.object({
  label: z.string().trim().min(1).max(200),
  parentId: itemIdSchema.nullable(),
  /** Aliases and acronyms of the new node. */
  aliases: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  /** One line: why no existing node fits. */
  reason: z.string().max(500).optional(),
});
export type AiNewTag = z.infer<typeof aiNewTagSchema>;

export const aiTagScoreSchema = z.object({
  id: itemIdSchema,
  weight: z.number().min(0).max(1),
  origin: z.enum(['ai', 'ancestor']).default('ai'),
  reason: z.string().max(500).optional(),
});
export type AiTagScore = z.infer<typeof aiTagScoreSchema>;

/** AI-generated fields, always wrapped; never mixed with user fields. */
export const documentAiSchema = z.object({
  summary: aiFieldSchema(z.string().max(L.aiText)).optional(),
  description: aiFieldSchema(z.string().max(L.aiText)).optional(),
  keywords: aiFieldSchema(z.array(z.string().max(L.author)).max(L.aiList)).optional(),
  synonyms: aiFieldSchema(z.array(z.string().max(L.author)).max(L.aiList)).optional(),
  /**
   * Proposed taxonomy node ids (not applied until accepted by the user). On review the accepted ones are added to the
   * user's `tags`; `value` keeps the accepted subset and `review.originalValue` the full proposal (status `edited` when
   * only some were accepted), which is what the acceptance rate is computed from.
   */
  suggestedTags: aiFieldSchema(z.array(itemIdSchema).max(L.aiList)).optional(),
  /** Proposed NEW taxonomy nodes, same review rules as `suggestedTags` (an accepted one is created, then tagged). */
  suggestedNewTags: aiFieldSchema(z.array(aiNewTagSchema).max(20)).optional(),
  /**
   * Weight and reason of each proposed tag (D-447): `weight` 0-1 is the relevance given by Claude (an ancestor added by the
   * hierarchical closure has the attenuated weight of its best descendant, `origin: 'ancestor'`). Rides along `suggestedTags`:
   * the review of the tags is the review of these scores.
   */
  suggestedTagScores: aiFieldSchema(z.array(aiTagScoreSchema).max(L.aiList)).optional(),
  relations: aiFieldSchema(z.array(aiRelationSchema).max(L.aiList)).optional(),
  suggestedType: aiFieldSchema(z.string().max(L.shortText)).optional(),
});
export type DocumentAi = z.infer<typeof documentAiSchema>;

/**
 * Values the app took from the file itself (heuristics, never verified), kept apart from what the user or an
 * import set (D-071). A field is "extracted" while the record still holds the very value written here; a key that
 * is present was filled once and is never filled again, so a value the user clears does not come back.
 */
export const extractedMetaSchema = z.object({
  title: z.string().max(L.title).optional(),
  authors: z.array(z.string().max(L.author)).max(L.authors).optional(),
  year: z.number().int().min(1000).max(3000).optional(),
  doi: z.string().max(L.identifier).optional(),
  arxivId: z.string().max(L.identifier).optional(),
});
export type ExtractedFields = z.infer<typeof extractedMetaSchema>;

/**
 * What Research Lab itself appended to a PDF (ARCHITETTURA-UI §8.3.6). `base` is the content before the first append
 * (or the last full save by another program): it stays the identity of the content while `hash` follows the file.
 */
export const pdfWriteSchema = z.object({
  base: z.object({ hash: sha256Schema, size: z.number().int().nonnegative() }),
  /** Files produced by our own writes, newest last (at most 20). */
  own: z.array(z.object({ hash: sha256Schema, size: z.number().int().nonnegative(), at: isoDateSchema })).max(20).default([]),
  /** Copy of the file as it was before the first write. */
  backup: z.object({ file: relativePathSchema, hash: sha256Schema, location: z.enum(['data', 'local']) }).optional(),
});
export type PdfWrite = z.infer<typeof pdfWriteSchema>;

/** `<dataDir>/documents/<id>.json` */
export const documentRecordSchema = z.object({
  schemaVersion: schemaVersionSchema,
  /** Stable id = first 16 hex of the content hash at first indexing (D-006). */
  id: documentIdSchema,
  /** Current content hash (SHA-256, hex). */
  hash: sha256Schema,
  /** Previous content hashes, oldest first, so a changed file is still recognised. */
  previousHashes: z.array(sha256Schema).max(L.hashes).default([]),
  /** Set once Research Lab appended annotations to the file: the identity of the content is then `pdfWrite.base.hash`. */
  pdfWrite: pdfWriteSchema.optional(),
  /** Current path, relative to the library root, `/` separators. */
  path: relativePathSchema,
  pathHistory: z
    .array(z.object({ path: relativePathSchema, seenUntil: isoDateSchema }))
    .max(L.pathHistory)
    .default([]),
  /**
   * Other library paths holding the very same content (copies in other folders). One record, several paths:
   * the scanner must treat these as known files, not as new documents (D-032).
   */
  aliasPaths: z.array(relativePathSchema).max(L.paths).default([]),
  /** Bumped by the store at each write; callers pass it back as `expectedRevision` to detect lost updates. */
  revision: z.number().int().nonnegative().default(0),
  size: z.number().int().nonnegative(),
  mtimeMs: z.number().nonnegative(),
  /** True when the file was not found by the last scan (record kept until pruned). */
  missing: z.boolean().default(false),
  /**
   * Set by the scanner on new and changed files (no automatic tags): the inbox lists the documents that have it.
   * Cleared by whoever triages the document. `since` is when the scanner saw it.
   */
  inbox: z.object({ since: isoDateSchema, reason: z.enum(['new', 'changed']) }).optional(),

  /** Document type id (taxonomy.documentTypes). */
  type: z.string().max(L.shortText).nullable().default(null),
  title: z.string().max(L.title).nullable().default(null),
  authors: z.array(z.string().max(L.author)).max(L.authors).default([]),
  year: z.number().int().min(1000).max(3000).nullable().default(null),
  lang: z.string().max(L.shortText).nullable().default(null),
  ref: documentRefSchema.prefault({}),
  doi: z.string().max(L.identifier).nullable().default(null),
  arxivId: z.string().max(L.identifier).nullable().default(null),
  /** The user's short description of the file (TagSpaces' per-file description); searchable, never written by the AI. */
  userDescription: z.string().max(L.userDescription).optional(),
  publication: z
    .object({
      status: publicationStatusSchema.default('unknown'),
      source: z.string().max(L.venueRef).optional(),
      checkedAt: isoDateSchema.optional(),
    })
    .prefault({}),

  /** User-owned tags: taxonomy node ids. */
  tags: z.array(itemIdSchema).max(L.tags).default([]),
  /** Where a tag came from when it was not typed by the user (D-494); an absent key = by hand. */
  tagOrigin: z.record(itemIdSchema, z.enum(['ai', 'import'])).optional(),
  /** The main value the user fixed by hand in a family of the Map (D-521): key = the family root id (or `topic`), value = a tag of the paper; read only while the paper still carries the tag. */
  mainTags: z.record(itemIdSchema, itemIdSchema).refine((r) => Object.keys(r).length <= 50).optional(),
  /** Research groups (institutions) of the paper, derived from OpenAlex (D-488): they become tags `grp:<name>`, apart from `tags`. */
  groups: z.array(z.string().trim().min(1).max(L.author)).max(20).optional(),
  /** Groups of `groups` the user hid: a hidden group is no tag, and a refresh of `groups` does not bring it back. */
  groupsHidden: z.array(z.string().trim().min(1).max(L.author)).max(50).optional(),
  study: studySchema.prefault({}),

  ai: documentAiSchema.prefault({}),

  addedAt: isoDateSchema,
  updatedAt: isoDateSchema,
  /** Verbatim leftovers from imports (e.g. the old index) that have no native field. */
  legacy: legacySchema.optional(),
  /** What the extractor found in the file for the empty fields it filled (see `extractedMetaSchema`). */
  extracted: extractedMetaSchema.optional(),
  /** BibTeX key, assigned once (imported or derived) and never changed again: the linked .bib file depends on it. */
  citeKey: z.string().max(L.shortText).optional(),
});
export type DocumentRecord = z.infer<typeof documentRecordSchema>;

/** The hash that means "same content" (text cache, thumbnails, graph, AI, annotations): unchanged by our own appends. */
export const contentHashOf = (d: Pick<DocumentRecord, 'hash' | 'pdfWrite'>): string => d.pdfWrite?.base.hash ?? d.hash;
