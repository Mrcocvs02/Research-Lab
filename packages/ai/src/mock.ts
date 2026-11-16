import { AppError, DEFAULT_MODELS, type ChatEvent, type ChatRequest, type CostEstimate, type ModelConfig, type StructuredRequest, type StructuredResult } from '@rl/core';
import { approxTokens, estimateCostFromModels } from './pricing.js';
import { isToolResult } from './tools.js';
import type { AiAccess, AiProviderEx, TokenUsageWithCost } from './types.js';

/**
 * Script of the deterministic provider. Everything is optional: the default answers `Mock reply to: <start of the question>`
 * in four chunks, with usage computed from the sizes.
 */
export interface MockScript {
  /** The answer text (or a function of the request); split into `chunks` pieces unless `chunkList` is given. */
  reply?: string | ((request: ChatRequest) => string);
  chunkList?: string[];
  chunks?: number;
  /** Tool calls made before the answer, through the tools of the request (so the privacy gate runs for real). */
  toolCalls?: Array<{ name: string; input: unknown }>;
  /** Milliseconds to wait before each chunk (abortable): lets a test cancel in the middle. */
  delayMs?: number;
  /** Never finish: waits until the request is aborted (a cancellation test). Text chunks come first. */
  holdUntilAborted?: boolean;
  /** Ends the turn with this error event instead of `done`. */
  fail?: { code: 'AI_PROVIDER_ERROR' | 'AI_BUDGET_EXCEEDED'; message: string };
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
  /** `ai:status` answers for the mock. */
  access?: AiAccess;
  available?: boolean;
  /** Result of `completeStructured` (validated against the schema, like a real answer). */
  structured?: unknown;
  models?: ModelConfig[];
  now?: () => Date;
}

const abortableSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    const onAbort = () => done();
    function done() {
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });

const split = (text: string, n: number): string[] => {
  const words = text.split(/(?<=\s)/);
  const size = Math.max(1, Math.ceil(words.length / Math.max(1, n)));
  const out: string[] = [];
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size).join(''));
  return out.length > 0 ? out : [''];
};

/** Test and e2e directive: a line `@tool <name> <json>` in the last user message makes the mock call that tool. */
export function parseToolDirectives(text: string): Array<{ name: string; input: unknown }> {
  const out: Array<{ name: string; input: unknown }> = [];
  for (const m of text.matchAll(/^@tool ([a-z_]+) (\{.*\})\s*$/gm)) {
    try {
      out.push({ name: m[1]!, input: JSON.parse(m[2]!) });
    } catch {
      /* not JSON: ignored */
    }
  }
  return out;
}

/** Deterministic provider (id `mock`): no network, no process, no clock unless asked. Used by every automated test. */
export function createMockAiProvider(script: MockScript = {}): AiProviderEx {
  const models = script.models ?? DEFAULT_MODELS;
  const now = () => (script.now?.() ?? new Date()).toISOString();
  return {
    id: 'mock',
    async *chat(request: ChatRequest): AsyncGenerator<ChatEvent> {
      const last = [...request.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      const cancelled = (): ChatEvent => ({ type: 'error', code: 'CANCELLED', message: 'Cancelled' });
      let reply: string;
      try {
        reply = typeof script.reply === 'function' ? script.reply(request) : (script.reply ?? `Mock reply to: ${last.replace(/\s+/g, ' ').slice(0, 60)}`);
      } catch (e) {
        yield { type: 'error', code: 'AI_PROVIDER_ERROR', message: e instanceof Error ? e.message : 'mock script failed' };
        return;
      }
      const calls = [...(script.toolCalls ?? []), ...parseToolDirectives(last)];
      let n = 0;
      for (const call of calls) {
        if (request.signal?.aborted) return yield cancelled();
        const id = `mock-tool-${++n}`;
        yield { type: 'tool-call', id, name: call.name, input: call.input };
        const spec = request.tools?.find((t) => t.name === call.name);
        if (!spec) {
          yield { type: 'tool-result', id, name: call.name, ok: false, summary: `Unknown tool ${call.name}` };
          continue;
        }
        try {
          const result = await spec.run(call.input, request.signal ? { signal: request.signal } : {});
          yield { type: 'tool-result', id, name: call.name, ok: true, summary: isToolResult(result) ? result.summary : 'Done' };
        } catch (e) {
          const err = AppError.from(e);
          yield { type: 'tool-result', id, name: call.name, ok: false, summary: `${err.code}: ${err.message}`.slice(0, 300) };
        }
      }
      const chunkList = script.chunkList ?? split(reply, script.chunks ?? 4);
      for (const text of chunkList) {
        if (script.delayMs) await abortableSleep(script.delayMs, request.signal);
        if (request.signal?.aborted) return yield cancelled();
        yield { type: 'text-delta', text };
      }
      if (script.holdUntilAborted) {
        await new Promise<void>((resolve) => {
          if (request.signal?.aborted) return resolve();
          request.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        return yield cancelled();
      }
      if (script.fail) return yield { type: 'error', code: script.fail.code, message: script.fail.message };
      const inChars = request.system.length + request.messages.reduce((a, m) => a + m.content.length, 0);
      const usage: TokenUsageWithCost = script.usage ?? { inputTokens: approxTokens(inChars), outputTokens: approxTokens(chunkList.join('').length) };
      yield { type: 'usage', usage };
      yield { type: 'done', meta: { model: request.model, provider: 'mock', date: now(), source: 'chat' } };
    },
    async completeStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
      if (script.fail) throw new AppError(script.fail.code, script.fail.message);
      const parsed = request.schema.safeParse(script.structured);
      if (!parsed.success) throw new AppError('AI_PROVIDER_ERROR', 'The mock answer does not match the schema');
      const usage = { inputTokens: approxTokens(request.system.length + request.prompt.length), outputTokens: 50 };
      return { value: parsed.data, usage, meta: { model: request.model, provider: 'mock', date: now(), source: request.source } };
    },
    estimateCost(request): CostEstimate {
      return estimateCostFromModels(models, request);
    },
    async isAvailable() {
      return script.available ?? true;
    },
    async access(): Promise<AiAccess> {
      return script.access ?? { auth: (script.available ?? true) ? 'api-key' : 'none' };
    },
  };
}
