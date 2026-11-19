import { z } from 'zod';
import { documentIdSchema } from '../../common.js';
import { defineChannels } from '../registry.js';

/** Largest list of references and of guide passages one paper can give (the files are rebuildable, never trusted). */
export const REFS_LIMITS = { entries: 600, text: 600, passages: 12, reason: 300, quote: 240 } as const;

const entrySchema = z.object({
  /** The number in the bibliography (`[12]`), or the position of an author-year entry. */
  n: z.number().int().positive(),
  /** The raw bibliography text of the entry. */
  text: z.string().max(REFS_LIMITS.text),
  /** First author surname and year, read from the text: how an author-year mention is matched. */
  surname: z.string().max(80).nullable(),
  year: z.number().int().nullable(),
  /** The work as OpenAlex (already in the local cache) knows it, when an entry could be matched. */
  work: z
    .object({ title: z.string().nullable(), authors: z.array(z.string()), year: z.number().int().nullable(), venue: z.string().nullable(), doi: z.string().nullable(), arxivId: z.string().nullable() })
    .nullable(),
  /** The library document the work is, if owned. */
  docId: documentIdSchema.nullable(),
});
export type RefEntry = z.infer<typeof entrySchema>;

const passageSchema = z.object({
  id: z.string().max(40),
  kind: z.enum(['C', 'M', 'R', 'L']),
  page: z.number().int().positive(),
  /** A verbatim sentence of the page (the mark sits at its line); `null` for a passage read from the literature note. */
  quote: z.string().max(REFS_LIMITS.quote).nullable(),
  reason: z.string().max(REFS_LIMITS.reason),
});
export type GuidePassage = z.infer<typeof passageSchema>;

export const refsChannels = defineChannels('refs', {
  /** The references of a paper, read from its extracted text (no network, no Claude) and matched to the cached citations. */
  get: { request: z.object({ docId: documentIdSchema }), response: z.object({ found: z.boolean(), items: z.array(entrySchema).max(REFS_LIMITS.entries) }) },
});

export const guidesChannels = defineChannels('guides', {
  /**
   * The guide of a paper, without sending anything: the cache (`guides/<docId>.json`), else read from the literature note.
   * `none`: not prepared (`approxTokens` is what preparing would send); `disabled`: the folder is not enabled for sending.
   */
  get: {
    request: z.object({ docId: documentIdSchema }),
    response: z.object({ state: z.enum(['ready', 'none', 'disabled']), source: z.enum(['cache', 'note']).nullable(), passages: z.array(passageSchema).max(REFS_LIMITS.passages), approxTokens: z.number().int().nonnegative() }),
  },
  /** Prepares the guide: one request to the small model, only on the user's confirmation (`needs-confirmation` otherwise). */
  prepare: { request: z.object({ docId: documentIdSchema, confirmed: z.boolean().default(false) }), response: z.object({ passages: z.array(passageSchema).max(REFS_LIMITS.passages) }) },
});
