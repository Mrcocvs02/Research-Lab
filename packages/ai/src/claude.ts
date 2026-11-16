import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  AppError,
  DEFAULT_MODELS,
  type AiMeta,
  type ChatEvent,
  type ChatRequest,
  type ModelConfig,
  type ReasoningLevel,
  type StructuredRequest,
  type StructuredResult,
  type TokenUsage,
  type ToolSpec,
} from '@rl/core';
import { estimateCostFromModels } from './pricing.js';
import { isToolResult } from './tools.js';
import type { AiAccess, AiProviderEx, TokenUsageWithCost } from './types.js';

/** Name of the in-process MCP server; the model sees the tools as `mcp__rl__<name>`. */
export const MCP_SERVER_NAME = 'rl';
export const mcpToolName = (name: string) => `mcp__${MCP_SERVER_NAME}__${name}`;

/** Built-in tools of Claude Code, disallowed by name on top of `tools: []` (belt and braces: the agent gets ONLY our tools). */
export const BUILTIN_TOOLS_DISALLOWED = [
  'Bash', 'BashOutput', 'KillShell', 'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'WebFetch', 'WebSearch',
  'Task', 'Agent', 'TodoWrite', 'Skill', 'SlashCommand', 'ExitPlanMode', 'EnterPlanMode', 'AskUserQuestion', 'ListMcpResources',
  'ReadMcpResource', 'Monitor', 'TaskStop', 'TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList', 'Workflow', 'CronCreate', 'CronDelete',
  'CronList', 'ScheduleWakeup', 'RemoteTrigger', 'ToolSearch',
] as const;

/** Our reasoning levels map one to one onto the SDK `effort` option (`low | medium | high | ...`). */
export const effortFor = (level: ReasoningLevel): NonNullable<Options['effort']> => level;

/* ----------------------------- executable and access ----------------------------- */

export interface ExecutableLookup {
  /** Explicit path chosen by the user (settings), when any. */
  configured?: string | null;
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
  exists?: (p: string) => boolean;
  /** Path of the executable shipped with the SDK package for this platform, or null. */
  bundled?: () => string | null;
}

/**
 * Where the Claude Code executable is (D-203): the path in the settings, then `claude` in the PATH, then `~/.local/bin`,
 * then the one shipped with the SDK package (development). Null when none exists.
 */
export function resolveClaudeExecutable(o: ExecutableLookup = {}): string | null {
  const env = o.env ?? process.env;
  const platform = o.platform ?? process.platform;
  const exists = o.exists ?? ((p: string) => existsSync(p));
  const exe = platform === 'win32' ? 'claude.exe' : 'claude';
  const pathMod = platform === 'win32' ? path.win32 : path.posix;
  if (o.configured && exists(o.configured)) return o.configured;
  const pathVar = env.PATH ?? env.Path ?? '';
  for (const dir of pathVar.split(platform === 'win32' ? ';' : ':')) {
    if (!dir) continue;
    const p = pathMod.join(dir, exe);
    if (exists(p)) return p;
  }
  const home = o.home ?? os.homedir();
  const local = pathMod.join(home, '.local', 'bin', exe);
  if (exists(local)) return local;
  return (o.bundled ?? bundledExecutable)();
}

/** The executable of the optional platform package of the SDK (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>`), if installed. */
export function bundledExecutable(): string | null {
  try {
    const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const pkg = createRequire(import.meta.url).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`);
    const p = path.join(path.dirname(pkg), exe);
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

export interface AccessLookup {
  apiKey: string | null;
  env?: NodeJS.ProcessEnv;
  home?: string;
  exists?: (p: string) => boolean;
}

/**
 * Which credential the child process would use, without spending a token and without reading any secret file:
 * a stored API key, the user's own ANTHROPIC_API_KEY, or the Claude Code login (token variable or the login file exists).
 */
export function detectAccess(o: AccessLookup): AiAccess {
  const env = o.env ?? process.env;
  const exists = o.exists ?? ((p: string) => existsSync(p));
  if (o.apiKey) return { auth: 'api-key' };
  if (env.ANTHROPIC_API_KEY) return { auth: 'api-key' };
  if (env.CLAUDE_CODE_OAUTH_TOKEN) return { auth: 'claude-code' };
  if (exists(path.join(o.home ?? os.homedir(), '.claude', '.credentials.json'))) return { auth: 'claude-code' };
  return { auth: 'none' };
}

/* --------------------------------- query options --------------------------------- */

export interface QueryOptionsInput {
  model: string;
  reasoning: ReasoningLevel;
  systemPrompt: string;
  /** An empty folder owned by the app: the agent's working directory is never the library. */
  cwd: string;
  abortController: AbortController;
  /** In-process MCP server with the library tools (absent for structured completions: no tools at all). */
  mcpServer?: NonNullable<Options['mcpServers']>[string];
  toolNames?: readonly string[];
  /** Key from the secure store: goes ONLY to the child process, through `env`. */
  apiKey: string | null;
  baseEnv: NodeJS.ProcessEnv;
  executable?: string | null;
  clientApp?: string;
  maxTurns?: number;
  outputFormat?: Options['outputFormat'];
  stderr?: (data: string) => void;
}

/** Variables the child never needs from the app: test hooks and Electron switches. */
const ENV_DROP = /^(RL_|ELECTRON_)/;

/**
 * Builds the options of `query()`. Pure, so that it is unit-tested: this is where "only our tools, no user settings, no
 * terminal prompt, empty cwd, key only in env" is decided.
 */
export function buildQueryOptions(i: QueryOptionsInput): Options {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(i.baseEnv)) if (!ENV_DROP.test(k)) env[k] = v;
  if (i.apiKey) env.ANTHROPIC_API_KEY = i.apiKey;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = i.clientApp ?? 'research-lab';
  const options: Options = {
    abortController: i.abortController,
    cwd: i.cwd,
    model: i.model,
    effort: effortFor(i.reasoning),
    systemPrompt: i.systemPrompt, // a string REPLACES the Claude Code prompt
    settingSources: [], // no user, project or local settings, hence no CLAUDE.md of the user's own
    tools: [], // no built-in tool at all
    disallowedTools: [...BUILTIN_TOOLS_DISALLOWED],
    allowedTools: [...(i.toolNames ?? [])],
    permissionMode: 'dontAsk', // whatever is not in allowedTools is denied, never asked
    permissionPrompts: 'none', // nobody to ask: no prompt on a terminal or anywhere
    strictMcpConfig: true, // only the server passed here
    persistSession: false, // no transcript on disk
    includePartialMessages: true,
    env,
    ...(i.mcpServer ? { mcpServers: { [MCP_SERVER_NAME]: i.mcpServer } } : {}),
    ...(i.executable ? { pathToClaudeCodeExecutable: i.executable } : {}),
    ...(i.maxTurns ? { maxTurns: i.maxTurns } : {}),
    ...(i.outputFormat ? { outputFormat: i.outputFormat } : {}),
    ...(i.stderr ? { stderr: i.stderr } : {}),
  };
  return options;
}

/* ------------------------------------ provider ------------------------------------ */

export interface SdkModule {
  query: typeof import('@anthropic-ai/claude-agent-sdk').query;
  tool: typeof import('@anthropic-ai/claude-agent-sdk').tool;
  createSdkMcpServer: typeof import('@anthropic-ai/claude-agent-sdk').createSdkMcpServer;
}

export interface ClaudeProviderOptions {
  /** Resolves the API key from the OS store; the provider never persists it. */
  getApiKey?: () => Promise<string | null>;
  /** Models with price hints (for estimates). */
  models?: ModelConfig[];
  /** Empty folder used as the agent's cwd (created when missing). */
  workDir: string;
  /** Explicit Claude Code path from the settings, if any. */
  configuredExecutable?: () => string | null;
  clientApp?: string;
  /** Test seams. */
  env?: NodeJS.ProcessEnv;
  home?: string;
  exists?: (p: string) => boolean;
  bundled?: () => string | null;
  /** Loads the SDK; default: dynamic import on first use (nothing resident before). */
  loadSdk?: () => Promise<SdkModule>;
}

const scrub = (text: string, key: string | null): string => {
  let t = key ? text.split(key).join('[key]') : text;
  t = t.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, '[key]');
  return t;
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Plain-text rendering of the earlier turns (nothing is kept on disk by the SDK: the app keeps the history). */
export function renderPrompt(messages: ChatRequest['messages'], maxHistoryChars = 80_000): string {
  const last = messages.at(-1);
  if (!last || last.role !== 'user') throw new AppError('INVALID_REQUEST', 'The last message must come from the user');
  const history = messages.slice(0, -1);
  if (history.length === 0) return last.content;
  const lines: string[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const line = `${history[i]!.role === 'user' ? 'User' : 'Assistant'}: ${history[i]!.content}`;
    if (used + line.length > maxHistoryChars) break;
    used += line.length;
    lines.unshift(line);
  }
  return `Conversation so far (context only):\n${lines.join('\n\n')}\n\nLatest user message:\n${last.content}`;
}

/** Totals of a result message (sum of `modelUsage`, which also covers internal calls; falls back to `usage`). */
function usageOf(msg: Extract<SDKMessage, { type: 'result' }>): TokenUsageWithCost {
  let input = 0;
  let output = 0;
  let cached = 0;
  const mu = Object.values(msg.modelUsage ?? {});
  if (mu.length > 0) {
    for (const u of mu) {
      input += u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens;
      output += u.outputTokens;
      cached += u.cacheReadInputTokens;
    }
  } else {
    input = msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
    output = msg.usage.output_tokens;
    cached = msg.usage.cache_read_input_tokens ?? 0;
  }
  return { inputTokens: input, outputTokens: output, ...(cached > 0 ? { cachedInputTokens: cached } : {}), ...(Number.isFinite(msg.total_cost_usd) ? { costUsd: msg.total_cost_usd } : {}) };
}

const AUTH_ERRORS = new Set(['authentication_failed', 'oauth_org_not_allowed', 'account_on_hold', 'verification_required', 'billing_error', 'cloud_credential_error']);

export function createClaudeProvider(options: ClaudeProviderOptions): AiProviderEx {
  const models = options.models ?? DEFAULT_MODELS;
  const env = () => options.env ?? process.env;
  const getKey = async () => (options.getApiKey ? await options.getApiKey().catch(() => null) : null);
  const executable = () =>
    resolveClaudeExecutable({
      configured: options.configuredExecutable?.() ?? null,
      env: env(),
      ...(options.home ? { home: options.home } : {}),
      ...(options.exists ? { exists: options.exists } : {}),
      ...(options.bundled ? { bundled: options.bundled } : {}),
    });
  const loadSdk = options.loadSdk ?? (async () => (await import('@anthropic-ai/claude-agent-sdk')) as unknown as SdkModule);

  const access = async (): Promise<AiAccess> =>
    detectAccess({ apiKey: await getKey(), env: env(), ...(options.home ? { home: options.home } : {}), ...(options.exists ? { exists: options.exists } : {}) });

  /** The in-process server with the request's tools (each wrapped so that results and errors become compact JSON). */
  function buildServer(sdk: SdkModule, tools: ToolSpec[], signal: AbortSignal, completed: Map<string, Array<{ ok: boolean; summary: string }>>) {
    const defs = tools.map((spec) => {
      const shape = (spec.input as z.ZodObject).shape;
      if (!shape) throw new AppError('INTERNAL', `Tool ${spec.name} must have an object input`);
      return sdk.tool(spec.name, spec.description, shape, async (args) => {
        const done = (r: { ok: boolean; summary: string }) => {
          const q = completed.get(spec.name) ?? [];
          q.push(r);
          completed.set(spec.name, q);
        };
        try {
          const result = await spec.run(args, { signal });
          const summary = isToolResult(result) ? result.summary : 'Done';
          done({ ok: true, summary });
          return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, summary, data: isToolResult(result) ? result.data : result }) }] };
        } catch (e) {
          const err = AppError.from(e);
          done({ ok: false, summary: `${err.code}: ${err.message}` });
          return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, code: err.code, message: err.message }) }] };
        }
      });
    });
    return sdk.createSdkMcpServer({ name: MCP_SERVER_NAME, tools: defs });
  }

  return {
    id: 'claude-agent-sdk',

    async *chat(request: ChatRequest): AsyncGenerator<ChatEvent> {
      const key = await getKey();
      const abort = new AbortController();
      const onAbort = () => abort.abort();
      if (request.signal?.aborted) return yield { type: 'error', code: 'CANCELLED', message: 'Cancelled' };
      request.signal?.addEventListener('abort', onAbort, { once: true });
      let q: ReturnType<SdkModule['query']> | null = null;
      let stderrTail = '';
      try {
        await mkdir(options.workDir, { recursive: true });
        const sdk = await loadSdk();
        const tools = request.tools ?? [];
        const completed = new Map<string, Array<{ ok: boolean; summary: string }>>();
        const opts = buildQueryOptions({
          model: request.model,
          reasoning: request.reasoning,
          systemPrompt: request.system,
          cwd: options.workDir,
          abortController: abort,
          ...(tools.length > 0 ? { mcpServer: buildServer(sdk, tools, abort.signal, completed), toolNames: tools.map((t) => mcpToolName(t.name)) } : {}),
          apiKey: key,
          baseEnv: env(),
          executable: executable(),
          ...(options.clientApp ? { clientApp: options.clientApp } : {}),
          maxTurns: 12,
          stderr: (d) => {
            stderrTail = (stderrTail + d).slice(-2000);
          },
        });
        q = sdk.query({ prompt: renderPrompt(request.messages), options: opts });
        const names = new Map<string, string>(); // tool_use id -> tool name
        let streamed = false;
        let usage: TokenUsageWithCost | null = null;
        let failure: string | null = null;
        for await (const msg of q) {
          if (msg.type === 'stream_event') {
            const ev = msg.event;
            if (msg.parent_tool_use_id === null && ev.type === 'content_block_delta' && ev.delta.type === 'text_delta' && ev.delta.text) {
              streamed = true;
              yield { type: 'text-delta', text: ev.delta.text };
            }
          } else if (msg.type === 'assistant' && msg.parent_tool_use_id === null) {
            if (msg.error) failure = AUTH_ERRORS.has(msg.error) ? `access problem (${msg.error})` : msg.error;
            for (const block of msg.message.content) {
              if (block.type === 'text' && !streamed && block.text) yield { type: 'text-delta', text: block.text };
              else if (block.type === 'tool_use' && block.name.startsWith(`mcp__${MCP_SERVER_NAME}__`)) {
                const name = block.name.slice(`mcp__${MCP_SERVER_NAME}__`.length);
                names.set(block.id, name);
                yield { type: 'tool-call', id: block.id, name, input: block.input };
              }
            }
            streamed = false;
          } else if (msg.type === 'user' && msg.parent_tool_use_id === null && Array.isArray(msg.message.content)) {
            for (const block of msg.message.content) {
              if (block.type !== 'tool_result') continue;
              const name = names.get(block.tool_use_id);
              if (!name) continue;
              const r = completed.get(name)?.shift();
              yield { type: 'tool-result', id: block.tool_use_id, name, ok: r ? r.ok : !block.is_error, summary: clip(r?.summary ?? 'Done', 300) };
            }
          } else if (msg.type === 'result') {
            usage = usageOf(msg);
            if (msg.subtype !== 'success' || msg.is_error) {
              const detail = msg.subtype === 'success' ? msg.result : (msg.errors ?? []).join('; ');
              failure = failure ?? (detail || msg.subtype);
            }
          }
        }
        if (usage) yield { type: 'usage', usage };
        if (request.signal?.aborted) return yield { type: 'error', code: 'CANCELLED', message: 'Cancelled' };
        if (failure) return yield { type: 'error', code: 'AI_PROVIDER_ERROR', message: clip(scrub(failure, key), 300) };
        const meta: AiMeta = { model: request.model, provider: 'claude-agent-sdk', date: new Date().toISOString(), source: 'chat' };
        yield { type: 'done', meta };
      } catch (e) {
        if (request.signal?.aborted || abort.signal.aborted) return yield { type: 'error', code: 'CANCELLED', message: 'Cancelled' };
        const base = e instanceof Error ? e.message : 'Claude could not be reached';
        const tail = stderrTail.trim().split(/\r?\n/).at(-1) ?? '';
        yield { type: 'error', code: 'AI_PROVIDER_ERROR', message: clip(scrub(tail ? `${base}: ${tail}` : base, key), 300) };
      } finally {
        request.signal?.removeEventListener('abort', onAbort);
        // The SDK started a Claude Code process: it ends with the turn, nothing stays resident.
        try {
          q?.close();
        } catch {
          /* already closed */
        }
      }
    },

    async completeStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
      const key = await getKey();
      const sdk = await loadSdk();
      await mkdir(options.workDir, { recursive: true });
      const jsonSchema = z.toJSONSchema(request.schema) as Record<string, unknown>;
      const system = `${request.system}\nAnswer with a single JSON value that matches the requested schema and nothing else.`;
      let lastIssue = '';
      let total: TokenUsage = { inputTokens: 0, outputTokens: 0 };
      for (let attempt = 0; attempt < 2; attempt++) {
        const abort = new AbortController();
        const onAbort = () => abort.abort();
        request.signal?.addEventListener('abort', onAbort, { once: true });
        if (request.signal?.aborted) throw new AppError('CANCELLED', 'Cancelled');
        const q = sdk.query({
          prompt: attempt === 0 ? request.prompt : `${request.prompt}\n\nYour previous answer was invalid (${lastIssue}). Answer again with valid JSON only.`,
          options: buildQueryOptions({
            model: request.model,
            reasoning: request.reasoning,
            systemPrompt: system,
            cwd: options.workDir,
            abortController: abort,
            apiKey: key,
            baseEnv: env(),
            executable: executable(),
            ...(options.clientApp ? { clientApp: options.clientApp } : {}),
            maxTurns: 3,
            outputFormat: { type: 'json_schema', schema: jsonSchema },
          }),
        });
        let raw: unknown;
        let failure: string | null = null;
        try {
          for await (const msg of q) {
            if (msg.type !== 'result') continue;
            const u = usageOf(msg);
            total = { inputTokens: total.inputTokens + u.inputTokens, outputTokens: total.outputTokens + u.outputTokens };
            if (msg.subtype === 'success' && !msg.is_error) {
              raw = msg.structured_output ?? msg.result;
            } else failure = msg.subtype === 'success' ? msg.result : (msg.errors ?? []).join('; ') || msg.subtype;
          }
        } catch (e) {
          if (request.signal?.aborted) throw new AppError('CANCELLED', 'Cancelled');
          throw new AppError('AI_PROVIDER_ERROR', clip(scrub(e instanceof Error ? e.message : 'Claude could not be reached', key), 300));
        } finally {
          request.signal?.removeEventListener('abort', onAbort);
          try {
            q.close();
          } catch {
            /* already closed */
          }
        }
        if (request.signal?.aborted) throw new AppError('CANCELLED', 'Cancelled');
        if (failure) throw new AppError('AI_PROVIDER_ERROR', clip(scrub(failure, key), 300));
        let candidate = raw;
        if (typeof candidate === 'string') {
          try {
            candidate = JSON.parse(candidate.replace(/^```(?:json)?\s*|\s*```$/g, ''));
          } catch {
            lastIssue = 'not JSON';
            continue;
          }
        }
        const parsed = request.schema.safeParse(candidate);
        if (parsed.success) {
          return { value: parsed.data, usage: total, meta: { model: request.model, provider: 'claude-agent-sdk', date: new Date().toISOString(), source: request.source } };
        }
        lastIssue = parsed.error.issues.slice(0, 3).map((x) => `${x.path.join('.') || 'value'}: ${x.message}`).join('; ');
      }
      throw new AppError('AI_PROVIDER_ERROR', `The answer did not match the schema (${clip(lastIssue, 200)})`);
    },

    estimateCost(request) {
      return estimateCostFromModels(models, request);
    },

    async isAvailable() {
      if (executable() === null) return false;
      return (await access()).auth !== 'none';
    },

    access,
  };
}

