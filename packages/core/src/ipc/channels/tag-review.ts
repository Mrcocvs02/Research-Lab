import { z } from 'zod';
import { itemIdSchema } from '../../common.js';
import { defineChannels } from '../registry.js';
import type { TaxonomyOp } from './taxonomy.js';

/**
 * Vocabulary review and guided cleanup (D-493 .. D-497). The detector and the cleanup rows are built in main, on demand.
 * Responses are typed with plain interfaces (`z.custom`): main builds them, so nothing is parsed twice and the registry,
 * which every start loads, stays small (D-501).
 */
export type TagConfidence = 'sure' | 'likely' | 'maybe';
export type TagAiVerdict = 'same' | 'broader' | 'narrower' | 'related' | 'different';

export interface TagProposal {
  /** Deterministic from the kind and the tags. */
  id: string;
  kind: 'merge' | 'twins' | 'parent' | 'name' | 'metadata';
  tags: string[];
  /** The tag that survives (merge, twins merged) or the parent (kind `parent`). */
  keep?: string;
  /** The label the survivor gets (naming convention applied, or the built "Extended (ACR)"); absent = unchanged. */
  label?: string;
  confidence: TagConfidence;
  /** The rules that fired, comma separated: `form`, `plural`, `alias`, `acronym-in-name`, `acronym-expansion`, `spelling`, `twins`, `inclusion`, `cooccurrence`, `venue`, `status`, `author`, `underscore`, `case`, `long`. */
  reason: string;
  /** Twins: what to do by default. */
  action?: 'merge' | 'keywords';
  /** Metadata: the document field the tag really is. */
  meta?: { field: 'venue' | 'status' | 'author'; value: string };
  evidence: { papers: Record<string, number>; shared: number; jaccard: number };
  /** Answer of the optional AI confirmation, with one line. */
  ai?: { verdict: TagAiVerdict; note: string };
}

export type TagHealthKind = 'singletons' | 'dupes' | 'twins' | 'generic' | 'orphans' | 'multiparent' | 'onevalue' | 'styles' | 'metadata' | 'unused' | 'depth';
export interface TagHealthItem {
  kind: TagHealthKind;
  count: number;
  /** Past the threshold of the health strip; below it the chip is neutral. */
  flagged: boolean;
  /** The tags (documents for `onevalue`) behind the count, at most 200. */
  ids: string[];
}
export interface TagStats {
  tags: number;
  singletons: number;
  dupeConcepts: number;
  orphans: number;
  maxDepth: number;
}

/** One row of a step of the cleanup: ticked by default, with the alternatives (`variants`) it offers. */
export interface TagCleanupRow {
  id: string;
  step: 1 | 2 | 3 | 4 | 5;
  kind: string;
  tags: string[];
  confidence?: TagConfidence;
  checked: boolean;
  /** A placement worth a look. */
  marked?: boolean;
  /** Metadata: some papers keep the tag because their field holds another value. */
  remains?: boolean;
  variant: string;
  /** `default`, or `merge` / `keywords` / `leave` (twins), `pick` / `many` (one-value families), each with its operations. */
  variants: Record<string, { ops: TaxonomyOp[]; docEdits: number }>;
}

/** The state of the run (steps done and their change ids), kept in `<dataDir>/tag-review.json`. */
export interface TagRun {
  startedAt: string | null;
  steps: Array<{ step: number; status: 'applied' | 'skipped' | 'undone'; changeIds: string[]; at: string; tagsBefore?: number; tagsAfter?: number }>;
  before: TagStats | null;
  /** Rows the user dismissed ("Lascia", "No"): they do not come back. */
  dismissed: number;
}

export interface TagAiPlan {
  /** Uncertain pairs that would be asked about. */
  pairs: number;
  /** Why the button is off; absent when it can run. */
  disabled?: 'no-folder' | 'no-pairs';
  model: string;
  /** The exact text that would be sent (names, family paths, counts; never titles or contents). */
  text: string;
  approxInputTokens: number;
  estimatedUsd: number | null;
  needsConfirmation: boolean;
  overCap: boolean;
}

const rowId = z.string().min(1).max(80);
const step = z.number().int().min(1).max(5);
const run = z.custom<TagRun>();

export const tagReviewChannels = defineChannels('tagReview', {
  /** Proposals (review list), health strip and run state; with `step`, the rows of that step of the cleanup. */
  get: {
    request: z.object({ step: step.optional() }),
    response: z.custom<{ revision: number; proposals: TagProposal[]; health: TagHealthItem[]; stats: TagStats; run: TagRun; rows?: TagCleanupRow[] }>(),
  },
  /**
   * Applies proposals (`items`: by id, with the survivor / label / action chosen) or the ticked rows of a cleanup `step`
   * (`rows`), as ONE undoable change. CONFLICT when the proposals changed since they were shown.
   */
  apply: {
    request: z.object({
      items: z.array(z.object({ id: rowId, keep: itemIdSchema.optional(), label: z.string().trim().min(1).max(200).optional(), action: z.enum(['merge', 'keywords']).optional() })).max(2000).optional(),
      step: step.optional(),
      rows: z.array(z.object({ id: rowId, variant: z.string().max(20).optional() })).max(5000).optional(),
      expectedRevision: z.number().int().nonnegative().optional(),
    }),
    response: z.custom<{ changeId: string; changeIds: string[]; applied: number; documentsChanged: number; run: TagRun }>(),
  },
  /** "Not the same": the pairs of the proposals are marked distinct (undoable); other kinds are dismissed in `tag-review.json`. */
  reject: { request: z.object({ ids: z.array(rowId).min(1).max(500) }), response: z.custom<{ changeId: string | null; rejected: number }>() },
  /** "Skip" a step of the run (no change). */
  skip: { request: z.object({ step }), response: run },
  /** What the AI confirmation would send, and its cost (spends and sends nothing). */
  aiPreview: { request: z.object({ model: z.string().optional() }), response: z.custom<TagAiPlan>() },
  /** Sends the previewed text after the user's consent; answers are cached by pair of labels. */
  aiRun: { request: z.object({ model: z.string().optional(), confirmed: z.boolean() }), response: z.custom<{ asked: number; cached: number }>() },
  /** Undo one step of the run (`step`) or all of it, in reverse order. */
  undoRun: { request: z.object({ step: step.optional() }), response: z.custom<{ undone: number; run: TagRun }>() },
});
