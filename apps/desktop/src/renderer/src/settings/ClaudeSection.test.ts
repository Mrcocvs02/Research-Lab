// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryProfile } from '@rl/core';
import i18n from '../i18n';
import { AiUiProvider } from '../lib/aiUi';
import { ReaderProvider } from '../lib/reader';
import { AppProvider } from '../state/app-context';
import { memoryAi, type FakeSend } from '../testing/memoryAi';
import { callsTo, emitEvent, memoryBackend, setHandlers } from '../testing/mockRl';
import { clearLabels } from '../views/chat/useLabels';
import { ClaudeSection } from './ClaudeSection';
import { SettingsProvider } from './rows';

vi.mock('../lib/rl', async () => (await import('../testing/mockRl')).rlModule);

const profile: LibraryProfile = { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' };
const send = (over: Partial<FakeSend> = {}): FakeSend => ({ at: '2026-11-16T10:00:00.000Z', provider: 'claude-agent-sdk', model: 'claude-haiku-5-5', purpose: 'chat', docIds: [], folders: [], approxInputTokens: 1200, approxOutputTokens: 300, estimatedCostUsd: 0.0123, confirmed: true, ...over });

function setup(opts: { ai?: Parameters<typeof memoryAi>[0]; extra?: Record<string, (p: any) => unknown>; account?: (s: ReturnType<typeof memoryBackend>['state']) => void } = {}) {
  const base = memoryBackend({ profiles: [profile] });
  opts.account?.(base.state);
  const ai = memoryAi(opts.ai);
  setHandlers({ ...base.handlers, ...ai.handlers, ...opts.extra });
  render(createElement(AppProvider, null, createElement(AiUiProvider, null, createElement(ReaderProvider, null, createElement(SettingsProvider, null, createElement(ClaudeSection))))));
  return { base: base.state, ai: ai.state };
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  clearLabels();
});
afterEach(() => {
  cleanup();
});

describe('Account card', () => {
  it('says how Claude is connected, as whom, and where the program was found', async () => {
    setup();
    const card = await screen.findByTestId('ai-account');
    await waitFor(() => expect(card.getAttribute('data-effective')).toBe('claude-code'));
    expect(screen.getByTestId('ai-account-state').textContent).toBe('Connected with the Claude Code login');
    expect(screen.getByTestId('ai-account-sub').textContent).toContain('user@example.test · pro plan');
    expect(screen.getByTestId('ai-account-sub').textContent).toContain('found on the PATH');
    expect(card.getAttribute('data-state')).toBe('ok');
    expect(callsTo('ai:usageAll')).toEqual([]); // the total of all libraries only runs on a click
  });

  it('says "Not connected" with a primary button to sign in, and no program found with a way to choose one', async () => {
    setup({ account: (s) => ((s.claudeCode.loggedIn = false), (s.claudeCode.account = null)) });
    await screen.findByText('Not connected');
    expect(screen.getByTestId('ai-account').getAttribute('data-state')).toBe('bad');
    expect(screen.getByTestId('ai-change-account').textContent).toBe('Sign in with Claude Code…');
    expect(screen.getByTestId('ai-change-account').className).toContain('primary');
    cleanup();
    setup({ account: (s) => ((s.claudeCode.loggedIn = false), (s.claudeCode.path = null), (s.claudeCode.account = null)) });
    await screen.findByText('Claude Code is not installed or was not found');
    expect((screen.getByTestId('ai-change-account') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('ai-choose-program')).toBeTruthy();
  });

  it('chooses the mode (Automatic, Claude Code login, API key) and saves it at once', async () => {
    setup();
    const group = await screen.findByTestId('ai-auth-mode');
    expect(within(group).getByRole('radio', { name: 'Automatic' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(group).getByRole('radio', { name: 'API key' }));
    await waitFor(() => expect(callsTo('ai:setAuthMode')).toEqual([{ mode: 'api-key' }]));
    await waitFor(() => expect(screen.getByTestId('ai-account').getAttribute('data-mode')).toBe('api-key'));
    expect(screen.getByText(/API key only: the Claude Code login is ignored/)).toBeTruthy();
    expect(screen.getByTestId('ai-account').getAttribute('data-effective')).toBe('none');
  });

  it('warns when a key is saved but not used, because the mode is the Claude Code login', async () => {
    setup({ account: (s) => (s.apiKeyStored = true) });
    fireEvent.click(within(await screen.findByTestId('ai-auth-mode')).getByRole('radio', { name: 'Claude Code login' }));
    await screen.findByText('An API key is saved but not used in this mode.');
    expect(screen.getByTestId('ai-account').getAttribute('data-state')).toBe('warn');
  });

  it('tests the connection: the cost is on the button, the result in words, a failure with its reason', async () => {
    const { base } = setup();
    const btn = await screen.findByTestId('ai-test');
    expect(btn.textContent).toBe('Test the connection · about $0.001');
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId('ai-test-result').textContent).toBe('✓ Works · 1.2 s · Haiku 5.5'));
    expect(screen.getByTestId('ai-test-result').getAttribute('data-ok')).toBe('true');
    base.test = { ok: false, ms: 0, model: 'claude-haiku-5-5', usd: null, error: { code: 'budget' } };
    fireEvent.click(screen.getByTestId('ai-test'));
    await waitFor(() => expect(screen.getByTestId('ai-test-result').textContent).toBe('The monthly cap was reached.'));
    expect(callsTo('ai:test')).toHaveLength(2);
  });

  it('does not start the test when the computer is offline, and says so', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    setup();
    fireEvent.click(await screen.findByTestId('ai-test'));
    expect((await screen.findByTestId('ai-test-result')).textContent).toBe('You are offline: the test did not start');
    expect(callsTo('ai:test')).toEqual([]);
    online.mockRestore();
  });
});

describe('Token cap row (D-442)', () => {
  it('shows the tokens of the month against the cap with a bar, saves a typed cap and the "no cap" preset', async () => {
    const { ai } = setup();
    ai.monthTokens = 123456;
    ai.tokenCap = 500000;
    const text = await screen.findByTestId('token-usage-text');
    await waitFor(() => expect(text.textContent).toBe('123,456 / 500,000 (25%)'));
    expect(screen.getAllByRole('progressbar').length).toBeGreaterThan(0);
    const select = screen.getByTestId('token-cap-select') as HTMLSelectElement;
    expect(select.value).toBe('500000');
    expect(screen.queryByTestId('token-cap-input')).toBeNull();
    fireEvent.change(select, { target: { value: 'custom' } });
    const input = screen.getByTestId('token-cap-input') as HTMLInputElement;
    expect(input.value).toBe('500000');
    fireEvent.change(input, { target: { value: '1000000' } });
    fireEvent.blur(input);
    await waitFor(() => expect(callsTo('ai:setTokenCap').at(-1)).toMatchObject({ monthlyTokens: 1000000 }));
    fireEvent.change(screen.getByTestId('token-cap-select'), { target: { value: 'none' } });
    await waitFor(() => expect(callsTo('ai:setTokenCap').at(-1)).toMatchObject({ monthlyTokens: null }));
    expect(ai.tokenCap).toBeNull();
  });
});

describe('Change account', () => {
  it('explains first, opens the Claude Code window, then waits with "I\'m done, check" as the primary button', async () => {
    setup();
    fireEvent.click(await screen.findByTestId('ai-change-account'));
    const dialog = screen.getByTestId('ai-login-dialog');
    expect(dialog.textContent).toContain('A Claude Code window will open, then the browser to sign in');
    expect(callsTo('ai:login')).toEqual([]);
    fireEvent.click(within(dialog).getByTestId('ai-login-open'));
    await waitFor(() => expect(callsTo('ai:login')).toHaveLength(1));
    const wait = await screen.findByTestId('ai-login-wait');
    expect(wait.textContent).toContain('Complete the sign-in in the Claude Code window');
    const done = within(wait).getByTestId('ai-login-done');
    expect(done.className).toContain('primary');
    fireEvent.click(done);
    await waitFor(() => expect(callsTo('ai:loginDone')).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('ai-account-note').textContent).toBe('Connected as user@example.test'));
    expect(screen.queryByTestId('ai-login-wait')).toBeNull();
  });

  it('ends the wait by itself when the watcher reports another account', async () => {
    const { base } = setup();
    fireEvent.click(await screen.findByTestId('ai-change-account'));
    fireEvent.click(screen.getByTestId('ai-login-open'));
    await screen.findByTestId('ai-login-wait');
    await act(async () => {
      emitEvent('ai:accountChanged', { authMode: 'auto', effective: 'claude-code', apiKey: { stored: false, envVar: false }, claudeCode: { path: base.claudeCode.path, source: 'path', version: '2.1.0', loggedIn: true, account: { email: 'second@example.test', plan: 'max' }, supportsAuthCommands: true } });
    });
    await waitFor(() => expect(screen.getByTestId('ai-account-note').textContent).toBe('Connected as second@example.test'));
    expect(screen.getByTestId('ai-account-state').textContent).toContain('Claude Code login');
  });

  it('says when the sign-in is not done yet, and keeps waiting', async () => {
    setup({ account: (s) => ((s.claudeCode.loggedIn = false), (s.claudeCode.account = null)) });
    fireEvent.click(await screen.findByTestId('ai-change-account'));
    fireEvent.click(screen.getByTestId('ai-login-open'));
    fireEvent.click(await screen.findByTestId('ai-login-done'));
    await screen.findByText(/Not signed in yet/);
    expect(screen.getByTestId('ai-login-wait')).toBeTruthy();
  });

  it('puts "Sign out of Claude Code…" in the menu, with the warning, and asks before it runs', async () => {
    setup();
    fireEvent.click(await screen.findByTestId('ai-account-more'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out of Claude Code…' }));
    const dialog = screen.getByTestId('ai-logout-dialog');
    expect(dialog.textContent).toContain('also in the terminal and in other apps');
    expect(callsTo('ai:logout')).toEqual([]);
    fireEvent.click(within(dialog).getByTestId('ai-logout-yes'));
    await waitFor(() => expect(callsTo('ai:logout')).toHaveLength(1));
    await screen.findByText('Not connected');
  });
});

describe('Usage and key', () => {
  it('shows the usage of the active library against the cap, and the total of all libraries only on click', async () => {
    const { ai } = setup({ ai: { config: { ai: { ...memoryAi().state.config.ai, usageCap: { monthlyUsd: 5, confirmBatchAboveUsd: 0.5 } } } as never } });
    ai.monthUsd = 0.42;
    ai.log.push(send(), send());
    const usage = await screen.findByTestId('ai-usage');
    await waitFor(() => expect(usage.textContent).toContain('$0.42 of $5.00'));
    expect(usage.textContent).toContain('2 sends');
    expect(callsTo('ai:usageAll')).toEqual([]);
    fireEvent.click(screen.getByTestId('ai-usage-all'));
    await waitFor(() => expect(callsTo('ai:usageAll')).toHaveLength(1));
    expect((await screen.findByTestId('ai-usage-all-result')).textContent).toBe('Libraries: 1 · not reachable: 0 · total $0.00');
  });

  it('adds, replaces and removes the Anthropic key in the app scope, never showing it', async () => {
    setup();
    fireEvent.click(await screen.findByTestId('secret-add-anthropic-api-key'));
    const input = screen.getByTestId('secret-input-anthropic-api-key') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: 'sk-ant-not-real' } });
    fireEvent.click(screen.getByTestId('secret-save-anthropic-api-key'));
    await waitFor(() => expect(callsTo('secrets:set')).toEqual([{ scope: { kind: 'app' }, name: 'anthropic-api-key', value: 'sk-ant-not-real' }]));
    await waitFor(() => expect(screen.getByTestId('secret-status-anthropic-api-key').textContent).toBe('Saved'));
    expect(document.body.textContent).not.toContain('sk-ant-not-real');
    expect(screen.getByTestId('secret-add-anthropic-api-key').textContent).toBe('Replace…');
    fireEvent.click(screen.getByTestId('secret-remove-anthropic-api-key'));
    await waitFor(() => expect(screen.getByTestId('secret-status-anthropic-api-key').textContent).toBe('Not saved'));
  });
});

describe('What Claude can read, model and spending', () => {
  it('says that nothing is sent while no folder is enabled, and writes the enabled folders (default none)', async () => {
    const { ai } = setup();
    expect((await screen.findByTestId('ai-folders-summary')).textContent).toContain('nothing is sent');
    expect(ai.config.aiEnabledFolders).toEqual([]);
    fireEvent.click(screen.getByLabelText('Whole library'));
    await waitFor(() => expect(callsTo('library:setConfig')).toEqual([{ libraryId: 'lib-a', patch: { aiEnabledFolders: [''] } }]));
    expect((await screen.findByTestId('ai-folders-summary')).textContent).toBe('1 folder enabled for sending');
    expect((screen.getByLabelText('Files in the library root') as HTMLInputElement).disabled).toBe(true);
  });

  it('enables a folder from the tree and the files of the root', async () => {
    setup();
    const tree = await screen.findByTestId('config-ai-tree');
    fireEvent.click(await within(tree).findByLabelText(/alpha/));
    await waitFor(() => expect(callsTo('library:setConfig').at(-1).patch.aiEnabledFolders).toEqual(['alpha']));
    fireEvent.click(screen.getByLabelText('Files in the library root'));
    await waitFor(() => expect(callsTo('library:setConfig').at(-1).patch.aiEnabledFolders).toEqual(['.', 'alpha']));
  });

  it('saves the default model, the reasoning level and the confirmation at once', async () => {
    setup();
    fireEvent.change(await screen.findByTestId('ai-default-model'), { target: { value: 'claude-sonnet-5-5' } });
    await waitFor(() => expect(callsTo('library:setConfig')).toContainEqual({ libraryId: 'lib-a', patch: { ai: { defaultModel: 'claude-sonnet-5-5' } } }));
    fireEvent.change(screen.getByTestId('ai-default-reasoning'), { target: { value: 'high' } });
    await waitFor(() => expect(callsTo('library:setConfig')).toContainEqual({ libraryId: 'lib-a', patch: { ai: { defaultReasoning: 'high' } } }));
    const confirm = screen.getByTestId('ai-confirm');
    expect(confirm.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(confirm);
    await waitFor(() => expect(callsTo('library:setConfig')).toContainEqual({ libraryId: 'lib-a', patch: { ai: { confirmBeforeSend: false } } }));
  });

  it('saves the monthly cap when valid (a comma counts as the decimal point) and refuses a bad value', async () => {
    setup();
    const cap = await screen.findByTestId('ai-monthly-cap');
    fireEvent.change(cap, { target: { value: 'abc' } });
    expect(screen.getByText(/positive amount/)).toBeTruthy();
    fireEvent.blur(cap);
    expect(callsTo('library:setConfig')).toEqual([]);
    fireEvent.change(cap, { target: { value: '7,5' } });
    fireEvent.blur(cap);
    await waitFor(() => expect(callsTo('library:setConfig')).toEqual([{ libraryId: 'lib-a', patch: { ai: { usageCap: { monthlyUsd: 7.5 } } } }]));
    fireEvent.change(cap, { target: { value: '' } });
    fireEvent.blur(cap);
    await waitFor(() => expect(callsTo('library:setConfig').at(-1).patch.ai.usageCap.monthlyUsd).toBeNull());
  });
});

describe('Log', () => {
  it('lists what was sent, in a group that opens on click', async () => {
    const { ai } = setup();
    ai.log.push(send({ purpose: 'tags' }), send({ purpose: 'chat', model: 'claude-sonnet-5-5', estimatedCostUsd: 0.2 }));
    const fold = await screen.findByTestId('settings-fold-aiLog');
    expect(fold.hasAttribute('open')).toBe(false);
    fireEvent.click(fold.querySelector('summary')!);
    await waitFor(() => expect(screen.getAllByTestId('log-row')).toHaveLength(2));
    expect(screen.getByText('tags')).toBeTruthy();
  });
});
