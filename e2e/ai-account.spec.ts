import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { createLibraryViaWizard, ipcData } from './helpers/phase1';
import { waitClaudeReady } from './helpers/settings';

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

test('the Account card in the settings: state, mode, change account then check, sign out (simulated Claude Code)', async () => {
  // The settings need a library (without one the first-run wizard covers the window): a new launch with a small synthetic one.
  await ctx!.close();
  ctx = await launchApp({ library: 'papers', dialogPath: true, offline: true, env: { RL_E2E: '1', RL_E2E_CLAUDE_SIM: sim, RL_AI_PROVIDER: 'mock' } });
  const w = ctx.window;
  await createLibraryViaWizard(w, { name: 'Account library' });
  await ipcData(w, 'settings:set', { uiLanguage: 'en' });
  await w.reload();
  await waitClaudeReady(w);
  const card = w.getByTestId('ai-account');
  await expect(w.getByTestId('ai-account-state')).toHaveText('Connected with the Claude Code login');
  await expect(w.getByTestId('ai-account-sub')).toContainText('first@example.test');

  // The mode is chosen and saved at once.
  await w.getByTestId('ai-auth-mode').getByRole('radio', { name: 'API key' }).click();
  await expect(card).toHaveAttribute('data-effective', 'none');
  await w.getByTestId('ai-auth-mode').getByRole('radio', { name: 'Automatic' }).click();
  await expect(card).toHaveAttribute('data-effective', 'claude-code');

  // Change account: the dialog says what happens, the console is opened with fixed arguments, "I'm done, check" is the primary button.
  await w.getByTestId('ai-change-account').click();
  await expect(w.getByTestId('ai-login-dialog')).toContainText('A Claude Code window will open');
  await w.getByTestId('ai-login-open').click();
  await expect(w.getByTestId('ai-login-wait')).toBeVisible();
  expect(await calls()).toContain('console auth login --claudeai');
  await writeFile(path.join(sim, 'state.json'), state({ email: 'second@example.test' }));
  await w.getByTestId('ai-login-done').click();
  await expect(w.getByTestId('ai-account-note')).toHaveText('Connected as second@example.test');
  await expect(w.getByTestId('ai-account-sub')).toContainText('second@example.test');

  // Sign out is in the menu, after a warning.
  await w.getByTestId('ai-account-more').click();
  await w.getByRole('menuitem', { name: 'Sign out of Claude Code…' }).click();
  await expect(w.getByTestId('ai-logout-dialog')).toContainText('also in the terminal');
  await w.getByTestId('ai-logout-yes').click();
  await expect(card).toHaveAttribute('data-effective', 'none');
  expect(await calls()).toContain('auth logout');
});

test('token cap: a refused chat message offers the raise, "Double" lifts the cap and "Retry" sends it (mock provider)', async () => {
  test.setTimeout(240_000);
  await ctx!.close();
  ctx = await launchApp({ library: 'papers', dialogPath: true, offline: true, env: { RL_E2E: '1', RL_E2E_CLAUDE_SIM: sim, RL_AI_PROVIDER: 'mock' } });
  const w = ctx.window;
  await createLibraryViaWizard(w, { name: 'Cap library' });
  await ipcData(w, 'settings:set', { uiLanguage: 'en' });
  await ipcData(w, 'library:setConfig', { patch: { ai: { confirmBeforeSend: false } } });
  await w.reload();
  await w.getByTestId('chat-toggle').click();
  const ask = async (text: string) => {
    await w.getByTestId('chat-input').fill(text);
    await w.getByTestId('chat-send').click();
  };
  // A first answer gives the month some tokens; the cap is then set to exactly what was used.
  await ask('Tell me about the methods of the papers in this library, '.repeat(4));
  await expect(w.getByTestId('chat-turn-ai').first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await ipcData<{ monthTokens: number }>(w, 'ai:tokenUsage', {})).monthTokens, { timeout: 30_000 }).toBeGreaterThan(0);
  const used = (await ipcData<{ monthTokens: number }>(w, 'ai:tokenUsage', {})).monthTokens;
  await ipcData(w, 'ai:setTokenCap', { monthlyTokens: used });
  await expect(w.getByTestId('token-meter')).toContainText('100%');

  // The next message is refused before it is sent, with the notification and its actions.
  await ask('ok');
  const banner = w.getByTestId('chat-banner');
  await expect(banner).toHaveAttribute('data-kind', 'tokenCap');
  await expect(banner).toContainText('Request not run: monthly cap of');
  await banner.getByRole('button', { name: 'Double' }).click();
  await expect.poll(async () => (await ipcData<{ tokenCap: number }>(w, 'ai:tokenUsage', {})).tokenCap).toBe(used * 2);

  // After the raise the same request is offered again and goes.
  await w.getByTestId('toasts').getByRole('button', { name: 'Retry' }).click();
  await expect(w.getByTestId('chat-turn-ai')).toHaveCount(2, { timeout: 60_000 });
  await expect(w.getByTestId('chat-banner')).toHaveCount(0);
});
