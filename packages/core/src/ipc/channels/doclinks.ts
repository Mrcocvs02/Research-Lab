import { z } from 'zod';
import { documentIdSchema, itemIdSchema, relativePathSchema } from '../../common.js';
import { defineChannels } from '../registry.js';

/** Why two documents are linked: `{ terms, cites: 'to'|'from'|'both', shared, tags, authors }` (checked by the lazy `doclinks` chunk). */
const reasons = z.record(z.string(), z.unknown());
/** Responses are built by the lazy chunk (`features/doclinks`), which holds the strict schemas of the stored file. */
const items = z.array(z.any());

/**
 * Links between documents found locally (D-479, D-480, §18.2): the signals the Map already has, a normal threshold and a
 * rule of evidence; nothing is forced and no AI is used. A removed link is remembered so that a new search does not bring it back.
 */
export const doclinksChannels = defineChannels('doclinks', {
  find: {
    request: z.object({
      sourceId: documentIdSchema,
      targets: z.union([
        z.object({ docIds: z.array(documentIdSchema).min(1).max(5000) }),
        z.object({ projectId: z.string().max(100) }),
        z.object({ folder: relativePathSchema }),
        z.object({ tagId: itemIdSchema }),
        z.object({ all: z.literal(true) }),
      ]),
      strictness: z.enum(['strict', 'normal', 'wide']).default('normal'),
    }),
    response: z.object({ runId: z.string(), threshold: z.number(), added: items, below: items, scanned: z.number(), skipped: z.object({ dismissed: z.number(), existing: z.number() }) }),
  },
  list: { request: z.object({ docId: documentIdSchema }), response: z.object({ items }) },
  /** `forget` (undo of a search) does not remember the pairs as dismissed. */
  remove: { request: z.object({ ids: z.array(z.string().max(40)).min(1).max(5000), forget: z.boolean().optional() }), response: z.object({ removed: z.number() }) },
  add: { request: z.object({ a: documentIdSchema, b: documentIdSchema, weight: z.number().min(0).max(1).default(0.5), reasons: reasons.default({}) }), response: z.object({ id: z.string(), created: z.boolean() }) },
});
