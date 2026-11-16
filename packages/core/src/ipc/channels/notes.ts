import { z } from 'zod';
import { documentIdSchema, isoDateSchema } from '../../common.js';
import { STUDY_LIMITS } from '../../limits.js';
import { defineChannels } from '../registry.js';

const pageSchema = z.number().int().positive().max(STUDY_LIMITS.pageMax);

/** A note of the user: on the whole file (no `page`) or on one page. Never written by the AI. */
export const noteViewSchema = z.object({
  docId: documentIdSchema,
  page: pageSchema.optional(),
  /** Markdown, without the frontmatter block. */
  body: z.string(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type NoteView = z.infer<typeof noteViewSchema>;

export const noteListItemSchema = z.object({
  /** `null` for the note of the whole file. */
  page: pageSchema.nullable(),
  updatedAt: isoDateSchema,
  /** First characters of the body, as plain text. */
  excerpt: z.string().max(STUDY_LIMITS.excerpt),
});

export const notesChannels = defineChannels('notes', {
  /** The note on a whole file (no `page`) or on one page; `null` when there is none. */
  get: {
    request: z.object({ docId: documentIdSchema, page: pageSchema.optional() }),
    response: z.object({ note: noteViewSchema.nullable() }),
  },
  /** Every note of a document: the file note first (page `null`), then the page notes by page. */
  list: {
    request: z.object({ docId: documentIdSchema }),
    response: z.object({ items: z.array(noteListItemSchema) }),
  },
  /**
   * Writes a note. `expectedUpdatedAt` is the `updatedAt` the editor started from (`null`: there was no note); when the
   * note on disk differs (another window or computer changed it) the answer is CONFLICT and nothing is written.
   * A blank body removes the note. The document is re-indexed, so the note is found by the search.
   * Emits `library:changed` with kind `notes`.
   */
  save: {
    request: z.object({
      docId: documentIdSchema,
      page: pageSchema.optional(),
      body: z.string().max(STUDY_LIMITS.noteBody),
      expectedUpdatedAt: isoDateSchema.nullable(),
    }),
    response: z.object({ note: noteViewSchema.nullable() }),
  },
});
