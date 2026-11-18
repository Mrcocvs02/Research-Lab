import { z } from 'zod';
import { documentIdSchema, isoDateSchema, itemIdSchema, relativePathSchema } from '../../common.js';
import { INBOX_LIMITS } from '../../limits.js';
import { aiNewTagSchema, DOCUMENT_LIMITS, publicationStatusSchema } from '../../model/document.js';
import { reasoningLevelSchema } from '../../settings.js';
import { defineChannels, defineEvents } from '../registry.js';
import { aiPreviewSchema } from './ai.js';

const L = DOCUMENT_LIMITS;

/** Bibliographic data: found in the file (heuristics) or in the online record (OpenAlex, arXiv). */
export const inboxMetadataSchema = z.object({
  title: z.string().max(L.title).nullable(),
  authors: z.array(z.string().max(L.author)).max(L.authors),
  year: z.number().int().min(1000).max(3000).nullable(),
  venue: z.string().max(L.venue).nullable(),
  doi: z.string().max(L.identifier).nullable(),
  /** arXiv id with its version when known (e.g. `2401.01234v2`). */
  arxivId: z.string().max(L.identifier).nullable(),
  abstract: z.string().max(INBOX_LIMITS.abstract).nullable(),
  publication: publicationStatusSchema,
});
export type InboxMetadata = z.infer<typeof inboxMetadataSchema>;

/**
 * An item of the inbox. `dropped`: a PDF from outside the library (dropped on the window or chosen with the dialog),
 * not copied yet: main keeps its absolute path in the local app data only (never in the synced data folder) and never
 * modifies, moves or deletes it. `library`: a file of the library the scan found new or changed (`document.inbox`).
 * `id` is the document id the file has or will have (first 16 hex of its SHA-256).
 */
export const inboxItemSchema = z.object({
  id: documentIdSchema,
  kind: z.enum(['dropped', 'library']),
  /** File name (no folder). */
  fileName: z.string().max(260),
  /** Library path (kind `library` only). */
  path: relativePathSchema.optional(),
  size: z.number().int().nonnegative(),
  addedAt: isoDateSchema,
  /** Read from the file's own text and metadata (first pages): DOI, arXiv id, title, authors, year. */
  detected: inboxMetadataSchema.partial(),
  /** Online lookup of the identifiers (OpenAlex for DOIs, arXiv for arXiv ids); `skipped` when there is no identifier. */
  lookup: z.object({
    state: z.enum(['pending', 'found', 'not-found', 'offline', 'error', 'skipped']),
    source: z.enum(['openalex', 'arxiv']).optional(),
    checkedAt: isoDateSchema.optional(),
  }),
  /** The online record, when found. */
  metadata: inboxMetadataSchema.nullable(),
  /**
   * Already in the library: `same-file` (same content: cannot be added again), `same-work` (same DOI or same arXiv id
   * and version), `version` (same arXiv id with another version, or same title and first author with another content).
   */
  duplicate: z
    .object({ kind: z.enum(['same-file', 'same-work', 'version']), docId: documentIdSchema, title: z.string().nullable(), path: relativePathSchema })
    .nullable(),
  /**
   * A copy made by a sync conflict of a PDF we annotated (§8.3.6): its first bytes are `pdfWrite.base` of `docId`.
   * The app never deletes it; the user compares, keeps it as a separate document or ignores it.
   */
  conflictOf: z.object({ docId: documentIdSchema, title: z.string().nullable() }).optional(),
  /**
   * What the app proposes: file name and folder (kind `dropped`; '' is the root of the library), tags of the
   * taxonomy and, from the AI only, new nodes. `tagsFrom`: 'similar' (tags of the most similar documents of the
   * library, no AI), 'ai' (`inbox:proposeTags`), 'none'.
   */
  proposal: z.object({
    name: z.string().max(INBOX_LIMITS.name).optional(),
    folder: relativePathSchema.optional(),
    tagIds: z.array(itemIdSchema).max(100),
    newTags: z.array(aiNewTagSchema).max(20).default([]),
    tagsFrom: z.enum(['similar', 'ai', 'none']),
  }),
});
export type InboxItem = z.infer<typeof inboxItemSchema>;

const addResponse = z.object({
  added: z.array(inboxItemSchema),
  /**
   * Files not added: `not-pdf` (no `%PDF-` header), `too-large`, `not-found` (or not a regular file), `in-library` (a
   * file inside the library root: the scan handles it), `already-queued`, `limit` (the inbox is full).
   */
  refused: z.array(
    z.object({ name: z.string().max(260), reason: z.enum(['not-pdf', 'too-large', 'not-found', 'in-library', 'already-queued', 'limit']) }),
  ),
});

/**
 * The inbox (plan §4 phase 4, §5 use 4): a PDF arrives, the app reads its DOI or arXiv id, fetches the metadata,
 * recognises duplicates and versions, proposes tags, name and folder, and waits for the user's confirmation.
 * Confirming a `dropped` item is the ONLY case in which the app writes outside the data folder (decision of the user,
 * D-217): it creates a NEW file in an existing folder of the library, never overwriting one, never touching the
 * original. Network: only the metadata services, only for identifiers found in the file; nothing of the file goes.
 */
export const inboxChannels = defineChannels('inbox', {
  /**
   * How many items wait (badge of the navigation), without reading a document or touching the network: the dropped
   * items of the local queue plus the number of flagged library files remembered from the last listing or recount.
   * `count` is the badge number (`dropped + library`, capped); the parts feed the tooltip (§7.1).
   * `recount: true` counts the flagged records again (once a scan has finished); lookups never run from here.
   */
  count: {
    request: z.object({ recount: z.boolean().default(false) }),
    response: z.object({ count: z.number().int().nonnegative(), dropped: z.number().int().nonnegative(), library: z.number().int().nonnegative() }),
  },
  list: {
    request: z.object({}),
    response: z.object({ items: z.array(inboxItemSchema).max(INBOX_LIMITS.items) }),
  },
  /**
   * Adds files dropped on the window. `paths` are what the preload's `pathForFile` returned for the dropped files:
   * main checks each one (a local absolute path, never a network or device path starting with two backslashes; the
   * `.pdf` extension; regular file, `%PDF-` header, size) and only reads it.
   */
  add: {
    request: z.object({ paths: z.array(z.string().min(1).max(4096)).min(1).max(INBOX_LIMITS.addBatch) }),
    response: addResponse,
  },
  /** Same as `add`, with PDF files chosen in a dialog shown by main (multiple selection). Empty lists when cancelled. */
  choose: { request: z.object({}), response: addResponse },
  /** Runs the online lookup of an item again (e.g. back online). */
  lookup: { request: z.object({ id: documentIdSchema }), response: inboxItemSchema },
  /**
   * What `proposeTags` would send: the online record (title, authors, abstract) when found, otherwise the first pages
   * of the file. Allowed only when the target folder (the proposed folder for `dropped`, the file's folder for
   * `library`) is enabled for the AI.
   */
  previewTags: {
    request: z.object({ id: documentIdSchema, model: z.string().min(1).max(100), folder: relativePathSchema.optional() }),
    response: aiPreviewSchema,
  },
  /**
   * Asks the AI for tags of the taxonomy (and new nodes when nothing fits): fills `proposal` with `tagsFrom` 'ai'.
   * `folder`: the target folder the user picked, when not the proposed one. Same refusals as `chat:send`
   * (needs-confirmation, AI_BUDGET_EXCEEDED, AI_PROVIDER_ERROR) plus FOLDER_NOT_AI_ENABLED.
   */
  proposeTags: {
    request: z.object({
      id: documentIdSchema,
      model: z.string().min(1).max(100),
      reasoning: reasoningLevelSchema,
      folder: relativePathSchema.optional(),
      confirmed: z.boolean().default(false),
    }),
    response: inboxItemSchema,
  },
  /**
   * Accepts an item with the values the user confirmed. `dropped`: copies the file to `<folder>/<name>` (an existing,
   * not excluded folder; a Windows-safe name ending in `.pdf`; CONFLICT 'exists' if a file is there), checks the copy's
   * hash, indexes it. `library`: no file operation (`name` and `folder` are ignored). Then, for both, applies the
   * metadata as the user's own fields, adds the tags (creating the accepted new nodes), records the AI tag proposal as
   * reviewed when there was one, and clears the inbox flag, as ONE logged change. A `same-file` duplicate is refused
   * (CONFLICT 'duplicate'); `same-work` and `version` need `allowDuplicate`.
   */
  confirm: {
    request: z.object({
      id: documentIdSchema,
      name: z.string().min(1).max(INBOX_LIMITS.name).optional(),
      folder: relativePathSchema.optional(),
      tagIds: z.array(itemIdSchema).max(100).default([]),
      newTags: z.array(aiNewTagSchema).max(20).default([]),
      /** Values to set on the document; an absent key leaves the field as it is. */
      metadata: inboxMetadataSchema.omit({ abstract: true, publication: true }).partial().default({}),
      allowDuplicate: z.boolean().default(false),
    }),
    response: z.object({ docId: documentIdSchema, path: relativePathSchema, changeId: z.string().nullable() }),
  },
  /** Removes an item: `dropped` is forgotten (the original file is untouched); `library` has its inbox flag cleared. */
  dismiss: { request: z.object({ id: documentIdSchema }), response: z.object({ ok: z.literal(true) }) },
});

/** Pushed when items are added, removed, or finish their lookup. */
export const inboxEvents = defineEvents('inbox', {
  changed: z.object({ count: z.number().int().nonnegative() }),
});
