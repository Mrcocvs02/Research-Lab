import { execFile, spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, watch as fsWatch, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { childEnvFor, claudeCredentialsFile, detectAccess, findClaudeExecutable, usdFor } from '@rl/ai';
import { AppError, DEFAULT_MODELS, type AiAccount, type AiAuthMode } from '@rl/core';
import type { MainServices } from '../ipc/handlers/services.js';
import { API_KEY_SECRET } from './provider-factory.js';

/** `auth status` answers within a second; logout may wait on the network a little longer (D-431). */
const STATUS_TIMEOUT_MS = 10_000;
const LOGOUT_TIMEOUT_MS = 20_000;
/** How long the credentials watcher stays on after "Change account…" (§10.3). */
const WATCH_MS = 10 * 60_000;
const DEBOUNCE_MS = 500;
const MAX_OUT = 64 * 1024;
const TEST_MODEL = 'claude-haiku-5-5';
const TEST_BUDGET_USD = 0.01;

export interface CliResult {
  /** Null when the process could not start or was killed. */
  code: number | null;
  stdout: string;
  timedOut: boolean;
}

/** Everything that touches the machine; tests give fakes, so no test ever runs the real `claude` or reads a real account. */
export interface AccountIo {
  run(exe: string, args: readonly string[], opts: { timeoutMs: number; env: NodeJS.ProcessEnv }): Promise<CliResult>;
  /** Opens a visible console that runs the executable with these fixed arguments. */
  openConsole(exe: string, args: readonly string[], env: NodeJS.ProcessEnv): void;
  /** Watches the folder of the credentials file; `onChange` gets the name of the file that changed. */
  watch(dir: string, onChange: (name: string) => void): { close(): void } | null;
  env: NodeJS.ProcessEnv;
  home: string;
  exists(p: string): boolean;
  bundled?: () => string | null;
}

export const realIo = (): AccountIo => ({
  run: (exe, args, o) =>
    new Promise((resolve) => {
      // No shell, fixed arguments, an allow-listed environment; the output is capped and never logged.
      execFile(exe, [...args], { timeout: o.timeoutMs, env: o.env, windowsHide: true, maxBuffer: MAX_OUT, shell: false }, (err, stdout) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        resolve({ code: e ? (typeof e.code === 'number' ? e.code : null) : 0, stdout: String(stdout ?? ''), timedOut: Boolean(e?.killed) });
      });
    }),
  openConsole(exe, args, env) {
    if (process.platform === 'win32') {
      // `start` runs through cmd.exe: a path with a cmd metacharacter is refused, never escaped.
      if (/[&|<>^%"\r\n]/.test(exe)) throw new AppError('INVALID_REQUEST', 'The Claude Code path cannot be opened in a console');
      spawn('cmd.exe', ['/c', 'start', '""', exe, ...args], { detached: true, windowsHide: false, stdio: 'ignore', env }).unref();
    } else if (process.platform === 'linux') {
      spawn('x-terminal-emulator', ['-e', exe, ...args], { detached: true, stdio: 'ignore', env }).unref();
    } else throw new AppError('NOT_IMPLEMENTED', 'Opening a console is not supported on this system');
  },
  watch(dir, onChange) {
    try {
      const w = fsWatch(dir, { persistent: false }, (_ev, name) => onChange(name ? String(name) : ''));
      w.on('error', () => w.close());
      return w;
    } catch {
      return null;
    }
  },
  env: process.env,
  home: os.homedir(),
  exists: (p) => existsSync(p),
});

/** The only fields read of `claude auth status` (D-431); anything else, `orgId` and paths included, is ignored. */
const statusSchema = z.object({
  loggedIn: z.boolean().optional(),
  email: z.string().max(320).optional(),
  orgName: z.string().max(200).optional(),
  subscriptionType: z.string().max(100).optional(),
});

interface Status {
  loggedIn: boolean;
  account: AiAccount['claudeCode']['account'];
}

/** Reads the JSON of `claude auth status`; null when it is not that (the command is missing or the output is odd). */
export function parseStatus(out: string): Status | null {
  try {
    const r = statusSchema.safeParse(JSON.parse(out.slice(0, MAX_OUT)));
    if (!r.success || r.data.loggedIn === undefined) return null;
    const { email, orgName, subscriptionType } = r.data;
    const account = email || orgName || subscriptionType ? { ...(email ? { email } : {}), ...(orgName ? { organization: orgName } : {}), ...(subscriptionType ? { plan: subscriptionType } : {}) } : null;
    return { loggedIn: r.data.loggedIn, account: r.data.loggedIn ? account : null };
  } catch {
    return null;
  }
}

export interface AccountService {
  account(): Promise<AiAccount>;
  setAuthMode(mode: AiAuthMode): Promise<AiAccount>;
  login(): Promise<{ started: true }>;
  loginDone(): Promise<AiAccount>;
  logout(): Promise<AiAccount>;
  test(): Promise<{ ok: boolean; ms: number; model: string; usd: number | null; error?: { code: string } }>;
  dispose(): void;
}

export function createAccountService(s: MainServices, io: AccountIo = realIo()): AccountService {
  const versions = new Map<string, string | null>();
  let watcher: { close(): void } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stop: ReturnType<typeof setTimeout> | null = null;
  /** `loggedIn|email|org` of the last state shown: a token refresh keeps it, a different account does not. */
  let identity: string | null = null;

  const exe = async () =>
    findClaudeExecutable({ configured: (await s.settings.get()).ai.claudeCodePath, env: io.env, home: io.home, exists: io.exists, ...(io.bundled ? { bundled: io.bundled } : {}) });

  async function build(): Promise<AiAccount> {
    const mode = (await s.settings.get()).ai.authMode;
    const found = await exe();
    const stored = await s.secrets.has({ kind: 'app' }, API_KEY_SECRET).catch(() => false);
    const env = childEnvFor(io.env, mode);
    let version: string | null = null;
    let status: Status | null = null;
    if (found.path) {
      if (!versions.has(found.path)) {
        const v = await io.run(found.path, ['--version'], { timeoutMs: STATUS_TIMEOUT_MS, env });
        versions.set(found.path, /^\d+\.\d+\.\d+[\w.+-]{0,32}/.exec(v.stdout.trim())?.[0] ?? null);
      }
      version = versions.get(found.path) ?? null;
      status = parseStatus((await io.run(found.path, ['auth', 'status', '--json'], { timeoutMs: STATUS_TIMEOUT_MS, env })).stdout);
    }
    const access = detectAccess({ apiKey: stored ? 'stored' : null, authMode: mode, env: io.env, home: io.home, exists: io.exists });
    // Without the `auth` commands the answer comes from the files and variables only (no identity).
    const hasLogin = Boolean(io.env.CLAUDE_CODE_OAUTH_TOKEN) || io.exists(claudeCredentialsFile(io.home));
    const loggedIn = status ? status.loggedIn : found.path && hasLogin ? true : null;
    // `auth status` knows better than the files (the login may live in the system's credential store).
    const effective = access.auth === 'claude-code' && loggedIn === false ? 'none' : access.auth === 'none' && mode !== 'api-key' && loggedIn === true ? 'claude-code' : access.auth;
    return {
      authMode: mode,
      effective,
      apiKey: { stored, envVar: Boolean(io.env.ANTHROPIC_API_KEY) },
      claudeCode: { path: found.path, source: found.source, version, loggedIn, account: status?.account ?? null, supportsAuthCommands: status !== null },
    };
  }

  const key = (a: AiAccount) => `${a.claudeCode.loggedIn}|${a.claudeCode.account?.email ?? ''}|${a.claudeCode.account?.organization ?? ''}`;
  async function refresh(emit: boolean): Promise<AiAccount> {
    const a = await build();
    const changed = identity !== key(a);
    identity = key(a);
    if (emit && changed) s.emit('ai:accountChanged', a);
    return a;
  }

  const closeWatcher = () => {
    watcher?.close();
    watcher = null;
    for (const t of [timer, stop]) if (t) clearTimeout(t);
    timer = stop = null;
  };

  function watchLogin(): void {
    closeWatcher();
    const file = claudeCredentialsFile(io.home);
    let debounce: ReturnType<typeof setTimeout> | null = null;
    watcher = io.watch(path.dirname(file), (name) => {
      if (name !== path.basename(file)) return;
      if (debounce) clearTimeout(debounce);
      // Every event, token refreshes included, only triggers a re-check; the content of the file is never read.
      debounce = setTimeout(() => {
        const before = identity;
        refresh(true)
          .then(() => {
            if (identity !== before) stop = setTimeout(closeWatcher, 2000);
          })
          .catch((e: unknown) => s.log.warn('Claude account re-check failed', { code: AppError.from(e).code }));
      }, DEBOUNCE_MS);
    });
    if (watcher) timer = setTimeout(closeWatcher, WATCH_MS);
  }

  return {
    account: () => refresh(false),
    async setAuthMode(mode) {
      await s.settings.update((cur) => {
        cur.ai.authMode = mode;
      });
      identity = null;
      return refresh(true);
    },
    async login() {
      const before = await build();
      if (!before.claudeCode.path) throw new AppError('NOT_FOUND', 'Claude Code was not found');
      identity = key(before);
      // Fixed arguments (D-431); where the CLI has no `auth` commands the plain executable opens and the user types /login.
      io.openConsole(before.claudeCode.path, before.claudeCode.supportsAuthCommands ? ['auth', 'login', '--claudeai'] : [], childEnvFor(io.env, 'claude-code'));
      watchLogin();
      return { started: true as const };
    },
    async loginDone() {
      const a = await refresh(true);
      closeWatcher();
      return a;
    },
    async logout() {
      const now = await build();
      if (now.claudeCode.path && now.claudeCode.supportsAuthCommands) {
        const r = await io.run(now.claudeCode.path, ['auth', 'logout'], { timeoutMs: LOGOUT_TIMEOUT_MS, env: childEnvFor(io.env, 'claude-code') });
        if (r.timedOut || r.code !== 0) s.log.warn('claude auth logout did not finish cleanly', { timedOut: r.timedOut, code: r.code });
      }
      // The exit code is not trusted: the state is what `auth status` says now.
      return refresh(true);
    },
    async test() {
      const rt = await s.runtime.require().catch(() => null);
      const cfg = rt ? await rt.store.readConfig() : null;
      const models = cfg?.ai.models ?? DEFAULT_MODELS;
      const fail = (code: string) => ({ ok: false, ms: 0, model: TEST_MODEL, usd: null, error: { code } });
      const settings = await s.settings.get();
      const provider = s.aiProvider?.({ provider: cfg?.ai.provider ?? 'claude-agent-sdk', models, claudeCodePath: settings.ai.claudeCodePath, authMode: settings.ai.authMode }) ?? null;
      if (!provider) return fail('no-provider');
      if (provider.id !== 'mock' && s.isOnline && !s.isOnline()) return fail('offline');
      if (provider.executable?.().path === null) return fail('exe-not-found');
      if ((await provider.access().catch(() => ({ auth: 'none' as const }))).auth === 'none') return fail('no-access');
      const t0 = Date.now();
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 60_000);
      let usd: number | null = null;
      let tokens = { in: 0, out: 0 };
      let error: string | null = null;
      try {
        for await (const ev of provider.chat({ model: TEST_MODEL, reasoning: 'low', system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'Rispondi solo: OK' }], signal: abort.signal, maxBudgetUsd: TEST_BUDGET_USD })) {
          if (ev.type === 'usage') {
            tokens = { in: ev.usage.inputTokens, out: ev.usage.outputTokens };
            const c = (ev.usage as { costUsd?: number }).costUsd;
            usd = typeof c === 'number' && Number.isFinite(c) ? c : usdFor(models, TEST_MODEL, tokens.in, tokens.out);
          } else if (ev.type === 'error') error = ev.code === 'AI_BUDGET_EXCEEDED' ? 'budget' : /access problem/.test(ev.message) ? 'access-denied' : ev.code === 'CANCELLED' ? 'timeout' : 'error';
        }
      } catch {
        error = 'error';
      } finally {
        clearTimeout(timeout);
      }
      const ms = Date.now() - t0;
      if (rt) {
        // Counted like any send, with its own purpose; without an active library nothing is recorded.
        await rt.store
          .appendLog({ type: 'ai-send', at: new Date().toISOString(), deviceId: settings.deviceId, provider: provider.id, model: TEST_MODEL, purpose: 'connection-test', docIds: [], folders: [], approxInputTokens: tokens.in, approxOutputTokens: tokens.out, ...(usd !== null ? { estimatedCostUsd: usd } : {}), confirmed: true })
          .catch((e: unknown) => s.log.warn('could not log the connection test', { code: AppError.from(e).code }));
      }
      return error ? { ok: false, ms, model: TEST_MODEL, usd, error: { code: error } } : { ok: true, ms, model: TEST_MODEL, usd };
    },
    dispose: closeWatcher,
  };
}

const services = new WeakMap<MainServices, AccountService>();
/** One service per `MainServices` (the watcher and the identity it compares live in it). Tests pass their fake I/O in `io`. */
export function accountService(s: MainServices, io?: AccountIo): AccountService {
  let svc = services.get(s);
  if (!svc) services.set(s, (svc = createAccountService(s, io)));
  return svc;
}

/**
 * Test double (development run with RL_E2E=1 only, see `runtime.ts`): a Claude Code whose whole state is `<dir>/state.json`
 * (`loggedIn`, `email`, `orgName`, `subscriptionType`, `version`, `authCommands`), with the calls it received in
 * `<dir>/calls.log`. The login console is not opened; a test changes the state and touches `<dir>/.claude/.credentials.json`.
 */
export function simulatedClaudeIo(dir: string): AccountIo {
  const file = path.join(dir, 'state.json');
  const state = (): Record<string, unknown> => {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  const note = (line: string) => appendFileSync(path.join(dir, 'calls.log'), `${line}
`);
  return {
    run: async (_exe, args) => {
      const line = args.join(' ');
      note(line);
      const st = state();
      if (line === '--version') return { code: 0, stdout: `${String(st.version ?? '9.9.9')} (Claude Code)`, timedOut: false };
      if (st.authCommands === false) return { code: 1, stdout: '', timedOut: false };
      if (line === 'auth logout') writeFileSync(file, JSON.stringify({ ...st, loggedIn: false }));
      return { code: 0, stdout: line.startsWith('auth status') ? JSON.stringify(st) : '', timedOut: false };
    },
    openConsole: (_exe, args) => note(`console ${args.join(' ')}`),
    watch: realIo().watch,
    env: {},
    home: dir,
    exists: existsSync,
    bundled: () => path.join(dir, 'claude-sim'),
  };
}
