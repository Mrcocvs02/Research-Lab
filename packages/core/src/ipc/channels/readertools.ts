import { z } from 'zod';
import { documentIdSchema, isoDateSchema, itemIdSchema } from '../../common.js';
import { defineChannels } from '../registry.js';

/** Largest crop image the main process stores (base64 characters of a 300 KB image, with a margin). */
export const CROP_BASE64_MAX = 420_000;

/** The structured answer of "✦ Spiega" (D-440: a versioned prompt with a schema). */
export const explainResultSchema = z.object({
  means: z.string().max(2000),
  symbols: z.array(z.object({ symbol: z.string().max(60), meaning: z.string().max(300) })).max(20),
  role: z.string().max(1000),
});
export type ExplainResult = z.infer<typeof explainResultSchema>;

const explainInput = {
  docId: documentIdSchema,
  page: z.number().int().positive().max(100_000),
  /** What the user selected, or the caption of a crop. */
  text: z.string().max(6000),
  /** The paragraph around it. */
  around: z.string().max(9000).default(''),
  /** `detail`: the "Più dettagli" request (a longer explanation). */
  detail: z.boolean().default(false),
  model: z.string().min(1).max(100).optional(),
};

export const readerToolsChannels = {
  ...defineChannels('crops', {
    /** Stores the WebP image of a crop: `crops/<docId>/<annId>.webp` in the data folder (written atomically). */
    save: { request: z.object({ docId: documentIdSchema, annId: itemIdSchema, image: z.string().min(1).max(CROP_BASE64_MAX) }), response: z.object({ ok: z.literal(true) }) },
    /** The image of a crop as base64, or `null` when there is none. */
    get: { request: z.object({ docId: documentIdSchema, annId: itemIdSchema }), response: z.object({ image: z.string().nullable() }) },
    /** Deletes the image of a crop (the annotation was deleted). */
    remove: { request: z.object({ docId: documentIdSchema, annId: itemIdSchema }), response: z.object({ removed: z.boolean() }) },
  }),
  ...defineChannels('explain', {
    /** What a "✦ Spiega" would send and cost (D-416), without sending anything. */
    estimate: {
      request: z.object(explainInput),
      response: z.object({
        model: z.string(),
        approxTokens: z.number().int().nonnegative(),
        estimatedUsd: z.number().nonnegative().nullable(),
        /** The same request was already answered: nothing would be sent. */
        cached: z.boolean(),
        /** The folder of the document is enabled for sending text (D-108). */
        folderEnabled: z.boolean(),
        /** The folder never received a send of document text before (the dialog asks once). */
        firstFolderSend: z.boolean(),
        thresholdTokens: z.number().int().positive(),
        /** The dialog is needed: over the threshold or first send for the folder. */
        needsDialog: z.boolean(),
        /** Tokens sent today by this library (local day) and the daily cap. */
        todayTokens: z.number().int().nonnegative(),
        dailyCap: z.number().int().positive().nullable(),
        overDailyCap: z.boolean(),
        /** Whole percent of the cap used today, with this send; null without a cap. */
        todayPct: z.number().int().nonnegative().nullable(),
      }),
    },
    /** Sends it (only with an enabled folder), logs it and caches the answer by hash + model + prompt version. */
    run: {
      request: z.object({ ...explainInput, confirmed: z.boolean().default(false) }),
      response: z.object({ result: explainResultSchema, model: z.string(), at: isoDateSchema, cached: z.boolean() }),
    },
  }),
};
