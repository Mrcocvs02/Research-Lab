import { z } from 'zod';
import {
  documentIdSchema,
  isoDateSchema,
  itemIdSchema,
  legacySchema,
  relativePathSchema,
  schemaVersionSchema,
  sha256Schema,
} from '../common.js';
import { aiFieldSchema } from './ai-field.js';

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
});
export type Study = z.infer<typeof studySchema>;

export const publicationStatusSchema = z.enum(['unknown', 'preprint', 'published', 'withdrawn']);

export const documentRefSchema = z.object({
  /** Venue as free text and/or id into taxonomy.venues. */
  venue: z.string().optional(),
  venueId: itemIdSchema.optional(),
  /** Volume/pages/identifier of the venue (journal ref), or arXiv-style reference. */
  venueRef: z.string().optional(),
});

export const aiRelationSchema = z.object({
  docId: documentIdSchema,
  reason: z.string(),
});

/** AI-generated fields, always wrapped; never mixed with user fields. */
export const documentAiSchema = z.object({
  summary: aiFieldSchema(z.string()).optional(),
  description: aiFieldSchema(z.string()).optional(),
  keywords: aiFieldSchema(z.array(z.string())).optional(),
  synonyms: aiFieldSchema(z.array(z.string())).optional(),
  /** Proposed taxonomy node ids (not applied until accepted by the user). */
  suggestedTags: aiFieldSchema(z.array(itemIdSchema)).optional(),
  relations: aiFieldSchema(z.array(aiRelationSchema)).optional(),
  suggestedType: aiFieldSchema(z.string()).optional(),
});
export type DocumentAi = z.infer<typeof documentAiSchema>;

/** `<dataDir>/documents/<id>.json` */
export const documentRecordSchema = z.object({
  schemaVersion: schemaVersionSchema,
  /** Stable id = first 16 hex of the content hash at first indexing (D-006). */
  id: documentIdSchema,
  /** Current content hash (SHA-256, hex). */
  hash: sha256Schema,
  /** Previous content hashes, oldest first, so a changed file is still recognised. */
  previousHashes: z.array(sha256Schema).default([]),
  /** Current path, relative to the library root, `/` separators. */
  path: relativePathSchema,
  pathHistory: z.array(z.object({ path: relativePathSchema, seenUntil: isoDateSchema })).default([]),
  size: z.number().int().nonnegative(),
  mtimeMs: z.number().nonnegative(),
  /** True when the file was not found by the last scan (record kept until pruned). */
  missing: z.boolean().default(false),

  /** Document type id (taxonomy.documentTypes). */
  type: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  authors: z.array(z.string()).default([]),
  year: z.number().int().min(1000).max(3000).nullable().default(null),
  lang: z.string().nullable().default(null),
  ref: documentRefSchema.prefault({}),
  doi: z.string().nullable().default(null),
  arxivId: z.string().nullable().default(null),
  publication: z
    .object({
      status: publicationStatusSchema.default('unknown'),
      source: z.string().optional(),
      checkedAt: isoDateSchema.optional(),
    })
    .prefault({}),

  /** User-owned tags: taxonomy node ids. */
  tags: z.array(itemIdSchema).default([]),
  study: studySchema.prefault({}),

  ai: documentAiSchema.prefault({}),

  addedAt: isoDateSchema,
  updatedAt: isoDateSchema,
  /** Verbatim leftovers from imports (e.g. the old index) that have no native field. */
  legacy: legacySchema.optional(),
});
export type DocumentRecord = z.infer<typeof documentRecordSchema>;
