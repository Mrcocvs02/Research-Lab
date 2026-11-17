import { AppError, DEFAULT_MODELS, type ChatEvent, type ChatRequest, type CostEstimate, type ModelConfig, type StructuredRequest, type StructuredResult } from '@rl/core';
import { approxTokens, estimateCostFromModels } from './pricing.js';
import { parseTaxonomyBlock } from './suggest.js';
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
  fail?: { code: 'AI_PROVIDER_ERROR' | 'AI_BUDGET_EXCEEDED'; message: string; /** `completeStructured` only: false = nothing reached the model (the error says so, like a process that never started). */ sent?: boolean };
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
  /**
   * Demo flow for the e2e runtime (`RL_AI_PROVIDER=mock`): a short intro, a `search_library` card, then an answer that links a REAL
   * document (`lab://doc/<id>?page=1`: the first context document, else the first search hit). Ignored when `reply` or `toolCalls` are set.
   */
  demo?: boolean;
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

/**
 * Default structured answer of the mock, built from the keys of the schema (`@rl/ai` suggest schema): tags are existing
 * taxonomy ids whose label words appear in the document data of the prompt (else the first node); fixed short texts for
 * the other fields. Deterministic, so that the e2e can predict it.
 */
export function mockStructured(request: { schema: unknown; prompt: string }): unknown {
  const keys = Object.keys((request.schema as { shape?: Record<string, unknown> }).shape ?? {});
  const data = (/<<<DATA[\s\S]*?DATA>>>/.exec(request.prompt)?.[0] ?? '').toLowerCase();
  const nodes = parseTaxonomyBlock(request.prompt);
  const hits = nodes.filter((n) => n.label.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((w) => w.length >= 3 && data.includes(w))).slice(0, 3);
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k === 'tagIds') out[k] = (hits.length > 0 ? hits : nodes.slice(0, 1)).map((n) => n.id);
    else if (k === 'newTags') out[k] = [];
    else if (k === 'description') out[k] = 'Mock description of the document.';
    else if (k === 'summary') out[k] = 'Mock summary.';
    else if (k === 'keywords') out[k] = ['mock keyword', 'second keyword'];
    else if (k === 'synonyms') out[k] = ['mock synonym'];
    else if (k === 'labels') out[k] = mockClusterLabels(request.prompt);
  }
  return out;
}

/** Labels for the clusters of a `graph:labels` prompt (`id:` and `terms:` lines of its DATA blocks): the first two terms, capitalised. */
function mockClusterLabels(prompt: string): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  for (const m of prompt.matchAll(/^id: (\S+)\nterms: (.*)$/gm)) {
    const words = (m[2] ?? '').split(',').map((w) => w.trim()).filter(Boolean).slice(0, 2);
    const text = words.join(' ');
    out.push({ id: m[1] as string, label: text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : 'Mock cluster' });
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
      const demo = script.demo === true && script.reply === undefined && script.toolCalls === undefined;
      const calls = demo ? [] : [...(script.toolCalls ?? []), ...parseToolDirectives(last)];
      let n = 0;
      let foundId: string | undefined;
      const runCall = async function* (call: { name: string; input: unknown }): AsyncGenerator<ChatEvent> {
        const id = `mock-tool-${++n}`;
        yield { type: 'tool-call', id, name: call.name, input: call.input };
        const spec = request.tools?.find((t) => t.name === call.name);
        if (!spec) {
          yield { type: 'tool-result', id, name: call.name, ok: false, summary: `Unknown tool ${call.name}` };
          return;
        }
        try {
          const result = await spec.run(call.input, request.signal ? { signal: request.signal } : {});
          const items = isToolResult(result) ? (result.data as { items?: Array<{ id?: string }> } | null)?.items : undefined;
          foundId ??= items?.[0]?.id;
          yield { type: 'tool-result', id, name: call.name, ok: true, summary: isToolResult(result) ? result.summary : 'Done' };
        } catch (e) {
          const err = AppError.from(e);
          yield { type: 'tool-result', id, name: call.name, ok: false, summary: `${err.code}: ${err.message}`.slice(0, 300) };
        }
      };
      for (const call of calls) {
        if (request.signal?.aborted) return yield cancelled();
        yield* runCall(call);
      }
      let chunkList = script.chunkList ?? split(reply, script.chunks ?? 4);
      if (demo) {
        const intro = 'Let me check the library. ';
        yield { type: 'text-delta', text: intro };
        // The search word comes from the user's own request: the text after the last "User request…:" label when there is
        // one (fixed instructions such as the advanced search's come before it), without data blocks.
        const own = last.split(/User request[^\r\n]*:/).at(-1) ?? last;
        const word = own.replace(/<<<DATA[\s\S]*?DATA>>>/g, ' ').match(/[\p{L}\p{N}]{4,}/gu)?.sort((a, b) => b.length - a.length)[0] ?? 'paper';
        yield* runCall({ name: 'search_library', input: { query: word } });
        const id = last.match(/<<<DATA document\r?\nid: ([0-9a-f]{16})/)?.[1] ?? foundId;
        chunkList = [id ? `Here is the paper: [Source](lab://doc/${id}?page=1). ` : 'I found nothing relevant. ', 'This is a mock answer.'];
      }
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
      if (script.fail) throw new AppError(script.fail.code, script.fail.message, script.fail.sent === undefined ? undefined : { sent: script.fail.sent });
      const parsed = request.schema.safeParse(script.structured !== undefined ? script.structured : mockStructured(request));
      if (!parsed.success) throw new AppError('AI_PROVIDER_ERROR', 'The mock answer does not match the schema');
      const usage: TokenUsageWithCost = script.usage ?? { inputTokens: approxTokens(request.system.length + request.prompt.length), outputTokens: 50 };
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
