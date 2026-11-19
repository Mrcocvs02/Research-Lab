import { z } from 'zod';
import { documentIdSchema, isoDateSchema, itemIdSchema } from '../../common.js';
import { defineChannels } from '../registry.js';
import { LITERATURE_KEYS } from './literature.js';

/** Comparison table (16): papers, columns, characters of a cell, papers per request (D-404) and of the title. */
export const COMPARE_LIMITS = { docs: 30, columns: 10, name: 60, cell: 600, title: 120, perRequest: 10 } as const;
/** Research-group overview (12): most papers one overview covers. */
export const GROUPS_LIMITS = { docs: 30 } as const;

export const compareColumnSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  name: z.string().trim().min(1).max(COMPARE_LIMITS.name),
  /** The literature-note section the column reads from; `null`: a column the user named (always written by Claude). */
  key: z.enum(LITERATURE_KEYS).nullable(),
});
export type CompareColumn = z.infer<typeof compareColumnSchema>;

/**
 * One cell. `source`: read from the literature note (nothing sent), written by Claude (✦), typed by the user (no ✦), or `none`
 * ("not found in the text" or the folder may not be sent: `why`). Pages are the pages of the paper the text comes from.
 */
export const compareCellSchema = z.object({
  text: z.string().max(COMPARE_LIMITS.cell),
  pages: z.array(z.number().int().positive()).max(8),
  source: z.enum(['note', 'claude', 'user', 'none']),
  ai: z.boolean(),
  why: z.enum(['not-found', 'not-enabled']).optional(),
});
export type CompareCell = z.infer<typeof compareCellSchema>;

export const compareRowSchema = z.object({ docId: documentIdSchema, label: z.string().max(200), cells: z.record(z.string(), compareCellSchema) });
export type CompareRow = z.infer<typeof compareRowSchema>;

export const compareTableSchema = z.object({
  id: itemIdSchema,
  projectId: itemIdSchema,
  title: z.string().trim().min(1).max(COMPARE_LIMITS.title),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  columns: z.array(compareColumnSchema).min(1).max(COMPARE_LIMITS.columns),
  rows: z.array(compareRowSchema).min(1).max(COMPARE_LIMITS.docs),
});
export type CompareTable = z.infer<typeof compareTableSchema>;

const model = z.string().min(1).max(100).optional();
const docIds = z.array(documentIdSchema).min(1).max(COMPARE_LIMITS.docs);
const columns = z.array(compareColumnSchema).min(1).max(COMPARE_LIMITS.columns);
const existing = z.array(compareRowSchema).max(COMPARE_LIMITS.docs).optional();

/** Same figures as `literature:estimate` and `explain:estimate` (D-416) so the one cost component serves every Claude function. */
const costShape = {
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
};

export const compareChannels = defineChannels('compare', {
  /**
   * What filling the table would do: cells (papers x columns) already in the table or readable from the literature notes (nothing
   * sent), cells to write, and the requests that takes (up to ten papers per column per request). Reads text on this machine only.
   */
  estimate: {
    request: z.object({ docIds, columns, existing, model }),
    response: z.object({
      ...costShape,
      cells: z.object({ total: z.number().int().nonnegative(), ready: z.number().int().nonnegative(), fromNotes: z.number().int().nonnegative(), toWrite: z.number().int().nonnegative(), notEnabled: z.number().int().nonnegative() }),
      requests: z.number().int().nonnegative(),
    }),
  },
  /**
   * Fills the table: the cells of the literature notes are reused without any send; the missing ones are written by Claude, one
   * request per column and block of papers, only for papers of enabled folders, cached by text + model + prompt version.
   * Cells in `existing` are kept as they are. Nothing is saved here.
   */
  run: {
    request: z.object({ token: z.string().min(1).max(100), docIds, columns, existing, model, confirmed: z.boolean().default(false) }),
    response: z.object({ rows: z.array(compareRowSchema), fromNotes: z.number().int().nonnegative(), written: z.number().int().nonnegative(), requests: z.number().int().nonnegative() }),
  },
  cancel: { request: z.object({ token: z.string().min(1).max(100) }), response: z.object({ ok: z.literal(true) }) },
  /** Saves the table in the project as `projects/<id>/tables/<table>.md` (created when `id` is missing). */
  save: {
    request: z.object({ id: itemIdSchema.optional(), projectId: itemIdSchema, title: compareTableSchema.shape.title, columns, rows: z.array(compareRowSchema).min(1).max(COMPARE_LIMITS.docs) }),
    response: z.object({ table: compareTableSchema }),
  },
  get: { request: z.object({ projectId: itemIdSchema, id: itemIdSchema }), response: z.object({ table: compareTableSchema }) },
  list: {
    request: z.object({ projectId: itemIdSchema }),
    response: z.object({ items: z.array(z.object({ id: itemIdSchema, title: z.string(), updatedAt: isoDateSchema, docs: z.number().int().nonnegative(), columns: z.number().int().nonnegative() })) }),
  },
  remove: { request: z.object({ projectId: itemIdSchema, id: itemIdSchema }), response: z.object({ removed: z.boolean() }) },
  /** The only place a CSV is written: the folder the user picks. `path` is `null` when the picker was cancelled. */
  exportCsv: { request: z.object({ projectId: itemIdSchema, id: itemIdSchema }), response: z.object({ path: z.string().nullable() }) },
});

export const groupsOverviewSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{16}$/),
  markdown: z.string(),
  updatedAt: isoDateSchema,
  /** `written`: the themes were written by Claude (✦); `not-written`: only the data (Claude not asked, not available or no folder enabled). */
  synthesis: z.enum(['written', 'not-written']),
  /** Authors whose data is incomplete (only the names in the library are known). */
  incomplete: z.array(z.string().max(200)).max(200),
  docs: z.number().int().nonnegative(),
});
export type GroupsOverview = z.infer<typeof groupsOverviewSchema>;

export const groupsChannels = defineChannels('groups', {
  /** What the theme synthesis would send and cost (about 3 000 tokens, Haiku), from the metadata of papers in enabled folders only. */
  estimate: { request: z.object({ docIds: z.array(documentIdSchema).min(1).max(GROUPS_LIMITS.docs), model }), response: z.object({ ...costShape, docs: z.number().int().nonnegative(), notEnabled: z.number().int().nonnegative() }) },
  /** The saved overview of this set of papers (`notes/groups/<id>.md`), or `null`. */
  get: { request: z.object({ docIds: z.array(documentIdSchema).min(1).max(GROUPS_LIMITS.docs) }), response: z.object({ overview: groupsOverviewSchema.nullable() }) },
  /** Writes the overview: the data on this machine, the themes by Claude when `withClaude` (one request); saved either way. */
  run: {
    request: z.object({ token: z.string().min(1).max(100), docIds: z.array(documentIdSchema).min(1).max(GROUPS_LIMITS.docs), model, withClaude: z.boolean().default(true), confirmed: z.boolean().default(false) }),
    response: z.object({ overview: groupsOverviewSchema }),
  },
});

/** Context of the citations (11): the sentences in which the citing papers of the library cite this document. */
export const CITECTX_LIMITS = { works: 200, sentences: 3, sentenceChars: 400 } as const;
export const citectxChannels = defineChannels('citectx', {
  /** From the text of the citing papers that are in the library (this machine only, no network, no Claude); cached, rebuilt on `refresh`. */
  get: {
    request: z.object({ docId: documentIdSchema, refresh: z.boolean().default(false) }),
    response: z.object({
      items: z.array(z.object({ docId: documentIdSchema, sentences: z.array(z.object({ page: z.number().int().positive(), text: z.string().max(CITECTX_LIMITS.sentenceChars) })).max(CITECTX_LIMITS.sentences) })).max(CITECTX_LIMITS.works),
      computedAt: isoDateSchema.nullable(),
    }),
  },
});
