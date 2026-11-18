import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { ipcData } from './helpers/phase1';

/**
 * Claude account channels (§10, B1) against a SIMULATED Claude Code: `RL_E2E_CLAUDE_SIM` (needs RL_E2E=1, development run)
 * replaces the `claude` program, the login console and the credentials folder with a temp folder, and `RL_AI_PROVIDER=mock`
 * replaces the model. The real program and the real account are never touched.
 */
interface Account {
  authMode: string;
  effective: string;
  apiKey: { stored: boolean; envVar: boolean };
  claudeCode: { path: string | null; version: string | null; loggedIn: boolean | null; account: { email?: string; organization?: string; plan?: string } | null; supportsAuthCommands: boolean };
}
const state = (o: Record<string, unknown> = {}) => JSON.stringify({ loggedIn: true, email: 'first@example.test', orgName: 'Example Org', subscriptionType: 'pro', version: '9.1.2', ...o });

let sim: string;
let ctx: LaunchedApp | undefined;
test.beforeEach(async () => {
  sim = await mkdtemp(path.join(os.tmpdir(), 'rl-claude-sim-'));
  await mkdir(path.join(sim, '.claude'));
  await writeFile(path.join(sim, 'state.json'), state());
  await writeFile(path.join(sim, '.claude', '.credentials.json'), '{}');
  ctx = await launchApp({ env: { RL_E2E: '1', RL_E2E_CLAUDE_SIM: sim, RL_AI_PROVIDER: 'mock' } });
  await ctx.window.evaluate(() => {
    const w = window as unknown as { __acc: unknown[]; rlBridge: { subscribe(e: string, l: (p: unknown) => void): void } };
    w.__acc = [];
    w.rlBridge.subscribe('ai:accountChanged', (p) => w.__acc.push(p));
  });
});
test.afterEach(async () => {
  await ctx?.close();
  await rm(sim, { recursive: true, force: true });
});

const calls = async () => (await readFile(path.join(sim, 'calls.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean);
const changes = () => ctx!.window.evaluate(() => (window as unknown as { __acc: Array<{ claudeCode: { account: { email?: string } | null } }> }).__acc.map((a) => a.claudeCode.account?.email ?? null));

test('account card data, auth mode, login re-check without account switches on token refresh, logout', async () => {
  const w = ctx!.window;
  const acc = await ipcData<Account>(w, 'ai:account', {});
  expect(acc).toMatchObject({ authMode: 'auto', effective: 'claude-code', claudeCode: { version: '9.1.2', loggedIn: true, supportsAuthCommands: true, account: { email: 'first@example.test', organization: 'Example Org', plan: 'pro' } } });

  // The mode is saved and announced.
  expect(await ipcData<Account>(w, 'ai:setAuthMode', { mode: 'api-key' })).toMatchObject({ authMode: 'api-key', effective: 'none' });
  expect((await ipcData<{ ai: { authMode: string } }>(w, 'settings:get', {})).ai.authMode).toBe('api-key');
  await ipcData(w, 'ai:setAuthMode', { mode: 'auto' });

  expect((await changes()).length).toBe(2); // the two mode changes
  await w.evaluate(() => void ((window as unknown as { __acc: unknown[] }).__acc.length = 0));
  // Login: a console with the fixed arguments (never opened for real here), then the file watcher.
  expect(await ipcData(w, 'ai:login', {})).toEqual({ started: true });
  expect(await calls()).toContain('console auth login --claudeai');
  const touch = async () => {
    const t = new Date();
    await writeFile(path.join(sim, '.claude', '.credentials.json'), `{"t":${t.getTime()}}`);
    await utimes(path.join(sim, '.claude', '.credentials.json'), t, t);
  };
  const statusCalls = async () => (await calls()).filter((c) => c === 'auth status --json').length;
  const before = await statusCalls();
  await touch(); // a token refresh: same account
  await expect.poll(statusCalls, { timeout: 10_000 }).toBeGreaterThan(before);
  expect(await changes()).toEqual([]);
  await writeFile(path.join(sim, 'state.json'), state({ email: 'second@example.test' }));
  await touch(); // another account
  await expect.poll(changes, { timeout: 10_000 }).toEqual(['second@example.test']);
  expect((await ipcData<Account>(w, 'ai:loginDone', {})).claudeCode.account?.email).toBe('second@example.test');

  // Logout: the program is run with fixed arguments and the state is verified with `auth status`.
  const out = await ipcData<Account>(w, 'ai:logout', {});
  expect(out.claudeCode.loggedIn).toBe(false);
  const log = await calls();
  expect(log).toContain('auth logout');
  expect(log.every((c) => ['--version', 'auth status --json', 'auth logout', 'console auth login --claudeai'].includes(c))).toBe(true);
});

test('connection test and usage over all libraries answer without a library, with the simulated provider', async () => {
  const t = await ipcData<{ ok: boolean; model: string; usd: number | null }>(ctx!.window, 'ai:test', {});
  expect(t).toMatchObject({ ok: true, model: 'claude-haiku-5-5' });
  expect(await ipcData(ctx!.window, 'ai:usageAll', {})).toEqual({ totalUsd: 0, sends: 0, libraries: [] });
});

test('without the auth commands the card gets no identity and the login opens the plain program', async () => {
  await writeFile(path.join(sim, 'state.json'), state({ authCommands: false }));
  const acc = await ipcData<Account>(ctx!.window, 'ai:account', {});
  expect(acc.claudeCode).toMatchObject({ supportsAuthCommands: false, account: null, loggedIn: true });
  await ipcData(ctx!.window, 'ai:login', {});
  expect(await calls()).toContain('console ');
});
