import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ChatEvent, ToolSpec } from '@rl/core';
import {
  BUILTIN_TOOLS_DISALLOWED,
  buildQueryOptions,
  createClaudeProvider,
  detectAccess,
  effortFor,
  renderPrompt,
  resolveClaudeExecutable,
  type SdkModule,
} from './claude.js';

const KEY = 'sk-ant-api03-SECRET-KEY-VALUE';
const base = { model: 'claude-haiku-5-5', reasoning: 'medium' as const, systemPrompt: 'guide', cwd: '/app/ai-work', abortController: new AbortController(), apiKey: null, baseEnv: { PATH: '/bin' } };

describe('buildQueryOptions', () => {
  const o = buildQueryOptions({ ...base, toolNames: ['mcp__rl__search_library'], executable: '/x/claude', maxTurns: 5 });

  it('gives the agent only our tools: no built-ins, deny by default, no prompt anywhere', () => {
    expect(o.tools).toEqual([]);
    for (const t of ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task']) expect(o.disallowedTools).toContain(t);
    expect(o.disallowedTools).toEqual([...BUILTIN_TOOLS_DISALLOWED]);
    expect(o.allowedTools).toEqual(['mcp__rl__search_library']);
    expect(o.permissionMode).toBe('dontAsk');
    expect(o.permissionPrompts).toBe('none');
    expect(o.strictMcpConfig).toBe(true);
  });

  it('loads no user settings, uses our prompt, an empty cwd, no session file', () => {
    expect(o.settingSources).toEqual([]);
    expect(o.systemPrompt).toBe('guide');
    expect(o.cwd).toBe('/app/ai-work');
    expect(o.persistSession).toBe(false);
    expect(o.includePartialMessages).toBe(true);
    expect(o.pathToClaudeCodeExecutable).toBe('/x/claude');
    expect(o.maxTurns).toBe(5);
  });

  it('maps the reasoning level to effort and passes the model', () => {
    expect(o.model).toBe('claude-haiku-5-5');
    expect(o.effort).toBe('medium');
    expect(['low', 'medium', 'high'].map((l) => effortFor(l as 'low'))).toEqual(['low', 'medium', 'high']);
  });

  it('puts the key only in env, never elsewhere, and drops test hooks from the child env', () => {
    const withKey = buildQueryOptions({ ...base, apiKey: KEY, baseEnv: { PATH: '/bin', RL_AI_PROVIDER: 'mock', ELECTRON_RUN_AS_NODE: '1', HOME: '/h' } });
    expect(withKey.env?.ANTHROPIC_API_KEY).toBe(KEY);
    expect(withKey.env).toMatchObject({ PATH: '/bin', HOME: '/h' });
    expect(Object.keys(withKey.env!).some((k) => /^(RL_|ELECTRON_)/.test(k))).toBe(false);
    const { env: _env, abortController: _a, ...rest } = withKey;
    expect(JSON.stringify(rest)).not.toContain(KEY);
    expect(buildQueryOptions(base).env?.ANTHROPIC_API_KEY).toBeUndefined();
  });
});

describe('executable and access', () => {
  const exists = (set: string[]) => (p: string) => set.includes(p);
  it('prefers the configured path, then PATH, then ~/.local/bin, then the bundled one', () => {
    const common = { platform: 'linux' as const, env: { PATH: '/usr/bin:/opt/bin' }, home: '/home/u', bundled: () => '/pkg/claude' };
    expect(resolveClaudeExecutable({ ...common, configured: '/c/claude', exists: exists(['/c/claude', '/opt/bin/claude']) })).toBe('/c/claude');
    expect(resolveClaudeExecutable({ ...common, exists: exists(['/opt/bin/claude', '/home/u/.local/bin/claude']) })).toBe('/opt/bin/claude');
    expect(resolveClaudeExecutable({ ...common, exists: exists(['/home/u/.local/bin/claude']) })).toBe('/home/u/.local/bin/claude');
    expect(resolveClaudeExecutable({ ...common, exists: exists([]) })).toBe('/pkg/claude');
    expect(resolveClaudeExecutable({ ...common, bundled: () => null, exists: exists([]) })).toBeNull();
  });

  it('on Windows looks for claude.exe', () => {
    const p = resolveClaudeExecutable({ platform: 'win32', env: { PATH: 'C:\\bin;C:\\tools' }, home: 'C:\\Users\\u', exists: (x) => x === 'C:\\tools\\claude.exe', bundled: () => null });
    expect(p).toBe('C:\\tools\\claude.exe');
  });

  it('detects the access without reading secrets', () => {
    const none = { apiKey: null, env: {}, home: '/h', exists: () => false };
    expect(detectAccess(none)).toEqual({ auth: 'none' });
    expect(detectAccess({ ...none, apiKey: 'k' })).toEqual({ auth: 'api-key' });
    expect(detectAccess({ ...none, env: { ANTHROPIC_API_KEY: 'k' } })).toEqual({ auth: 'api-key' });
    expect(detectAccess({ ...none, env: { CLAUDE_CODE_OAUTH_TOKEN: 't' } })).toEqual({ auth: 'claude-code' });
    expect(detectAccess({ ...none, exists: (p) => p.replaceAll('\\', '/').endsWith('/h/.claude/.credentials.json') })).toEqual({ auth: 'claude-code' });
  });
});

describe('renderPrompt', () => {
  it('is the bare message without history, a labelled transcript with it, and needs a last user message', () => {
    expect(renderPrompt([{ role: 'user', content: 'hi' }])).toBe('hi');
    const p = renderPrompt([{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' }]);
    expect(p).toContain('User: q1');
    expect(p).toContain('Assistant: a1');
    expect(p.endsWith('q2')).toBe(true);
    expect(() => renderPrompt([{ role: 'assistant', content: 'x' }])).toThrow();
  });
});

/* A fake SDK: records the call, replays scripted messages. */
function fakeSdk(messages: unknown[], hooks: { onQuery?: (p: any) => void; closed?: { n: number }; handler?: (call: (args: unknown) => Promise<any>) => Promise<void> } = {}) {
  let captured: any = null;
  const sdk = {
    tool: (name: string, description: string, shape: unknown, handler: (a: unknown) => Promise<any>) => ({ name, description, inputSchema: shape, handler }),
    createSdkMcpServer: (o: any) => ({ type: 'sdk', name: o.name, tools: o.tools }),
    query: (params: any) => {
      captured = params;
      hooks.onQuery?.(params);
      const it = (async function* () {
        if (hooks.handler) await hooks.handler((a) => params.options.mcpServers.rl.tools[0].handler(a));
        for (const m of messages) yield m;
      })();
      return Object.assign(it, { close: () => void (hooks.closed && hooks.closed.n++) });
    },
  } as unknown as SdkModule;
  return { sdk, captured: () => captured };
}

const toolSpec: ToolSpec = {
  name: 'search_library',
  description: 'search',
  input: z.object({ query: z.string() }),
  writes: false,
  run: async () => ({ summary: 'Searched: 1 document(s)', docIds: ['0000000000000001'], data: { total: 1 } }),
};
const resultMsg = (extra: Record<string, unknown> = {}) => ({
  type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.0123, usage: { input_tokens: 10, output_tokens: 5 },
  modelUsage: { m: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 50, cacheCreationInputTokens: 0 } }, ...extra,
});
const collect = async (it: AsyncIterable<ChatEvent>) => {
  const out: ChatEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
};
const mk = (sdk: SdkModule, extra: Record<string, unknown> = {}) =>
  createClaudeProvider({ workDir: process.cwd(), loadSdk: async () => sdk, env: { PATH: '' }, home: '/h', exists: () => true, bundled: () => '/pkg/claude', getApiKey: async () => KEY, ...extra });

describe('claude provider chat', () => {
  it('turns SDK messages into the ChatEvent sequence and closes the process', async () => {
    const closed = { n: 0 };
    const { sdk, captured } = fakeSdk(
      [
        { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } } },
        { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } } },
        { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Hello' }, { type: 'tool_use', id: 'tu1', name: 'mcp__rl__search_library', input: { query: 'x' } }] } },
        { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [] }] } },
        { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Done.' }] } },
        resultMsg(),
      ],
      { closed, handler: async (call) => void (await call({ query: 'x' })) },
    );
    const events = await collect(mk(sdk).chat({ model: 'claude-haiku-5-5', reasoning: 'high', system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: [toolSpec] }));
    expect(events.map((e) => e.type)).toEqual(['text-delta', 'text-delta', 'tool-call', 'tool-result', 'text-delta', 'usage', 'done']);
    expect(events[2]).toMatchObject({ name: 'search_library', id: 'tu1', input: { query: 'x' } });
    expect(events[3]).toMatchObject({ ok: true, summary: 'Searched: 1 document(s)' });
    expect(events[4]).toMatchObject({ text: 'Done.' }); // a message that was not streamed is emitted whole
    expect(events[5]).toMatchObject({ usage: { inputTokens: 150, outputTokens: 20, cachedInputTokens: 50, costUsd: 0.0123 } });
    expect(closed.n).toBe(1);
    const o = captured().options;
    expect(captured().prompt).toBe('hi');
    expect(o.effort).toBe('high');
    expect(o.tools).toEqual([]);
    expect(o.allowedTools).toEqual(['mcp__rl__search_library']);
    expect(o.env.ANTHROPIC_API_KEY).toBe(KEY);
    expect(o.pathToClaudeCodeExecutable).toMatch(/claude(.exe)?$/);
  });

  it('reports failures without the key, and cancellation as CANCELLED', async () => {
    const failing = fakeSdk([resultMsg({ subtype: 'error_during_execution', is_error: true, errors: [`bad key ${KEY}`] })]);
    const ev = await collect(mk(failing.sdk).chat({ model: 'm', reasoning: 'low', system: '', messages: [{ role: 'user', content: 'x' }] }));
    const last = ev.at(-1)!;
    expect(last).toMatchObject({ type: 'error', code: 'AI_PROVIDER_ERROR' });
    expect(JSON.stringify(ev)).not.toContain(KEY);

    const ac = new AbortController();
    const slow = fakeSdk([], { handler: async () => { ac.abort(); throw new Error('aborted'); } });
    const ev2 = await collect(mk(slow.sdk).chat({ model: 'm', reasoning: 'low', system: '', messages: [{ role: 'user', content: 'x' }], signal: ac.signal }));
    expect(ev2.at(-1)).toMatchObject({ type: 'error', code: 'CANCELLED' });
  });

  it('passes what is left of the cap as maxBudgetUsd and maps a budget stop to AI_BUDGET_EXCEEDED', async () => {
    const stopped = fakeSdk([resultMsg({ subtype: 'error_max_budget_usd', is_error: true, errors: [] })]);
    const ev = await collect(mk(stopped.sdk).chat({ model: 'm', reasoning: 'low', system: '', messages: [{ role: 'user', content: 'x' }], maxBudgetUsd: 0.25 }));
    expect(stopped.captured().options.maxBudgetUsd).toBe(0.25);
    expect(ev.at(-1)).toMatchObject({ type: 'error', code: 'AI_BUDGET_EXCEEDED' });
    const free = fakeSdk([resultMsg()]);
    await collect(mk(free.sdk).chat({ model: 'm', reasoning: 'low', system: '', messages: [{ role: 'user', content: 'x' }] }));
    expect(free.captured().options.maxBudgetUsd).toBeUndefined();
  });

  it('an access error of the assistant message ends the turn with AI_PROVIDER_ERROR', async () => {
    const { sdk } = fakeSdk([{ type: 'assistant', parent_tool_use_id: null, error: 'authentication_failed', message: { content: [] } }, resultMsg()]);
    const ev = await collect(mk(sdk).chat({ model: 'm', reasoning: 'low', system: '', messages: [{ role: 'user', content: 'x' }] }));
    expect(ev.at(-1)).toMatchObject({ type: 'error', code: 'AI_PROVIDER_ERROR' });
  });
});

describe('claude provider structured output and availability', () => {
  const schema = z.object({ tags: z.array(z.string()) });
  const req = { model: 'm', reasoning: 'low' as const, system: 's', prompt: 'p', schema, source: 'cmd' };

  it('validates the structured output and retries once', async () => {
    let calls = 0;
    const sdk = {
      ...fakeSdk([]).sdk,
      query: (params: any) => {
        calls++;
        const out = calls === 1 ? { wrong: true } : { tags: ['a'] };
        expect(params.options.tools).toEqual([]);
        expect(params.options.outputFormat.type).toBe('json_schema');
        expect(params.options.outputFormat.schema).not.toHaveProperty('$schema');
        expect(params.options.outputFormat.schema).toMatchObject({ type: 'object' });
        return Object.assign((async function* () { yield resultMsg({ structured_output: out }); })(), { close() {} });
      },
    } as unknown as SdkModule;
    const r = await mk(sdk).completeStructured(req);
    expect(r.value).toEqual({ tags: ['a'] });
    expect(calls).toBe(2);
    expect(r.meta).toMatchObject({ provider: 'claude-agent-sdk', source: 'cmd' });
  });

  it('fails after the second invalid answer', async () => {
    const sdk = { ...fakeSdk([]).sdk, query: () => Object.assign((async function* () { yield resultMsg({ structured_output: 1 }); })(), { close() {} }) } as unknown as SdkModule;
    await expect(mk(sdk).completeStructured(req)).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' });
  });

  it('isAvailable needs an executable and a credential, and spends nothing', async () => {
    const noQuery = { ...fakeSdk([]).sdk, query: () => { throw new Error('must not be called'); } } as unknown as SdkModule;
    expect(await mk(noQuery).isAvailable()).toBe(true);
    expect(await mk(noQuery, { getApiKey: async () => null, exists: () => false, bundled: () => null }).isAvailable()).toBe(false);
    expect(await mk(noQuery, { getApiKey: async () => null, exists: (p: string) => !p.endsWith('.credentials.json') }).isAvailable()).toBe(false);
    expect(await mk(noQuery, { getApiKey: async () => null }).access()).toEqual({ auth: 'claude-code' });
  });

  it('estimates the cost from the price hints', () => {
    const e = mk(fakeSdk([]).sdk).estimateCost({ model: 'claude-sonnet-5-5', promptChars: 4_000_000, expectedOutputTokens: 1_000_000 });
    expect(e).toMatchObject({ inputTokens: 1_000_000, outputTokens: 1_000_000, usd: 12 });
    expect(mk(fakeSdk([]).sdk).estimateCost({ model: 'unknown', promptChars: 4 }).usd).toBeNull();
  });
});

const BS = String.fromCharCode(92);
const win = (...parts: string[]) => parts.join(BS);

describe('hardening of the child process and of error text', () => {
  it('child env is an allow-list: what the CLI needs stays, NODE_OPTIONS and the rest never reach it', () => {
    const o = buildQueryOptions({
      ...base,
      apiKey: KEY,
      baseEnv: {
        Path: win('C:', 'bin'), SystemRoot: win('C:', 'Windows'), TEMP: win('C:', 't'), USERPROFILE: win('C:', 'usr'), APPDATA: win('C:', 'a'), LOCALAPPDATA: win('C:', 'l'), ProgramData: win('C:', 'p'), HTTPS_PROXY: 'http://p:1', CLAUDE_CODE_OAUTH_TOKEN: 'tok', LC_ALL: 'C',
        NODE_OPTIONS: '--require x', NODE_PATH: '/n', GITHUB_TOKEN: 'g', AWS_SECRET_ACCESS_KEY: 's', RL_E2E: '1', ELECTRON_RUN_AS_NODE: '1', LD_PRELOAD: 'x',
      },
    });
    expect(Object.keys(o.env!).sort()).toEqual(['ANTHROPIC_API_KEY', 'APPDATA', 'CLAUDE_AGENT_SDK_CLIENT_APP', 'CLAUDE_CODE_OAUTH_TOKEN', 'HTTPS_PROXY', 'LC_ALL', 'LOCALAPPDATA', 'Path', 'ProgramData', 'SystemRoot', 'TEMP', 'USERPROFILE']);
  });

  it('skips relative PATH entries when looking for the executable', () => {
    const seen: string[] = [];
    const r = resolveClaudeExecutable({ platform: 'linux', env: { PATH: 'bin:./tools::/opt/bin' }, home: '/h', exists: (p) => (seen.push(p), p === '/opt/bin/claude'), bundled: () => null });
    expect(r).toBe('/opt/bin/claude');
    expect(seen.some((p) => p.startsWith('bin') || p.startsWith('./'))).toBe(false);
    const ok = win('C:', 'ok');
    const w = resolveClaudeExecutable({ platform: 'win32', env: { PATH: `.;tools;${ok}` }, home: win('C:', 'h'), exists: (p) => /^(tools|\.)/.test(p) || p === win(ok, 'claude.exe'), bundled: () => null });
    expect(w).toBe(win(ok, 'claude.exe'));
  });

  it('scrubs the key, tokens and absolute paths from the error text; the full detail goes to the local hook only', async () => {
    const detail: string[] = [];
    const leaky = `spawn ${win('C:', 'Profiles', 'someone', 'bin', 'claude.exe')} ENOENT; also /srv/someone/bin/claude and ${BS}${win('', 'host', 'share', 'x')}, Bearer abcdefghijklmnop, ${KEY}, ${'a1'.repeat(20)}`;
    const sdk = { ...fakeSdk([]).sdk, query: () => Object.assign((async function* () { throw new Error(leaky); })(), { close() {} }) } as unknown as SdkModule;
    const err = await mk(sdk, { onErrorDetail: (d: string) => detail.push(d) }).completeStructured({ model: 'm', reasoning: 'low', system: 's', prompt: 'p', schema: z.object({}), source: 'c' }).catch((e: unknown) => e as any);
    expect(err.message).not.toMatch(/someone|share|abcdefghijklmnop|SECRET|a1a1a1/);
    expect(err.message).toContain('[path]');
    expect(detail[0]).toContain('someone');
    expect(detail[0]).not.toContain(KEY);
    const events = await collect(mk({ ...fakeSdk([]).sdk, query: () => Object.assign((async function* () { throw new Error(leaky); })(), { close() {} }) } as unknown as SdkModule).chat({ model: 'm', reasoning: 'low', system: 's', messages: [{ role: 'user', content: 'hi' }] }));
    const e = events.find((x) => x.type === 'error') as { message: string };
    expect(e.message).not.toMatch(/someone|abcdefghijklmnop|SECRET/);
  });

  it('structured results carry the provider cost and the tokens of every attempt; errors carry them and whether anything was sent', async () => {
    let n = 0;
    const sdk = {
      ...fakeSdk([]).sdk,
      query: () => Object.assign((async function* () { yield resultMsg({ structured_output: ++n === 1 ? { bad: 1 } : { tags: ['a'] } }); })(), { close() {} }),
    } as unknown as SdkModule;
    const r = await mk(sdk).completeStructured({ model: 'm', reasoning: 'low', system: 's', prompt: 'p', schema: z.object({ tags: z.array(z.string()) }), source: 'c' });
    expect(r.usage.costUsd).toBeCloseTo(0.0246, 6);
    expect(r.usage.inputTokens).toBe(300);
    const bad = { ...fakeSdk([]).sdk, query: () => Object.assign((async function* () { yield resultMsg({ structured_output: 1 }); })(), { close() {} }) } as unknown as SdkModule;
    const e = await mk(bad).completeStructured({ model: 'm', reasoning: 'low', system: 's', prompt: 'p', schema: z.object({ tags: z.array(z.string()) }), source: 'c' }).catch((x: unknown) => x as any);
    expect(e.details).toMatchObject({ sent: true, usage: { inputTokens: 300, costUsd: expect.any(Number) } });
    const never = { ...fakeSdk([]).sdk, query: () => Object.assign((async function* () { throw new Error('spawn failed'); })(), { close() {} }) } as unknown as SdkModule;
    const e2 = await mk(never).completeStructured({ model: 'm', reasoning: 'low', system: 's', prompt: 'p', schema: z.object({}), source: 'c' }).catch((x: unknown) => x as any);
    expect(e2.details).toMatchObject({ sent: false });
  });
});

describe('authMode', () => {
  const env = { PATH: '/bin', ANTHROPIC_API_KEY: 'env-key', CLAUDE_CODE_OAUTH_TOKEN: 'tok' };
  it('claude-code: no API key reaches the child, the login token does', () => {
    const o = buildQueryOptions({ ...base, apiKey: KEY, baseEnv: env, authMode: 'claude-code' });
    expect(o.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(o.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe('tok');
  });
  it('api-key: no login token reaches the child, the stored key does', () => {
    const o = buildQueryOptions({ ...base, apiKey: KEY, baseEnv: env, authMode: 'api-key' });
    expect(o.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(o.env?.ANTHROPIC_API_KEY).toBe(KEY);
  });
  it('auto keeps the environment as it is', () => {
    const o = buildQueryOptions({ ...base, apiKey: null, baseEnv: env });
    expect(o.env?.ANTHROPIC_API_KEY).toBe('env-key');
    expect(o.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe('tok');
  });
  it('access follows the mode', () => {
    const l = { apiKey: 'k', env: { CLAUDE_CODE_OAUTH_TOKEN: 't' }, home: '/h', exists: () => false };
    expect(detectAccess({ ...l, authMode: 'claude-code' })).toEqual({ auth: 'claude-code' });
    expect(detectAccess({ ...l, authMode: 'api-key' })).toEqual({ auth: 'api-key' });
    expect(detectAccess({ ...l, apiKey: null, authMode: 'api-key' })).toEqual({ auth: 'none' });
    expect(detectAccess({ apiKey: 'k', env: {}, home: '/h', exists: () => false, authMode: 'claude-code' })).toEqual({ auth: 'none' });
  });
  it('the provider does not read the stored key in claude-code mode', async () => {
    let read = 0;
    const p = createClaudeProvider({ workDir: '/w', getApiKey: async () => (read++, 'k'), getAuthMode: () => 'claude-code', env: { CLAUDE_CODE_OAUTH_TOKEN: 't' }, exists: () => false });
    expect(await p.access()).toEqual({ auth: 'claude-code' });
    expect(read).toBe(0);
  });
});
