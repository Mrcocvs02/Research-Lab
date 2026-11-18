import type { z } from 'zod';
import { AppError, type AiMeta, type ReasoningLevel, type TokenUsage } from '@rl/core';
import type { MainServices } from '../ipc/handlers/services.js';
import { type AiCtx, monthUsage } from '../ai/service.js';
import { assertTokenCap, noteSend } from '../ai/token-cap.js';
import { monthOf, usdOfUsage } from '../ai/usage.js';

/** What the analysis steps need to talk to Claude: the services, the context of the library, the provider, and the job's signal. */
export interface Runner {
  s: MainServices;
  ctx: AiCtx;
  provider: NonNullable<AiCtx['provider']>;
  signal: AbortSignal;
  confirmed: boolean;
  deviceId: string;
  /** Called with the dollars each call cost (the job adds them up). */
  addUsd(usd: number): void;
}

const isUsage = (u: unknown): u is TokenUsage => typeof u === 'object' && u !== null && typeof (u as TokenUsage).inputTokens === 'number' && typeof (u as TokenUsage).outputTokens === 'number';

export interface CallInput<T> {
  /** Log purpose: `job:note`, `job:analysis`, `job:taxonomy`. */
  purpose: string;
  model: string;
  reasoning: ReasoningLevel;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  docIds: string[];
  folders: string[];
}

/**
 * One structured call with the guards of every AI send: the monthly dollar cap and the token cap BEFORE the call, the record of the
 * send in the log (also when the call fails after the content may have left), and the cost added to the job. Throws the provider's
 * error; `CANCELLED` when the signal fired.
 */
export async function callStructured<T>(r: Runner, c: CallInput<T>): Promise<{ value: T; meta: AiMeta }> {
  const { s, ctx, provider } = r;
  const { rt, cfg } = ctx;
  const cap = cfg.ai.usageCap.monthlyUsd;
  if (cap !== null && (await monthUsage(rt, monthOf(new Date()))).usd >= cap) throw new AppError('AI_BUDGET_EXCEEDED', 'The monthly AI spending cap is reached');
  const approxIn = Math.ceil((c.system.length + c.prompt.length) / 4);
  await assertTokenCap(s, approxIn);
  const log = (inputTokens: number, outputTokens: number | undefined, usd: number | null) =>
    rt.store
      .appendLog({
        type: 'ai-send',
        at: new Date().toISOString(),
        deviceId: r.deviceId,
        provider: provider.id,
        model: c.model,
        purpose: c.purpose,
        docIds: c.docIds,
        folders: c.folders,
        approxInputTokens: inputTokens,
        ...(outputTokens !== undefined ? { approxOutputTokens: outputTokens } : {}),
        ...(usd !== null ? { estimatedCostUsd: usd } : {}),
        confirmed: r.confirmed,
      })
      .then(() => noteSend(s, c.purpose, inputTokens, outputTokens))
      .catch((e: unknown) => s.log.warn('could not log an AI send', { error: e }));
  let res;
  try {
    res = await provider.completeStructured({ model: c.model, reasoning: c.reasoning, system: c.system, prompt: c.prompt, schema: c.schema, source: c.purpose, signal: r.signal });
  } catch (e) {
    const d = AppError.from(e).details;
    // Logged when the content was (or may have been) sent; NOT when the provider says nothing left the machine.
    if (d?.['sent'] !== false) {
      const spent = isUsage(d?.['usage']) ? d['usage'] : null;
      const usd = spent ? usdOfUsage(cfg.ai.models, c.model, spent) : null;
      r.addUsd(usd ?? 0);
      await log(spent?.inputTokens ?? approxIn, spent?.outputTokens, usd);
    }
    throw e;
  }
  const usd = usdOfUsage(cfg.ai.models, c.model, res.usage);
  r.addUsd(usd ?? 0);
  await log(res.usage.inputTokens, res.usage.outputTokens, usd);
  if (r.signal.aborted) throw new AppError('CANCELLED', 'Cancelled');
  return { value: res.value, meta: { ...res.meta, source: c.purpose } };
}

/** The model for the literature note and the taxonomy: a configured model whose id says "sonnet" (D-446), else the one chosen for the job. */
export function strongModel(models: ReadonlyArray<{ id: string }>, chosen: string): string {
  return models.find((m) => /sonnet/i.test(m.id))?.id ?? chosen;
}
