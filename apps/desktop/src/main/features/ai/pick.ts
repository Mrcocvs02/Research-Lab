import { AppError, documentIdSchema, type DocumentId, type DocumentRecord } from '@rl/core';
import { assertModel, type AiCtx } from '../../ai/service.js';

/** The model `id`, when it is one of the configured models. */
const known = (models: ReadonlyArray<{ id: string }>, id: string): string => {
  assertModel({ ai: { models } }, id);
  return id;
};

/** The model asked for, else the default one. */
export const modelOf = (ctx: AiCtx, wanted?: string): string => known(ctx.cfg.ai.models, wanted ?? ctx.cfg.ai.defaultModel);

/** The cheap model by default: the configured one whose id says "haiku", else the default (D-419). */
export const cheapModel = (models: ReadonlyArray<{ id: string }>, fallback: string, wanted?: string): string =>
  known(models, wanted ?? models.find((x) => /haiku/i.test(x.id))?.id ?? fallback);

/** The record of a document, or NOT_FOUND. */
export async function getRecord(ctx: AiCtx, docId: string): Promise<DocumentRecord> {
  const rec = await ctx.rt.store.documents.get(documentIdSchema.parse(docId) as DocumentId);
  if (!rec) throw new AppError('NOT_FOUND', 'Unknown document');
  return rec;
}
