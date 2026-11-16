// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryProfile } from '@rl/core';
import i18n from '../i18n';
import { AiUiProvider } from '../lib/aiUi';
import { ReaderProvider, useReader } from '../lib/reader';
import { AppProvider } from '../state/app-context';
import { memoryAi, type FakeSend } from '../testing/memoryAi';
import { callsTo, memoryBackend, setHandlers } from '../testing/mockRl';
import { clearLabels } from '../views/chat/useLabels';
import { AiSection } from './AiSection';

vi.mock('../lib/rl', async () => (await import('../testing/mockRl')).rlModule);

const profile: LibraryProfile = { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' };
const KEY = 'sk-test-not-a-real-key';

const send = (n: number, over: Partial<FakeSend> = {}): FakeSend => ({
  at: `2026-11-1${n}T10:00:00.000Z`,
  provider: 'claude-agent-sdk',
  model: 'claude-haiku-5-5',
  purpose: 'chat',
  docIds: ['aaaaaaaaaaaaaaaa'],
  folders: ['alpha'],
  approxInputTokens: 1500,
  approxOutputTokens: 300,
  estimatedCostUsd: 0.0042,
  confirmed: true,
  ...over,
});

function Probe() {
  const r = useReader();
  return createElement('div', { 'data-testid': 'probe' }, r.target ? `${r.target.docId}:${r.target.page ?? ''}` : '');
}

function setup(init: Parameters<typeof memoryAi>[0] = {}, tweak: (ai: ReturnType<typeof memoryAi>) => void = () => {}) {
  const ai = memoryAi({ docs: [{ docId: 'aaaaaaaaaaaaaaaa', path: 'alpha/one.pdf' }], ...init });
  tweak(ai);
  const { handlers } = memoryBackend({ profiles: [profile] });
  setHandlers({ ...handlers, ...ai.handlers, 'documents:get': (p: any) => ({ id: p.docId, title: 'Paper One' }) });
  render(createElement(AppProvider, null, createElement(ReaderProvider, null, createElement(AiUiProvider, null, createElement(AiSection), createElement(Probe)))));
  return ai;
}

beforeEach(async () => {
  clearLabels();
  await i18n.changeLanguage('en');
});
afterEach(() => cleanup());

describe('AiSection', () => {
  it('shows the status: provider, access, availability, and how to enable it when unavailable', async () => {
    setup({}, (ai) => {
      ai.state.available = false;
      ai.state.auth = 'none';
      ai.state.reason = 'no-access';
    });
    const status = await screen.findByTestId('ai-status');
    await waitFor(() => expect(within(status).getByTestId('ai-access').textContent).toBe('None'));
    expect(within(status).getByTestId('ai-provider').textContent).toContain('Claude');
    expect(within(status).getByTestId('ai-available').textContent).toMatch(/Not available.*no access/);
    expect(within(status).getByText(/sign in with the Claude Code command-line tool/)).toBeTruthy();
  });

  it('shows an available login without the help text', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId('ai-available').textContent).toBe('Available'));
    expect(screen.getByTestId('ai-access').textContent).toBe('Claude Code login');
    expect(screen.queryByText(/sign in with the Claude Code command-line tool/)).toBeNull();
  });

  it('says that nothing is sent while no folder is enabled, and writes the enabled folders (default none)', async () => {
    const ai = setup();
    const summary = await screen.findByTestId('ai-folders-summary');
    expect(summary.textContent).toContain('nothing is sent to Claude');
    expect((screen.getByTestId('ai-save') as HTMLButtonElement).disabled).toBe(false);

    const tree = await screen.findByTestId('config-ai-tree');
    const box = await within(tree).findByRole('checkbox', { name: /alpha/ });
    fireEvent.click(box);
    expect(screen.getByTestId('ai-folders-summary').textContent).toContain('1 folder enabled');

    fireEvent.click(screen.getByTestId('ai-save'));
    await waitFor(() => expect(callsTo('library:setConfig')).toHaveLength(1));
    const sent = callsTo('library:setConfig')[0];
    expect(sent.libraryId).toBe('lib-a');
    expect(sent.patch.aiEnabledFolders).toEqual(['alpha']);
    expect(Object.keys(sent.patch).sort()).toEqual(['ai', 'aiEnabledFolders']);
    expect(ai.state.config.aiEnabledFolders).toEqual(['alpha']);
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
  });

  it('edits the default model and reasoning, the confirmation, the monthly cap and the bulk threshold', async () => {
    const ai = setup();
    await screen.findByTestId('ai-settings');
    fireEvent.change(screen.getByLabelText('Monthly usage cap (USD)'), { target: { value: '-3' } });
    expect(screen.getByText(/positive amount/)).toBeTruthy();
    expect((screen.getByTestId('ai-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Monthly usage cap (USD)'), { target: { value: '12.5' } });

    fireEvent.click(screen.getByText('Add model'));
    expect(screen.getAllByText('Enter a model id.').length).toBeGreaterThan(0);
    expect((screen.getByTestId('ai-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/^Remove model\s*$/));

    fireEvent.change(screen.getByLabelText('Default model'), { target: { value: 'claude-sonnet-5-5' } });
    fireEvent.change(screen.getByLabelText('Default reasoning level'), { target: { value: 'high' } });
    fireEvent.click(screen.getByLabelText(/Ask for confirmation, with a preview/));
    fireEvent.change(screen.getByLabelText(/Confirm batch jobs above/), { target: { value: '2' } });

    fireEvent.click(screen.getByTestId('ai-save'));
    await waitFor(() => expect(callsTo('library:setConfig')).toHaveLength(1));
    expect(callsTo('library:setConfig')[0].patch.ai).toMatchObject({
      defaultModel: 'claude-sonnet-5-5',
      defaultReasoning: 'high',
      confirmBeforeSend: false,
      usageCap: { monthlyUsd: 12.5, confirmBatchAboveUsd: 2 },
    });
    expect(ai.state.config.ai.defaultModel).toBe('claude-sonnet-5-5');
  });

  it('stores the optional API key through the secrets channels and never shows it back', async () => {
    const ai = setup();
    const status = await screen.findByTestId('ai-apikey-status');
    await waitFor(() => expect(status.textContent).toBe('Not stored'));
    const input = screen.getByTestId('ai-apikey-input') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect((screen.getByTestId('ai-apikey-remove') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: KEY } });
    fireEvent.click(screen.getByTestId('ai-apikey-store'));
    await waitFor(() => expect(screen.getByTestId('ai-apikey-status').textContent).toBe('Stored'));
    expect(callsTo('secrets:set')).toEqual([{ scope: { kind: 'library', libraryId: 'lib-a' }, name: 'anthropic-api-key', value: KEY }]);
    expect((screen.getByTestId('ai-apikey-input') as HTMLInputElement).value).toBe('');
    expect(document.body.innerHTML).not.toContain(KEY);
    // The key is never part of a config patch, and no channel can return it.
    expect(JSON.stringify(callsTo('library:setConfig'))).not.toContain(KEY);
    expect(ai.state.secrets.has('anthropic-api-key')).toBe(true);

    fireEvent.click(screen.getByTestId('ai-apikey-remove'));
    await waitFor(() => expect(screen.getByTestId('ai-apikey-status').textContent).toBe('Not stored'));
    expect(callsTo('secrets:delete')).toHaveLength(1);
  });

  it('lists the log of what was sent: date, model, purpose, documents (links), tokens and cost', async () => {
    setup({}, (ai) => {
      ai.state.log = [send(2, { model: 'claude-sonnet-5-5', purpose: 'tags', docIds: ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'cccccccccccccccc', 'dddddddddddddddd'] }), send(1, { estimatedCostUsd: undefined, approxOutputTokens: undefined })];
    });
    const rows = await screen.findAllByTestId('log-row');
    expect(rows).toHaveLength(2);
    const first = within(rows[0]!);
    expect(rows[0]!.textContent).toContain('claude-sonnet-5-5');
    expect(rows[0]!.textContent).toContain('tags');
    expect(rows[0]!.textContent).toContain('1.5k / 300');
    expect(rows[0]!.textContent).toContain('<$0.01');
    expect(first.getAllByTestId('log-doc')).toHaveLength(3);
    expect(rows[0]!.textContent).toContain('+1 more');
    expect(rows[1]!.textContent).toContain('—');
    await waitFor(() => expect(first.getAllByTestId('log-doc')[0]!.textContent).toBe('Paper One'));
    fireEvent.click(first.getAllByTestId('log-doc')[0]!);
    expect(screen.getByTestId('probe').textContent).toBe('aaaaaaaaaaaaaaaa:');
  });

  it('shows an empty log message', async () => {
    setup();
    expect(await screen.findByText('Nothing has been sent yet.')).toBeTruthy();
  });
});
