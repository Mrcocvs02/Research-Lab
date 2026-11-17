import { z } from 'zod';
import { documentIdSchema, isoDateSchema, itemIdSchema, relativePathSchema } from '../../common.js';
import { defineChannels, defineEvents } from '../registry.js';

/** Upper bounds of the second-brain export (plan §6). */
export const EXPORT_LIMITS = {
  /** Documents in one export, cited works included. */
  documents: 5000,
  /** `INDEX.md` stays under this many tokens (plan §6). */
  indexTokens: 3000,
  folderName: 120,
  selectionItems: 500,
  clusters: 100,
  /** Copies into `sources/` above this many bytes need the user's confirmation (D-253). */
  copyConfirmBytes: 1024 ** 3,
} as const;

/**
 * What to export: the union of a project, folders, tags, clusters and single documents (at least one), plus the
 * options of an export preset. Documents in excluded folders never enter an export.
 */
export const exportSelectionSchema = z
  .object({
    projectId: z.string().max(100).optional(),
    folders: z.array(relativePathSchema).max(EXPORT_LIMITS.selectionItems).default([]),
    tagIds: z.array(itemIdSchema).max(EXPORT_LIMITS.selectionItems).default([]),
    /** Cluster ids of the graph model (phase 6); NOT_FOUND ('no-model') when the model was never built. */
    clusterIds: z.array(z.string().max(100)).max(EXPORT_LIMITS.clusters).default([]),
    docIds: z.array(documentIdSchema).max(EXPORT_LIMITS.documents).default([]),
    /** Also export the library documents the selection cites, up to `citedDepth` steps. */
    includeCited: z.boolean().default(false),
    citedDepth: z.number().int().min(0).max(3).default(1),
    /**
     * `sources/`: nothing (the default), a list of the original absolute paths (an explicit choice: they name the user's
     * folders), or copies of the files (originals are only read; above `EXPORT_LIMITS.copyConfirmBytes` it asks first).
     */
    sources: z.enum(['none', 'paths', 'copies']).default('none'),
    includeNotes: z.boolean().default(true),
    includeAnnotations: z.boolean().default(true),
  })
  .refine((s) => s.projectId !== undefined || s.folders.length + s.tagIds.length + s.clusterIds.length + s.docIds.length > 0, {
    message: 'Select a project, folders, tags, clusters or documents',
  });
export type ExportSelection = z.infer<typeof exportSelectionSchema>;

/**
 * Where to write: `destination` is a folder the user picked with `dialog:chooseFolder` (purpose `export-destination`,
 * exact match, D-017); the export goes into `<destination>/<folderName>` (created when missing). A folder that is not
 * empty and has no export manifest of this library is refused (CONFLICT `not-empty`; `other-library` when the manifest
 * belongs to another library): an export never overwrites files it did not write. A destination inside the library
 * root is refused too (CONFLICT `inside-library`, links and case differences resolved first, D-252).
 */
export const exportTargetSchema = z.object({
  destination: z.string().min(1).max(1024),
  folderName: z
    .string()
    .trim()
    .min(1)
    .max(EXPORT_LIMITS.folderName)
    .refine((n) => !/[<>:"/\\|?*\u0000-\u001f]/.test(n) && n !== '.' && n !== '..' && !/[. ]$/.test(n), 'Not a valid folder name'),
});

export const exportEstimateSchema = z.object({
  /** Documents selected directly and added as cited works. */
  documents: z.number().int().nonnegative(),
  citedAdded: z.number().int().nonnegative(),
  /** Files the export would write (cards, concepts, index, guide, commands, graph, sources). */
  files: z.number().int().nonnegative(),
  /** Rough size of the Markdown for an agent (characters / 4). */
  approxTokens: z.number().int().nonnegative(),
  indexTokens: z.number().int().nonnegative(),
  /** Bytes copied into `sources/` when `sources` is `copies`. */
  copyBytes: z.number().int().nonnegative(),
  /** Selected documents in folders NOT enabled for the AI: exporting them needs `confirmed` (they become readable by any agent opening the folder). */
  aiDisabledDocuments: z.number().int().nonnegative(),
  /** Documents whose file is missing on disk (cards are written, copies are not). */
  missingFiles: z.number().int().nonnegative(),
  /** What the target already holds, when a target was given. */
  target: z
    .object({
      state: z.enum(['new', 'empty', 'previous-export', 'not-empty', 'other-library']),
      previousExportAt: isoDateSchema.nullable(),
      /** Generated sections the user edited by hand since the last export: they are kept, never overwritten. */
      editedFiles: z.number().int().nonnegative(),
    })
    .nullable(),
});

export const exportResultSchema = z.object({
  dir: z.string(),
  written: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  /** Files whose generated section was edited by hand: left as they are (listed relative to `dir`). */
  keptEdited: z.array(z.string()).max(1000),
  /** Copies into `sources/` that failed (listed relative to `dir`, at most 200): the next export tries them again. */
  copyErrors: z.array(z.string()).max(200),
  /** Cards of documents no longer in the selection: never deleted, listed in `INDEX.md` as no longer exported. */
  orphaned: z.number().int().nonnegative(),
  copiedBytes: z.number().int().nonnegative(),
});

export const exportJobStatusSchema = z.object({
  jobId: z.string().max(100),
  state: z.enum(['running', 'done', 'cancelled', 'failed']),
  phase: z.enum(['collect', 'write', 'copy', 'done']),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  result: exportResultSchema.nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});

/**
 * Second-brain export (plan §6): a folder of linked Markdown for Claude Code — `CLAUDE.md` (how to navigate and how to
 * answer), `INDEX.md` (themes, clusters, reading order, state; under 3000 tokens), `papers/<citekey>.md` (frontmatter,
 * summary marked when AI-generated, the user's notes, highlights with pages, "cites" / "cited by" as `[[citekey]]`
 * links with present and missing works), `concepts/<topic>.md` (micro-topics or clusters), `notes/` (the user's free
 * notes, never touched by later exports), `graph.json`, `sources/`, `.claude/commands/`. Generated parts sit between
 * markers; a new export rewrites only those parts and only when they changed, keeps anything written by hand, and
 * keeps citekeys stable through a manifest in the export folder. Local only: no network, no AI.
 */
export const exportChannels = defineChannels('export', {
  /** Counts and sizes before writing; with a target, also what the target already holds. */
  preview: {
    request: z.object({ selection: exportSelectionSchema, target: exportTargetSchema.optional() }),
    response: exportEstimateSchema,
  },
  /**
   * Starts the export (progress through `export:progress`). CONFLICT `needs-confirmation` when the selection has
   * documents of folders not enabled for the AI, or `sources` is `copies` above `EXPORT_LIMITS.copyConfirmBytes`, and
   * `confirmed` is false (details: `documents`, `copyBytes`; reason `large-copy` when only the size asks);
   * `not-empty` / `other-library` / `inside-library` as above; INVALID_REQUEST with reason `destination-not-approved`
   * or `too-many` (over `EXPORT_LIMITS.documents`).
   */
  run: {
    request: z.object({ selection: exportSelectionSchema, target: exportTargetSchema, confirmed: z.boolean().default(false) }),
    response: z.object({ jobId: z.string() }),
  },
  status: { request: z.object({ jobId: z.string().max(100) }), response: exportJobStatusSchema },
  /** Stops after the file being written; files already written stay (the next export completes them). */
  cancel: { request: z.object({ jobId: z.string().max(100) }), response: z.object({ cancelled: z.boolean() }) },
  /** Opens a finished export folder in the file manager (only folders written by an export of this session). */
  reveal: { request: z.object({ jobId: z.string().max(100) }), response: z.object({ ok: z.literal(true) }) },
});

export const exportEvents = defineEvents('export', {
  progress: exportJobStatusSchema,
});
