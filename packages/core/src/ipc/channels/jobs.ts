import { z } from 'zod';
import { documentIdSchema, isoDateSchema } from '../../common.js';
import { AI_LIMITS } from '../../limits.js';
import { reasoningLevelSchema } from '../../settings.js';
import { defineChannels, defineEvents } from '../registry.js';
import { aiPreviewSchema } from './ai.js';

/**
 * Fields an AI job can propose for a document (plan §5, uses 1-3). `tags` fills `ai.suggestedTags` (existing taxonomy
 * nodes only) and, when nothing fits, `ai.suggestedNewTags`; the others fill the field of the same name. Everything is
 * written as PROPOSED, for the user's review.
 */
export const aiJobFieldSchema = z.enum(['tags', 'description', 'summary', 'keywords', 'synonyms']);
export type AiJobField = z.infer<typeof aiJobFieldSchema>;

/** What a job does: today only `suggest` (propose fields for the given documents, one model call per document). */
export const aiJobRequestSchema = z.object({
  kind: z.literal('suggest'),
  docIds: z.array(documentIdSchema).min(1).max(AI_LIMITS.jobDocs),
  fields: z.array(aiJobFieldSchema).min(1).max(5),
  model: z.string().min(1).max(100),
  reasoning: reasoningLevelSchema,
  /**
   * False (default): a document whose field already holds a value (proposed, accepted, edited or rejected) is skipped
   * for that field, so nothing is sent twice (plan §5, cache). True: proposed and rejected values are proposed again;
   * accepted and edited ones are NEVER overwritten.
   */
  regenerate: z.boolean().default(false),
  /**
   * `direct`: one call per document from the first pages (the original job). `analysis` (D-446): extraction, then the
   * literature note, then tags, description, summary and keywords derived FROM the note.
   */
  pipeline: z.enum(['direct', 'analysis']).default('direct'),
});

export const aiJobStateSchema = z.enum(['queued', 'running', 'done', 'cancelled', 'failed']);

export const aiJobStatusSchema = z.object({
  jobId: z.string().max(100),
  kind: z.literal('suggest'),
  fields: z.array(aiJobFieldSchema),
  model: z.string(),
  state: aiJobStateSchema,
  /** Documents the job will send (allowed and not skipped). */
  total: z.number().int().nonnegative(),
  /** Documents finished, failed (the reason of the last failure is in `error`), and skipped before the start. */
  done: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  /** Spent so far by this job (from the usage the provider reported). */
  usd: z.number().nonnegative(),
  createdAt: isoDateSchema,
  finishedAt: isoDateSchema.optional(),
  /** Last document processed, for a "working on…" line. */
  currentDocId: documentIdSchema.optional(),
  /** Why the job stopped (state `failed`), or the last per-document failure. */
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type AiJobStatus = z.infer<typeof aiJobStatusSchema>;

/**
 * Bulk AI jobs with an estimate first (plan §5: "una stima precede ogni lavoro in blocco; nulla parte senza richiesta").
 * Jobs of the active library run one at a time, one document at a time, in main; they live for the session only
 * (each result is written to the document as soon as it arrives, so a stopped job loses nothing done). Every call is
 * in the AI-send log. Only documents in `aiEnabledFolders` are sent; the excerpt sent is metadata plus the first pages,
 * never the whole text.
 */
export const jobsChannels = defineChannels('jobs', {
  /** What `start` would send, and what it would cost; nothing is sent. */
  estimate: {
    request: aiJobRequestSchema,
    response: z.object({
      preview: aiPreviewSchema,
      /** Allowed documents that would be skipped (every requested field already has a value, see `regenerate`). */
      skipped: z.number().int().nonnegative(),
      /** Documents that would be sent. */
      toSend: z.number().int().nonnegative(),
    }),
  },
  /**
   * Queues a job. CONFLICT with `details.reason` 'needs-confirmation' when the estimate asks for a confirmation and
   * `confirmed` is false; AI_BUDGET_EXCEEDED over the monthly cap; AI_PROVIDER_ERROR ('no-access' | 'offline') when
   * Claude cannot be reached; INVALID_REQUEST when no document would be sent.
   */
  start: {
    request: aiJobRequestSchema.extend({ confirmed: z.boolean().default(false) }),
    response: z.object({ jobId: z.string() }),
  },
  /** Starts again a job of this session with its own request (after the token cap was raised, D-442); documents already done are skipped by the plan. */
  restart: { request: z.object({ jobId: z.string().max(100) }), response: z.object({ jobId: z.string() }) },
  /**
   * Builds (`build`) or extends (`extend`) the domain taxonomy from the library (D-446): titles, literature notes and keywords of
   * the AI-enabled folders go to the stronger model, which proposes hierarchical nodes (field, subfield, topic, method) with alias and
   * definition. The nodes land as CANDIDATES (`origin: ai`) for one review in the taxonomy manager. CONFLICT 'needs-confirmation'
   * (with the preview) until `confirmed`; AI_BUDGET_EXCEEDED and AI_PROVIDER_ERROR as `start`.
   */
  taxonomy: {
    request: z.object({ mode: z.enum(['build', 'extend']), model: z.string().min(1).max(100), reasoning: reasoningLevelSchema, confirmed: z.boolean().default(false) }),
    response: z.object({ added: z.number().int().nonnegative(), calls: z.number().int().nonnegative() }),
  },
  /** Stops a job; documents already done keep their proposals. */
  cancel: { request: z.object({ jobId: z.string().max(100) }), response: z.object({ cancelled: z.boolean() }) },
  /** Jobs of this session, newest first. */
  list: { request: z.object({}), response: z.object({ items: z.array(aiJobStatusSchema).max(AI_LIMITS.jobsKept) }) },
});

/** Pushed at each change of a job (at most a few per second). */
export const jobsEvents = defineEvents('jobs', {
  progress: aiJobStatusSchema,
});
