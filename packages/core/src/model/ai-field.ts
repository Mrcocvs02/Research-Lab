import { z } from 'zod';
import { isoDateSchema } from '../common.js';
import { aiProviderIdSchema } from '../settings.js';

export const aiMetaSchema = z.object({
  model: z.string().min(1),
  provider: aiProviderIdSchema,
  date: isoDateSchema,
  /** What produced it: command id, "import:legacy", "chat", ... */
  source: z.string().min(1),
});
export type AiMeta = z.infer<typeof aiMetaSchema>;

export const reviewStatusSchema = z.enum(['proposed', 'accepted', 'rejected', 'edited']);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

/**
 * Wrapper for every AI-generated value. AI output NEVER lives in the user's own fields
 * (tags, notes, title...); it lives in `document.ai.*` as an AiField.
 * When the user edits it, `value` becomes the edited text and the original is kept.
 */
export function aiFieldSchema<T extends z.ZodType>(value: T) {
  return z.object({
    value,
    meta: aiMetaSchema,
    review: z.object({
      status: reviewStatusSchema.default('proposed'),
      at: isoDateSchema.optional(),
      originalValue: value.optional(),
    }),
  });
}
export type AiField<T> = {
  value: T;
  meta: AiMeta;
  review: { status: ReviewStatus; at?: string; originalValue?: T };
};
