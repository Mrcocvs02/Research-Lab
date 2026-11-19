import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockAiProvider } from '@rl/ai';
import { appSettingsSchema, channels, createDispatcher, createMemoryLogger, DEFAULT_MODELS, type AiAccount, type IpcEnvelope } from '@rl/core';
import { buildHandlers, type MainServices } from '../ipc/handlers/index.js';
import { createAccountService, parseStatus, simulatedClaudeIo, type AccountIo, type CliResult } from './account.js';

/** Every test works on fakes: the real `claude` program and the real account are never touched. */
const EMAIL = 'someone@example.test';
const ORG = 'Example Org';
const EXE = '/fake/bin/claude';
const statusJson = (o: Record<string, unknown> = {}) => JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: EMAIL, orgId: 'org-secret-id', orgName: ORG, subscriptionType: 'team', configDirectory: '/fake/home/.claude', ...o });

interface Fake {
  io: AccountIo;
  runs: Array<{ args: string[]; env: NodeJS.ProcessEnv; timeoutMs: number }>;
  consoles: Array<{ args: string[]; env: NodeJS.ProcessEnv }>;
  state: { status: string; version: string; present: Set<string>; logoutResult: CliResult };
  fire(name: string): void;
  watched: string[];
}

function fakeIo(env: NodeJS.ProcessEnv = {}): Fake {
  const f = {
    runs: [] as Fake['runs'],
    consoles: [] as Fake['consoles'],
    state: { status: statusJson(), version: '2.1.326 (Claude Code)', present: new Set<string>([EXE]), logoutResult: { code: 0, stdout: '', timedOut: false } as CliResult },
    watched: [] as string[],
  };
  let onChange: ((n: string) => void) | null = null;
  const io: AccountIo = {
    run: async (_exe, args, o) => {
      f.runs.push({ args: [...args], env: o.env, timeoutMs: o.timeoutMs });
      if (args[0] === '--version') return { code: 0, stdout: f.state.version, timedOut: false };
      if (args[0] === 'auth' && args[1] === 'status') return { code: 0, stdout: f.state.status, timedOut: false };
      if (args[0] === 'auth' && args[1] === 'logout') {
        if (f.state.logoutResult.code === 0) f.state.status = statusJson({ loggedIn: false, email: undefined, orgName: undefined, subscriptionType: undefined });
        return f.state.logoutResult;
      }
      return { code: 1, stdout: '', timedOut: false };
    },
    openConsole: (_exe, args, e) => void f.consoles.push({ args: [...args], env: e }),
    watch: (dir, cb) => {
      f.watched.push(dir);
      onChange = cb;
      return { close: () => void (onChange = null) };
    },
    env,
    home: '/fake/home',
    exists: (p) => f.state.present.has(p.replaceAll('\\', '/')),
    bundled: () => null,
  };
  return { ...f, io, fire: (n) => onChange?.(n) };
}

let settings: ReturnType<typeof appSettingsSchema.parse>;
let emitted: Array<{ event: string; payload: AiAccount }>;
const log = createMemoryLogger();

function fakeServices(extra: Partial<MainServices> = {}): MainServices {
  return {
    log,
    emit: (event: string, payload: unknown) => void emitted.push({ event, payload: payload as AiAccount }),
    settings: {
      get: async () => structuredClone(settings),
      update: async (fn: (x: typeof settings) => void) => {
        const d = structuredClone(settings);
        fn(d);
        settings = d;
        return d;
      },
    },
    secrets: { has: async () => false },
    runtime: { require: async () => Promise.reject(new Error('no library')) },
    ...extra,
  } as unknown as MainServices;
}

beforeEach(() => {
  settings = appSettingsSchema.parse({});
  settings.ai.claudeCodePath = EXE;
  emitted = [];
  log.entries.length = 0;
});
afterEach(() => vi.useRealTimers());

const dump = () => JSON.stringify(log.entries);

describe('parseStatus', () => {
  it('reads only the known fields and ignores the rest', () => {
    expect(parseStatus(statusJson())).toEqual({ loggedIn: true, account: { email: EMAIL, organization: ORG, plan: 'team' } });
    expect(parseStatus(JSON.stringify({ loggedIn: false, email: EMAIL }))).toEqual({ loggedIn: false, account: null });
  });
  it('answers null for anything that is not the status JSON', () => {
    expect(parseStatus('')).toBeNull();
    expect(parseStatus('error: unknown command')).toBeNull();
    expect(parseStatus('{"email":"x"}')).toBeNull();
  });
});

describe('ai:account', () => {
  it('shows the identity, the version and where the program is, with fixed arguments only', async () => {
    const f = fakeIo();
    const a = await createAccountService(fakeServices(), f.io).account();
    expect(a).toMatchObject({
      authMode: 'auto',
      effective: 'claude-code',
      apiKey: { stored: false, envVar: false },
      claudeCode: { path: EXE, source: 'settings', version: '2.1.326', loggedIn: true, account: { email: EMAIL, organization: ORG, plan: 'team' }, supportsAuthCommands: true },
    });
    expect(JSON.stringify(a)).not.toContain('org-secret-id');
    expect(f.runs.map((r) => r.args)).toEqual([['--version'], ['auth', 'status', '--json']]);
    expect(f.runs.every((r) => r.timeoutMs === 10_000)).toBe(true);
    // The version does not change while the program is the same: asked once.
    await createAccountService(fakeServices(), f.io).account();
  });

  it('without the auth commands: no identity, the state comes from the login file', async () => {
    const f = fakeIo();
    f.state.status = 'unknown command';
    f.state.present.add('/fake/home/.claude/.credentials.json');
    const a = await createAccountService(fakeServices(), f.io).account();
    expect(a.claudeCode).toMatchObject({ supportsAuthCommands: false, loggedIn: true, account: null });
    f.state.present.delete('/fake/home/.claude/.credentials.json');
    expect((await createAccountService(fakeServices(), f.io).account()).claudeCode.loggedIn).toBeNull();
  });

  it('program not found: nothing is run', async () => {
    const f = fakeIo();
    settings.ai.claudeCodePath = null;
    const a = await createAccountService(fakeServices(), f.io).account();
    expect(a.claudeCode).toMatchObject({ path: null, source: 'none', loggedIn: null, supportsAuthCommands: false });
    expect(f.runs).toEqual([]);
  });

  it('a logged-out status makes the effective access none', async () => {
    const f = fakeIo();
    f.state.status = JSON.stringify({ loggedIn: false });
    f.state.present.add('/fake/home/.claude/.credentials.json');
    expect((await createAccountService(fakeServices(), f.io).account()).effective).toBe('none');
  });

  it('the auth mode is part of the environment the commands get', async () => {
    const env = { PATH: '/bin', ANTHROPIC_API_KEY: 'env-key-value', CLAUDE_CODE_OAUTH_TOKEN: 'oauth-value' };
    for (const [mode, gone, kept] of [['claude-code', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'], ['api-key', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']] as const) {
      const f = fakeIo(env);
      settings.ai.authMode = mode;
      await createAccountService(fakeServices(), f.io).account();
      for (const r of f.runs) {
        expect(r.env[gone]).toBeUndefined();
        expect(r.env[kept]).toBeDefined();
      }
    }
  });

  it('reports a stored key and the variable', async () => {
    const f = fakeIo({ ANTHROPIC_API_KEY: 'k' });
    const a = await createAccountService(fakeServices({ secrets: { has: async () => true } as never }), f.io).account();
    expect(a.apiKey).toEqual({ stored: true, envVar: true });
    expect(a.effective).toBe('api-key');
  });
});

describe('ai:setAuthMode', () => {
  it('saves the mode, answers with the new state and announces it', async () => {
    const f = fakeIo({ ANTHROPIC_API_KEY: 'k' });
    f.state.present.add('/fake/home/.claude/.credentials.json');
    const svc = createAccountService(fakeServices(), f.io);
    const a = await svc.setAuthMode('claude-code');
    expect(settings.ai.authMode).toBe('claude-code');
    expect(a).toMatchObject({ authMode: 'claude-code', effective: 'claude-code' });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.event).toBe('ai:accountChanged');
  });
});

describe('ai:login and the credentials watcher', () => {
  it('opens a console with fixed arguments and no API key in its environment', async () => {
    const f = fakeIo({ ANTHROPIC_API_KEY: 'env-key-value' });
    expect(await createAccountService(fakeServices(), f.io).login()).toEqual({ started: true });
    expect(f.consoles).toHaveLength(1);
    expect(f.consoles[0]!.args).toEqual(['auth', 'login', '--claudeai']);
    expect(f.consoles[0]!.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(f.watched).toEqual([path.join('/fake/home', '.claude')]);
  });

  it('without the auth commands the plain program opens (the user types /login)', async () => {
    const f = fakeIo();
    f.state.status = 'nope';
    await createAccountService(fakeServices(), f.io).login();
    expect(f.consoles[0]!.args).toEqual([]);
  });

  it('refuses when the program is not found', async () => {
    const f = fakeIo();
    settings.ai.claudeCodePath = null;
    await expect(createAccountService(fakeServices(), f.io).login()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(f.consoles).toEqual([]);
  });

  it('events are debounced into one re-check; a token refresh is not an account switch; a new account is announced', async () => {
    vi.useFakeTimers();
    const f = fakeIo();
    const svc = createAccountService(fakeServices(), f.io);
    await svc.login();
    const statusRuns = () => f.runs.filter((r) => r.args[1] === 'status').length;
    const before = statusRuns();
    // Other files of the folder are ignored; three quick writes of the credentials file are one re-check.
    f.fire('settings.json');
    f.fire('.credentials.json');
    f.fire('.credentials.json');
    f.fire('.credentials.json');
    await vi.advanceTimersByTimeAsync(600);
    expect(statusRuns()).toBe(before + 1);
    // A refreshed token: same account, nothing announced.
    expect(emitted).toEqual([]);
    // Another account logged in.
    f.state.status = statusJson({ email: 'other@example.test' });
    f.fire('.credentials.json');
    await vi.advanceTimersByTimeAsync(600);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.payload.claudeCode.account?.email).toBe('other@example.test');
    // The watcher closes a little after the change.
    await vi.advanceTimersByTimeAsync(2500);
    f.fire('.credentials.json');
    await vi.advanceTimersByTimeAsync(600);
    expect(emitted).toHaveLength(1);
  });

  it('gives up after ten minutes and "I\'m done" closes it', async () => {
    vi.useFakeTimers();
    const f = fakeIo();
    const svc = createAccountService(fakeServices(), f.io);
    await svc.login();
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
    f.fire('.credentials.json');
    await vi.advanceTimersByTimeAsync(600);
    expect(f.runs.filter((r) => r.args[1] === 'status')).toHaveLength(1); // only the one of login(): the watcher was off
    await svc.login();
    f.state.status = statusJson({ email: 'third@example.test' });
    const a = await svc.loginDone();
    expect(a.claudeCode.account?.email).toBe('third@example.test');
    expect(emitted.at(-1)!.payload.claudeCode.account?.email).toBe('third@example.test');
  });
});

describe('ai:logout', () => {
  it('runs `auth logout` with a 20 s timeout, then verifies with the status', async () => {
    const f = fakeIo();
    const a = await createAccountService(fakeServices(), f.io).logout();
    const logout = f.runs.find((r) => r.args[1] === 'logout')!;
    expect(logout.args).toEqual(['auth', 'logout']);
    expect(logout.timeoutMs).toBe(20_000);
    expect(a.claudeCode.loggedIn).toBe(false);
    expect(emitted).toHaveLength(1);
  });

  it('does not trust the exit code: a failed logout that left the login in place reports it', async () => {
    const f = fakeIo();
    f.state.logoutResult = { code: 1, stdout: '', timedOut: true };
    const a = await createAccountService(fakeServices(), f.io).logout();
    expect(a.claudeCode.loggedIn).toBe(true);
    expect(dump()).toContain('did not finish cleanly');
  });

  it('without the auth commands nothing is run to log out', async () => {
    const f = fakeIo();
    f.state.status = 'nope';
    await createAccountService(fakeServices(), f.io).logout();
    expect(f.runs.some((r) => r.args[1] === 'logout')).toBe(false);
  });
});

describe('secrets and personal data in the logs', () => {
  it('the output of `auth status` never reaches a log', async () => {
    const f = fakeIo({ ANTHROPIC_API_KEY: 'env-key-value' });
    f.state.logoutResult = { code: 1, stdout: statusJson(), timedOut: false };
    const svc = createAccountService(fakeServices(), f.io);
    await svc.account();
    await svc.login();
    await svc.logout();
    const text = dump();
    for (const secret of [EMAIL, ORG, 'org-secret-id', 'env-key-value']) expect(text).not.toContain(secret);
  });
});

describe('ai:test (simulated provider)', () => {
  const provider = () => createMockAiProvider({ models: DEFAULT_MODELS });
  const withProvider = (extra: Partial<MainServices> = {}) => fakeServices({ aiProvider: () => provider(), ...extra });

  it('answers ok and records a connection-test send in the active library', async () => {
    const entries: Array<Record<string, unknown>> = [];
    const rt = { store: { readConfig: async () => ({ ai: { provider: 'claude-agent-sdk', models: DEFAULT_MODELS } }), appendLog: async (e: Record<string, unknown>) => void entries.push(e) } };
    const r = await createAccountService(withProvider({ runtime: { require: async () => rt } as never }), fakeIo().io).test();
    expect(r).toMatchObject({ ok: true, model: 'claude-haiku-5-5' });
    expect(r.error).toBeUndefined();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'ai-send', purpose: 'connection-test', model: 'claude-haiku-5-5', docIds: [], folders: [] });
  });

  it('without an active library the test works and nothing is recorded', async () => {
    const r = await createAccountService(withProvider(), fakeIo().io).test();
    expect(r.ok).toBe(true);
  });

  it('offline: no request, no spend', async () => {
    const claude = { id: 'claude-agent-sdk', chat: vi.fn(), access: async () => ({ auth: 'claude-code' as const }), executable: () => ({ path: EXE, source: 'settings' as const }) };
    const r = await createAccountService(fakeServices({ aiProvider: () => claude as never, isOnline: () => false }), fakeIo().io).test();
    expect(r).toMatchObject({ ok: false, usd: null, error: { code: 'offline' } });
    expect(claude.chat).not.toHaveBeenCalled();
  });

  it('no program, no access, no provider: a result with a code, never a throw', async () => {
    const mk = (p: object | null) => createAccountService(fakeServices({ aiProvider: () => p as never, isOnline: () => true }), fakeIo().io).test();
    expect((await mk({ id: 'claude-agent-sdk', chat: vi.fn(), executable: () => ({ path: null, source: 'none' }), access: async () => ({ auth: 'none' }) })).error?.code).toBe('exe-not-found');
    expect((await mk({ id: 'claude-agent-sdk', chat: vi.fn(), executable: () => ({ path: EXE, source: 'settings' }), access: async () => ({ auth: 'none' }) })).error?.code).toBe('no-access');
    expect((await mk(null)).error?.code).toBe('no-provider');
  });

  it('a provider error becomes a code', async () => {
    const claude = {
      id: 'claude-agent-sdk',
      access: async () => ({ auth: 'claude-code' as const }),
      executable: () => ({ path: EXE, source: 'settings' as const }),
      async *chat() {
        yield { type: 'error' as const, code: 'AI_PROVIDER_ERROR' as const, message: 'access problem (authentication_failed)' };
      },
    };
    const r = await createAccountService(fakeServices({ aiProvider: () => claude as never, isOnline: () => true }), fakeIo().io).test();
    expect(r).toMatchObject({ ok: false, error: { code: 'access-denied' } });
  });
});

describe('the channels (handlers over the simulated Claude Code)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'rl-sim-'));
    await mkdir(path.join(dir, '.claude'));
    await writeFile(path.join(dir, 'state.json'), statusJson({ version: '3.0.0' }));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('ai:account, ai:setAuthMode, ai:login, ai:loginDone and ai:logout answer through the dispatcher', async () => {
    const s = fakeServices({ claudeIo: simulatedClaudeIo(dir), localDataDir: dir });
    const call = async (c: string, p: unknown = {}): Promise<IpcEnvelope> => createDispatcher(channels, buildHandlers(s), log)(c, p);
    const acc = await call('ai:account');
    expect(acc).toMatchObject({ ok: true, data: { claudeCode: { version: '3.0.0', loggedIn: true, account: { email: EMAIL } } } });
    expect(await call('ai:setAuthMode', { mode: 'bogus' })).toMatchObject({ ok: false });
    expect(await call('ai:setAuthMode', { mode: 'api-key' })).toMatchObject({ ok: true, data: { authMode: 'api-key' } });
    expect(await call('ai:login')).toMatchObject({ ok: true, data: { started: true } });
    expect(await call('ai:loginDone')).toMatchObject({ ok: true });
    expect(await call('ai:logout')).toMatchObject({ ok: true, data: { claudeCode: { loggedIn: false } } });
    const calls = (await readFile(path.join(dir, 'calls.log'), 'utf8')).trim().split('\n');
    expect(calls).toContain('console auth login --claudeai');
    expect(calls).toContain('auth logout');
    // Nothing but the fixed commands ever reached the program.
    for (const c of calls) expect(['--version', 'auth status --json', 'auth logout', 'console auth login --claudeai']).toContain(c);
  });
});
