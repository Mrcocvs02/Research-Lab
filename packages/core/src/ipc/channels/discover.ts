import { z } from 'zod';
import { documentIdSchema, isoDateSchema, itemIdSchema } from '../../common.js';
import { defineChannels } from '../registry.js';

/** Candidates kept per search (the file stays small), documents a search may start from, and the longest question. */
export const DISCOVER_LIMITS = { candidates: 100, seeds: 30, queryChars: 300 } as const;
/** The choices of "✦ Sintesi" (D-419). */
export const DISCOVER_SUMMARY_CHOICES = [10, 20, 50] as const;

export const discoverKindSchema = z.enum(['extend', 'question', 'bridge']);
export type DiscoverKind = z.infer<typeof discoverKindSchema>;

/** Why a candidate is shown: a code and counts, written in the language of the interface by the renderer. */
export const discoverReasonSchema = z.object({
  code: z.enum(['cited-by-owned', 'cites-owned', 'cites-both', 'cited-by-both', 'path', 'search']),
  n: z.number().int().nonnegative(),
  of: z.number().int().nonnegative().optional(),
});
export type DiscoverReason = z.infer<typeof discoverReasonSchema>;

export const discoverSummarySchema = z.object({ problem: z.string(), method: z.string(), results: z.string(), data: z.string(), limits: z.string() });
export type DiscoverSummary = z.infer<typeof discoverSummarySchema>;

export const discoverCandidateSchema = z.object({
  /** The OpenAlex work id (`W123`). */
  key: z.string().regex(/^W\d{1,15}$/),
  title: z.string().nullable(),
  authors: z.array(z.string()).max(6),
  year: z.number().int().nullable(),
  venue: z.string().nullable(),
  doi: z.string().nullable(),
  arxivId: z.string().nullable(),
  /** 0 to 1: how well the candidate fits (a number, or dots for a bridge). */
  score: z.number().min(0).max(1),
  reasons: z.array(discoverReasonSchema).max(6),
  state: z.enum(['new', 'later', 'dismissed', 'imported']),
  /** A bridge below the bibliometric threshold: hidden behind "Mostra i candidati deboli". */
  weak: z.boolean(),
  /** Old and enormously cited: hidden unless "Includi classici" is on (D-492). */
  classic: z.boolean().optional(),
  /** Not in the previous run of the same search ("nuovi" badge). */
  fresh: z.boolean(),
  summary: discoverSummarySchema.nullable(),
});
export type DiscoverCandidate = z.infer<typeof discoverCandidateSchema>;

/** `ok`: candidates; the others are the states of §17.4.17 (D-420). */
export const discoverOutcomeSchema = z.enum(['ok', 'no-candidates', 'no-bridge', 'missing-id', 'offline']);
export type DiscoverOutcome = z.infer<typeof discoverOutcomeSchema>;

const docRefSchema = z.object({ docId: documentIdSchema, title: z.string() });

export const discoverRunSummarySchema = z.object({
  id: itemIdSchema,
  kind: discoverKindSchema,
  /** The question, or the name of the project or documents the search started from. */
  title: z.string(),
  createdAt: isoDateSchema,
  outcome: discoverOutcomeSchema,
  candidates: z.number().int().nonnegative(),
  fresh: z.number().int().nonnegative(),
});
export type DiscoverRunSummary = z.infer<typeof discoverRunSummarySchema>;

export const discoverRunSchema = discoverRunSummarySchema.extend({
  /** Bridge: the two sides, by the documents (titles at the time of the search). */
  sides: z.array(z.array(docRefSchema)).max(2),
  /** Documents whose OpenAlex identifier could not be found (no DOI, arXiv id or stored id). */
  missing: z.array(docRefSchema),
  /** Question: library documents that match, found without any network. */
  local: z.array(docRefSchema),
  seedCount: z.number().int().nonnegative(),
  items: z.array(discoverCandidateSchema).max(DISCOVER_LIMITS.candidates),
  /** The model that wrote the last "✦ Sintesi", if any. */
  summarizedWith: z.string().nullable(),
  /** The project an "extend" search started from (its PRISMA counts, D-439). */
  projectId: itemIdSchema.optional(),
});
export type DiscoverRun = z.infer<typeof discoverRunSchema>;

const groupSchema = z.object({ docIds: z.array(documentIdSchema).max(DISCOVER_LIMITS.seeds).default([]), projectId: itemIdSchema.optional() });
const token = z.string().min(1).max(64);
const runId = z.object({ id: itemIdSchema });
const count = z.union([z.literal(10), z.literal(20), z.literal(50)]);
const model = z.string().min(1).max(100).optional();

export const discoverChannels = defineChannels('discover', {
  list: { request: z.object({}), response: z.object({ items: z.array(discoverRunSummarySchema) }) },
  get: { request: runId, response: z.object({ run: discoverRunSchema }) },
  /**
   * Starts a search and answers when it is done. No Claude and no download: only OpenAlex (and the local index for a question).
   * `token` lets `discover:cancel` stop it.
   */
  start: {
    request: z.object({ token, kind: discoverKindSchema, query: z.string().trim().max(DISCOVER_LIMITS.queryChars).optional(), a: groupSchema.optional(), b: groupSchema.optional() }),
    response: z.object({ run: discoverRunSchema }),
  },
  /** The same search again; the candidates not seen before are marked `fresh`. */
  rerun: { request: z.object({ token, id: itemIdSchema }), response: z.object({ run: discoverRunSchema }) },
  cancel: { request: z.object({ token }), response: z.object({ ok: z.literal(true) }) },
  mark: { request: z.object({ id: itemIdSchema, key: z.string().max(20), state: z.enum(['new', 'later', 'dismissed', 'imported']), /** Why a candidate was rejected (a code of the short list, or free text): kept for the PRISMA diagram. */ reason: z.string().trim().max(200).optional() }), response: z.object({ ok: z.literal(true) }) },
  remove: { request: runId, response: z.object({ removed: z.boolean() }) },
  /** Searches older than `days` (90): `dryRun` only counts them, so the dialog can say how many. */
  prune: { request: z.object({ days: z.number().int().min(1).max(3650).default(90), dryRun: z.boolean().default(false) }), response: z.object({ count: z.number().int().nonnegative() }) },
  /** What "✦ Sintesi" for the best N would send and cost (same shape as `explain:estimate`, D-416). Only public abstracts go. */
  estimate: {
    request: z.object({ id: itemIdSchema, count, model }),
    response: z.object({
      model: z.string(),
      approxTokens: z.number().int().nonnegative(),
      estimatedUsd: z.number().nonnegative().nullable(),
      cached: z.boolean(),
      folderEnabled: z.boolean(),
      firstFolderSend: z.boolean(),
      thresholdTokens: z.number().int().positive(),
      needsDialog: z.boolean(),
      todayTokens: z.number().int().nonnegative(),
      dailyCap: z.number().int().positive().nullable(),
      overDailyCap: z.boolean(),
      todayPct: z.number().int().nonnegative().nullable(),
      /** Candidates still to write (the rest are in the cache) and requests of at most 10 abstracts. */
      toWrite: z.number().int().nonnegative(),
      requests: z.number().int().nonnegative(),
    }),
  },
  /** Writes the structured summary of the best N from their public abstracts (Haiku, blocks of 10, cached by abstract). */
  summarize: {
    request: z.object({ token, id: itemIdSchema, count, model, confirmed: z.boolean().default(false) }),
    response: z.object({ run: discoverRunSchema, written: z.number().int().nonnegative(), cached: z.number().int().nonnegative(), noAbstract: z.number().int().nonnegative() }),
  },
});
