import { z } from 'zod';
import { isoDateSchema, itemIdSchema } from '../../common.js';
import { serializedErrorSchema } from '../../errors.js';
import { defineChannels, defineEvents } from '../registry.js';

export const scanStateSchema = z.enum(['idle', 'running', 'done', 'failed', 'cancelled']);
export const scanPhaseSchema = z.enum(['walking', 'hashing', 'extracting', 'indexing']);

export const scanSummarySchema = z.object({
  added: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
  moved: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  /** Documents whose text was extracted in this run. */
  extracted: z.number().int().nonnegative(),
  /** Documents whose text could not be extracted (still searchable by their metadata). */
  failed: z.number().int().nonnegative(),
});

/** State of the background scan and index of the active library. */
export const scanStatusSchema = z.object({
  libraryId: itemIdSchema.nullable(),
  state: scanStateSchema,
  phase: scanPhaseSchema.optional(),
  /** Files seen by the walker (while walking/hashing). */
  seen: z.number().int().nonnegative().default(0),
  /** Work items of the current phase when known (files to extract, documents to index). */
  total: z.number().int().nonnegative().optional(),
  /** Work items of the current phase already done. */
  processed: z.number().int().nonnegative().default(0),
  /** Documents in the search index right now. */
  indexed: z.number().int().nonnegative().default(0),
  summary: scanSummarySchema.optional(),
  startedAt: isoDateSchema.optional(),
  finishedAt: isoDateSchema.optional(),
  error: serializedErrorSchema.optional(),
});
export type ScanStatus = z.infer<typeof scanStatusSchema>;
export type ScanSummary = z.infer<typeof scanSummarySchema>;

/** Both are optional: the scan always runs on the active library; a different id is refused (LIBRARY_NOT_ACTIVE). */
const target = z.object({ libraryId: itemIdSchema.optional() });

export const scanChannels = defineChannels('scan', {
  /**
   * Starts an incremental scan (walk, hash changed files, extract text, update the index) in the
   * background. Already running: returns the current status. `full` re-extracts every text.
   */
  start: { request: target.extend({ full: z.boolean().optional() }), response: scanStatusSchema },
  cancel: { request: target, response: scanStatusSchema },
  status: { request: target, response: scanStatusSchema },
});

export const scanEvents = defineEvents('scan', {
  progress: scanStatusSchema,
});
