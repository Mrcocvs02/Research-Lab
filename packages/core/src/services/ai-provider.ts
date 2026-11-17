import type { z } from 'zod';
import type { AiMeta } from '../model/ai-field.js';
import type { AiProviderId, ReasoningLevel } from '../settings.js';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  /** The cost the provider itself reported (Agent SDK `total_cost_usd`), when it did: it prices cache reads correctly. */
  costUsd?: number;
}

export interface CostEstimate extends TokenUsage {
  /** Null when no price is known for the model. */
  usd: number | null;
  model: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A tool the agent may call. Only tools listed here are available: no shell, no free network. */
export interface ToolSpec {
  name: string;
  description: string;
  input: z.ZodType;
  /** Writing tools must be confined to the data dir and to AI fields. */
  writes: boolean;
  run(input: unknown, ctx: { signal?: AbortSignal }): Promise<unknown>;
}

export interface ChatRequest {
  model: string;
  reasoning: ReasoningLevel;
  /** System / agent guide. Document text is passed only as delimited DATA in messages. */
  system: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  signal?: AbortSignal;
}

/** Events of a streaming chat. Tool calls are shown by the UI as cards. */
export type ChatEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; id: string; name: string; ok: boolean; summary: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done'; meta: AiMeta }
  | { type: 'error'; code: 'AI_PROVIDER_ERROR' | 'AI_BUDGET_EXCEEDED' | 'CANCELLED'; message: string };

export interface StructuredRequest<T> {
  model: string;
  reasoning: ReasoningLevel;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Command id, copied into the AiMeta `source`. */
  source: string;
  signal?: AbortSignal;
}

export interface StructuredResult<T> {
  value: T;
  usage: TokenUsage;
  meta: AiMeta;
}

/**
 * Pluggable AI provider. A deterministic mock implementation (provider id `mock`)
 * is used by every automated test; real calls are opt-in only.
 */
export interface AiProvider {
  readonly id: AiProviderId;
  chat(request: ChatRequest): AsyncIterable<ChatEvent>;
  completeStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>;
  estimateCost(request: { model: string; promptChars: number; expectedOutputTokens?: number }): CostEstimate;
  /** Cheap check that credentials/access exist (never returns them). */
  isAvailable(): Promise<boolean>;
}
