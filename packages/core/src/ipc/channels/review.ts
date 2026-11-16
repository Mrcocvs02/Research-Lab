import { z } from 'zod';
import { documentIdSchema, itemIdSchema, relativePathSchema } from '../../common.js';
import { AI_LIMITS } from '../../limits.js';
import { aiMetaSchema, reviewStatusSchema } from '../../model/ai-field.js';
import { aiNewTagSchema, aiRelationSchema, DOCUMENT_LIMITS } from '../../model/document.js';
import { defineChannels } from '../registry.js';
import { documentViewSchema } from './documents.js';

const L = DOCUMENT_LIMITS;

/**
 * Reviewable AI fields of a document. `tags` is `ai.suggestedTags`, `newTags` is `ai.suggestedNewTags`; the others are
 * the fields of the same name in `document.ai`.
 */
export const reviewFieldSchema = z.enum(['tags', 'newTags', 'description', 'summary', 'keywords', 'synonyms', 'relations']);
export type ReviewField = z.infer<typeof reviewFieldSchema>;

const itemBase = {
  docId: documentIdSchema,
  title: z.string().nullable(),
  path: relativePathSchema,
  /** Revision of the document record, to pass back as `expectedRevision`. */
  revision: z.number().int().nonnegative(),
  status: reviewStatusSchema,
  meta: aiMetaSchema,
};

/** One AI field of one document, as the review queue shows it. `originalValue` is the proposal before an edit. */
export const reviewItemSchema = z.discriminatedUnion('field', [
  z.object({ ...itemBase, field: z.literal('tags'), value: z.array(itemIdSchema), originalValue: z.array(itemIdSchema).optional() }),
  z.object({ ...itemBase, field: z.literal('newTags'), value: z.array(aiNewTagSchema), originalValue: z.array(aiNewTagSchema).optional() }),
  z.object({ ...itemBase, field: z.literal('description'), value: z.string(), originalValue: z.string().optional() }),
  z.object({ ...itemBase, field: z.literal('summary'), value: z.string(), originalValue: z.string().optional() }),
  z.object({ ...itemBase, field: z.literal('keywords'), value: z.array(z.string()), originalValue: z.array(z.string()).optional() }),
  z.object({ ...itemBase, field: z.literal('synonyms'), value: z.array(z.string()), originalValue: z.array(z.string()).optional() }),
  z.object({ ...itemBase, field: z.literal('relations'), value: z.array(aiRelationSchema), originalValue: z.array(aiRelationSchema).optional() }),
]);
export type ReviewItem = z.infer<typeof reviewItemSchema>;

/**
 * Review of what the AI proposed (plan §4 phase 4, §5 quality): accept, reject or edit, field by field. AI values stay
 * in `document.ai.*`, marked as generated, also once accepted; the only values that move into the user's own fields
 * are accepted tags (added to `tags`) and accepted new taxonomy nodes (created with origin 'ai', then added to `tags`).
 * Every decision is ONE logged change that undo reverts as a whole (taxonomy nodes created by it included).
 */
export const reviewChannels = defineChannels('review', {
  /** The queue: AI fields with the given status (default: proposed), oldest proposal first. */
  list: {
    request: z.object({
      status: reviewStatusSchema.default('proposed'),
      fields: z.array(reviewFieldSchema).max(7).optional(),
      /** Only these documents (e.g. the selection). */
      docIds: z.array(documentIdSchema).max(AI_LIMITS.jobDocs).optional(),
      limit: z.number().int().min(1).max(AI_LIMITS.reviewPage).default(50),
      offset: z.number().int().nonnegative().default(0),
    }),
    response: z.object({ items: z.array(reviewItemSchema), total: z.number().int().nonnegative() }),
  },
  /**
   * Decides one field of one document. `accept` takes the proposal (for `tags` only the ids in `keepTagIds` when given,
   * for `newTags` only the entries in `keepNewTags`, possibly corrected; the rest counts as rejected). `edit` replaces
   * a text (`text`) or a list (`items`) and keeps the proposal as `originalValue`. `reject` keeps the value for the
   * record and the statistics, and applies nothing. CONFLICT ('revision') when `expectedRevision` is stale;
   * CONFLICT ('not-proposed') when the field is not in the proposed state; INVALID_REQUEST when the payload does not
   * fit the field or the decision.
   */
  decide: {
    request: z.object({
      docId: documentIdSchema,
      field: reviewFieldSchema,
      decision: z.enum(['accept', 'reject', 'edit']),
      keepTagIds: z.array(itemIdSchema).max(L.aiList).optional(),
      keepNewTags: z
        .array(
          z.object({
            index: z.number().int().nonnegative().max(19),
            label: z.string().trim().min(1).max(200).optional(),
            parentId: itemIdSchema.nullable().optional(),
            aliases: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
          }),
        )
        .max(20)
        .optional(),
      text: z.string().trim().min(1).max(L.aiText).optional(),
      items: z.array(z.string().trim().min(1).max(L.author)).max(L.aiList).optional(),
      expectedRevision: z.number().int().nonnegative().optional(),
    }),
    response: z.object({
      document: documentViewSchema,
      changeId: z.string().nullable(),
      /** Taxonomy nodes created by accepting `newTags`. */
      createdNodeIds: z.array(itemIdSchema),
    }),
  },
  /**
   * Accepts or rejects many proposals at once (all of each proposal), as ONE logged change. Items that are no longer
   * proposed are reported in `failed` and do not stop the others.
   */
  decideMany: {
    request: z.object({
      items: z.array(z.object({ docId: documentIdSchema, field: reviewFieldSchema })).min(1).max(AI_LIMITS.reviewPage),
      decision: z.enum(['accept', 'reject']),
    }),
    response: z.object({
      changeId: z.string().nullable(),
      changed: z.number().int().nonnegative(),
      failed: z.array(z.object({ docId: documentIdSchema, field: reviewFieldSchema, code: z.string() })),
    }),
  },
  /**
   * Counts for the review screen and for the phase 4 criterion (at least 80% of the proposed tags accepted):
   * `tags.proposed` counts the tags of every reviewed proposal, `tags.accepted` those the user kept.
   */
  stats: {
    request: z.object({}),
    response: z.object({
      pending: z.record(reviewFieldSchema, z.number().int().nonnegative()),
      tags: z.object({ proposed: z.number().int().nonnegative(), accepted: z.number().int().nonnegative(), rate: z.number().min(0).max(1).nullable() }),
      newTags: z.object({ proposed: z.number().int().nonnegative(), accepted: z.number().int().nonnegative() }),
    }),
  },
});
