import { z } from 'zod';
import { documentIdSchema, isoDateSchema, itemIdSchema } from '../../common.js';
import { defineChannels } from '../registry.js';

/** Most papers one send may carry (D-418): a longer selection is offered five by five. */
export const LITERATURE_MAX_DOCS = 5;

/** The keys the AI fills in a literature note (the figures are not among them: they are extracted, not written). */
export const LITERATURE_KEYS = ['problem', 'contribution', 'method', 'results', 'data', 'limits'] as const;
export type LiteratureKey = (typeof LITERATURE_KEYS)[number];

/** Largest template body and number of templates (a list of `.md` files in the data folder). */
export const TEMPLATE_LIMITS = { body: 20_000, name: 80, count: 50 } as const;

const noteMetaSchema = z.object({
  body: z.string(),
  /** `proposed`: the AI draft waits for the user ("Bozza ✦ da approvare"); `approved`: reviewed. */
  review: z.enum(['proposed', 'approved']),
  /** Written by the AI (`false`: the local skeleton made from the title and the abstract). */
  ai: z.boolean(),
  model: z.string().nullable(),
  generatedAt: isoDateSchema.nullable(),
  /** Made only from the title and the abstract (the folder is not enabled for sending text). */
  abstractOnly: z.boolean(),
});
export type LiteratureNote = z.infer<typeof noteMetaSchema>;

const templateSchema = z.object({ id: z.string(), name: z.string(), body: z.string(), builtin: z.boolean() });
const linkRefSchema = z.object({ kind: z.enum(['doc', 'project']), id: z.string().min(1).max(128), title: z.string() });

export const literatureChannels = {
  ...defineChannels('literature', {
    /** The literature note of a document, or `null`; `folderEnabled`: its text may be sent to the AI. */
    get: { request: z.object({ docId: documentIdSchema }), response: z.object({ note: noteMetaSchema.nullable(), folderEnabled: z.boolean() }) },
    /** What writing the notes of up to five papers would send and cost (same shape as `explain:estimate`, D-416). */
    estimate: {
      request: z.object({ docIds: z.array(documentIdSchema).min(1).max(LITERATURE_MAX_DOCS), model: z.string().min(1).max(100).optional() }),
      response: z.object({
        model: z.string(),
        approxTokens: z.number().int().nonnegative(),
        estimatedUsd: z.number().nonnegative().nullable(),
        cached: z.boolean(),
        /** At least one paper is in an enabled folder (otherwise nothing is sent). */
        folderEnabled: z.boolean(),
        firstFolderSend: z.boolean(),
        thresholdTokens: z.number().int().positive(),
        needsDialog: z.boolean(),
        todayTokens: z.number().int().nonnegative(),
        dailyCap: z.number().int().positive().nullable(),
        overDailyCap: z.boolean(),
        todayPct: z.number().int().nonnegative().nullable(),
        /** Papers sent, papers answered from the cache, papers written only from title and abstract (nothing sent). */
        sent: z.number().int().nonnegative(),
        cachedDocs: z.number().int().nonnegative(),
        abstractOnly: z.number().int().nonnegative(),
      }),
    },
    /**
     * Writes the note of ONE paper (the caller queues them, one by one). An enabled folder: one request, logged and cached by
     * hash + model + prompt version; the draft is `proposed`. Another folder: no request at all, a poor note from the title
     * and the abstract. Never overwrites a note the user approved unless `regenerate`.
     */
    run: {
      request: z.object({ docId: documentIdSchema, model: z.string().min(1).max(100).optional(), confirmed: z.boolean().default(false), regenerate: z.boolean().default(false) }),
      response: z.object({ note: noteMetaSchema, cached: z.boolean() }),
    },
    /** The user approved the draft: the note is no longer a proposal. */
    approve: { request: z.object({ docId: documentIdSchema }), response: z.object({ ok: z.literal(true) }) },
    /** Deletes the literature note (the user's own notes are never touched). */
    discard: { request: z.object({ docId: documentIdSchema }), response: z.object({ removed: z.boolean() }) },
  }),
  ...defineChannels('templates', {
    /** The note templates: `templates/*.md` of the data folder, and the built-in "Letteratura" unless a file replaces it. */
    list: { request: z.object({}), response: z.object({ items: z.array(templateSchema) }) },
    /** Creates (no `id`) or replaces a template; the id is the file name, made from the name. */
    save: {
      request: z.object({ id: z.string().min(1).max(100).optional(), name: z.string().trim().min(1).max(TEMPLATE_LIMITS.name), body: z.string().max(TEMPLATE_LIMITS.body) }),
      response: z.object({ item: templateSchema }),
    },
    remove: { request: z.object({ id: z.string().min(1).max(100) }), response: z.object({ removed: z.boolean() }) },
    /** The template with its placeholders filled for a document (`{{titolo}}`, `{{autori}}`, `{{anno}}`, `{{evidenziazioni}}`). */
    apply: { request: z.object({ id: z.string().min(1).max(100), docId: documentIdSchema }), response: z.object({ text: z.string() }) },
  }),
  ...defineChannels('links', {
    /** Notes that point to this document with `[[Title|lab://doc/<id>]]` (the document's own notes excluded). */
    incoming: {
      request: z.object({ docId: documentIdSchema }),
      response: z.object({ items: z.array(z.object({ docId: documentIdSchema, page: z.number().int().positive().nullable(), title: z.string() })) }),
    },
    /** Current titles of documents and projects, so a renamed target shows its new name. */
    titles: {
      request: z.object({ docIds: z.array(documentIdSchema).max(100), projectIds: z.array(itemIdSchema).max(100) }),
      response: z.object({ docs: z.record(z.string(), z.string()), projects: z.record(z.string(), z.string()) }),
    },
    /** Completion of `[[`: documents and projects whose name matches. */
    suggest: { request: z.object({ query: z.string().max(200) }), response: z.object({ items: z.array(linkRefSchema).max(12) }) },
  }),
};
