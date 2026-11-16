import type { CostEstimate, ModelConfig } from '@rl/core';

/** Rough size of a text in tokens: characters / 4 (a stable, documented approximation; used for previews, logs and estimates). */
export const approxTokens = (chars: number): number => Math.ceil(Math.max(0, chars) / 4);

/** USD for a token count from the price hints of a model (USD per million tokens); null when the model has no price hint. */
export function usdFor(models: readonly ModelConfig[], model: string, inputTokens: number, outputTokens: number): number | null {
  const m = models.find((x) => x.id === model);
  if (!m || m.inputPerMTok === undefined || m.outputPerMTok === undefined) return null;
  return (inputTokens * m.inputPerMTok + outputTokens * m.outputPerMTok) / 1_000_000;
}

/** Output assumed when the caller gives no expectation (a short answer, plan §5: replies are brief). */
export const DEFAULT_EXPECTED_OUTPUT_TOKENS = 800;

export function estimateCostFromModels(
  models: readonly ModelConfig[],
  request: { model: string; promptChars: number; expectedOutputTokens?: number },
): CostEstimate {
  const inputTokens = approxTokens(request.promptChars);
  const outputTokens = request.expectedOutputTokens ?? DEFAULT_EXPECTED_OUTPUT_TOKENS;
  return { inputTokens, outputTokens, usd: usdFor(models, request.model, inputTokens, outputTokens), model: request.model };
}
