import { z } from 'zod';
import { documentIdSchema, isoDateSchema, relativePathSchema } from '../common.js';
import { aiProviderIdSchema } from '../settings.js';

const base = {
  at: isoDateSchema,
  /** Installation that wrote the entry (log files are per device to avoid sync conflicts). */
  deviceId: z.string().min(1),
};

/** A change to library data, with enough to undo it. */
export const changeEntrySchema = z.object({
  ...base,
  type: z.literal('change'),
  actor: z.enum(['user', 'ai', 'import', 'system']),
  target: z.object({
    kind: z.enum(['document', 'taxonomy', 'note', 'annotation', 'citation', 'project', 'watch', 'config']),
    id: z.string().optional(),
  }),
  action: z.string().min(1),
  /** JSON-serialisable before/after snapshots of the changed fields. */
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});

/** Record of content sent to an AI provider. Stores ids and sizes, never document text. */
export const aiSendEntrySchema = z.object({
  ...base,
  type: z.literal('ai-send'),
  provider: aiProviderIdSchema,
  model: z.string(),
  purpose: z.string(),
  docIds: z.array(documentIdSchema),
  folders: z.array(relativePathSchema),
  approxInputTokens: z.number().int().nonnegative(),
  approxOutputTokens: z.number().int().nonnegative().optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
  /** True when the user confirmed the preview. */
  confirmed: z.boolean(),
});

export const logEntrySchema = z.discriminatedUnion('type', [changeEntrySchema, aiSendEntrySchema]);
export type LogEntry = z.infer<typeof logEntrySchema>;
export type ChangeEntry = z.infer<typeof changeEntrySchema>;
export type AiSendEntry = z.infer<typeof aiSendEntrySchema>;
