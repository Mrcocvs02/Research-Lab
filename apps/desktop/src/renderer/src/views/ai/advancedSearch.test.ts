// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryProfile } from '@rl/core';
import i18n from '../../i18n';
import { AiUiProvider, useAiUi } from '../../lib/aiUi';
import { AppProvider } from '../../state/app-context';
import { memoryAi } from '../../testing/memoryAi';
import { callsTo, memoryBackend, setHandlers } from '../../testing/mockRl';
import { ChatPanel } from '../chat/ChatPanel';
import { AdvancedSearchDialog, SEARCH_ALLOWANCE_CHARS } from './AdvancedSearchDialog';

vi.mock('../../lib/rl', async () => (await import('../../testing/mockRl')).rlModule);

const profile: LibraryProfile = { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' };

function Host({ text }: { text: string }) {
  const [open, setOpen] = useState(true);
  const ui = useAiUi();
  return createElement(
    'div',
    null,
    createElement('span', { 'data-testid': 'chat-open' }, String(ui.chatOpen)),
    open ? createElement(AdvancedSearchDialog, { initialText: text, onClose: () => setOpen(false) }) : createElement('span', { 'data-testid': 'dialog-closed' }),
    ui.chatOpen ? createElement(ChatPanel) : null,
  );
}

function setup(o: { text?: string; tweak?(ai: ReturnType<typeof memoryAi>): void; folders?: string[] } = {}) {
  localStorage.clear();
  const ai = memoryAi({ config: { aiEnabledFolders: o.folders ?? ['alpha'] } });
  o.tweak?.(ai);
  const { handlers } = memoryBackend({ profiles: [profile] });
  setHandlers({ ...handlers, ...ai.handlers });
  render(createElement(AppProvider, null, createElement(AiUiProvider, null, createElement(Host, { text: o.text ?? 'efficient transformer attention memory' }))));
  return ai;
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => cleanup());

describe('advanced search dialog', () => {
  it('is prefilled, shows an approximate estimate with the library defaults, then sends a search turn and opens the chat', async () => {
    const ai = setup();
    expect((screen.getByTestId('adv-search-text') as HTMLTextAreaElement).value).toBe('efficient transformer attention memory');
    await waitFor(() => expect((screen.getByTestId('adv-search-model') as HTMLSelectElement).value).toBe('claude-haiku-5-5'));
    expect((screen.getByTestId('adv-search-reasoning') as HTMLSelectElement).value).toBe(ai.state.config.ai.defaultReasoning);
    await waitFor(() => expect(screen.getByTestId('adv-search-estimate').textContent).toContain('About'));
    expect(screen.getByTestId('adv-search-estimate').textContent).toContain('Approximate');
    expect(ai.state.previews.at(-1)).toMatchObject({ purpose: 'search', docIds: [], promptChars: 'efficient transformer attention memory'.length + SEARCH_ALLOWANCE_CHARS });
    expect(callsTo('chat:send')).toHaveLength(0); // nothing is sent before "Search"

    fireEvent.change(screen.getByTestId('adv-search-model'), { target: { value: ai.state.config.ai.models[1]!.id } });
    await waitFor(() => expect(ai.state.previews.at(-1).model).toBe(ai.state.config.ai.models[1]!.id));

    await waitFor(() => expect((screen.getByTestId('adv-search-go') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('adv-search-go'));
    expect(await screen.findByTestId('dialog-closed')).toBeTruthy();
    await waitFor(() => expect(ai.state.sends).toHaveLength(1));
    expect(ai.state.sends[0]).toMatchObject({ mode: 'search', confirmed: true, contextDocIds: [], text: 'efficient transformer attention memory' });
    expect(ai.state.sends[0].conversationId).toBeUndefined();
    // The chat panel opened and streams the answer of that conversation.
    expect(screen.getByTestId('chat-open').textContent).toBe('true');
    await waitFor(() => expect(screen.getByTestId('chat-log').textContent).toContain('Hello world'));
    const conv = [...ai.state.conversations.values()][0]!;
    expect(conv.mode).toBe('search');
  });

  it('search conversations carry a label and data-mode in the history', async () => {
    const ai = setup();
    await waitFor(() => expect((screen.getByTestId('adv-search-go') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('adv-search-go'));
    await waitFor(() => expect(screen.getByTestId('chat-log').textContent).toContain('Hello world'));
    ai.state.conversations.set('c-chat', { id: 'c-chat', title: 'Plain chat', updatedAt: '2026-11-01T10:00:00.000Z', turns: [] });
    fireEvent.click(screen.getByTestId('chat-history-toggle'));
    const items = await screen.findAllByTestId('history-item');
    expect(items.map((i) => i.getAttribute('data-mode')).sort()).toEqual(['chat', 'search']);
    expect(screen.getAllByTestId('history-mode-search')).toHaveLength(1);
    expect(screen.getByTestId('history-mode-search').textContent).toBe('search');
  });

  it('needs a request: Search is disabled while the text is empty', async () => {
    setup({ text: '' });
    expect((screen.getByTestId('adv-search-go') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('adv-search-text'), { target: { value: 'graph neural networks' } });
    await waitFor(() => expect((screen.getByTestId('adv-search-go') as HTMLButtonElement).disabled).toBe(false));
  });

  it.each([
    ['offline', (ai: ReturnType<typeof memoryAi>) => ((ai.state.available = false), (ai.state.reason = 'offline'))],
    ['no-access', (ai: ReturnType<typeof memoryAi>) => ((ai.state.available = false), (ai.state.reason = 'no-access'))],
    ['cap-reached', (ai: ReturnType<typeof memoryAi>) => ((ai.state.available = false), (ai.state.reason = 'cap-reached'))],
  ])('says why when the AI is unavailable (%s) and does not search', async (reason, tweak) => {
    const ai = setup({ tweak });
    const note = await screen.findByTestId('adv-search-unavailable');
    expect(note.getAttribute('data-reason')).toBe(reason);
    expect((screen.getByTestId('adv-search-go') as HTMLButtonElement).disabled).toBe(true);
    expect(ai.state.previews).toHaveLength(0);
    fireEvent.click(screen.getByTestId('adv-search-go'));
    expect(ai.state.sends).toHaveLength(0);
  });

  it('explains it when no folder is enabled for the AI', async () => {
    setup({ folders: [] });
    expect((await screen.findByTestId('adv-search-unavailable')).getAttribute('data-reason')).toBe('no-folders');
    expect((screen.getByTestId('adv-search-go') as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not allow a search that would go over the cap', async () => {
    setup({ tweak: (ai) => void (ai.state.overCap = true) });
    expect(await screen.findByTestId('adv-search-over-cap')).toBeTruthy();
    expect((screen.getByTestId('adv-search-go') as HTMLButtonElement).disabled).toBe(true);
  });

  it('in Italian too', async () => {
    await i18n.changeLanguage('it');
    setup();
    expect(screen.getByTestId('adv-search-go').textContent).toBe('Cerca');
    await i18n.changeLanguage('en');
  });
});
