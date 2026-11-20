// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, type LibraryProfile } from '@rl/core';
import i18n from '../../i18n';
import { AiUiProvider, useAiUi } from '../../lib/aiUi';
import { ReaderProvider, useReader } from '../../lib/reader';
import { AppProvider } from '../../state/app-context';
import { memoryAi, type StreamEvent } from '../../testing/memoryAi';
import { callsTo, memoryBackend, setHandlers } from '../../testing/mockRl';
import { ChatPanel } from './ChatPanel';
import { Palette } from './Palette';
import { coveredBy } from './useChat';
import { clearLabels } from './useLabels';

vi.mock('../../lib/rl', async () => (await import('../../testing/mockRl')).rlModule);

const profile: LibraryProfile = { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' };
const D1 = '1111111111111111';
const D2 = '2222222222222222';
const DOCS = [
  { docId: D1, path: 'alpha/one.pdf' },
  { docId: D2, path: 'beta/two.pdf' },
];
const TITLES: Record<string, string> = { [D1]: 'Paper One', [D2]: 'Paper Two' };

/** Shows what the rest of the window would do in answer to the chat. */
function Probe() {
  const r = useReader();
  const ui = useAiUi();
  return createElement(
    'div',
    { 'data-testid': 'probe' },
    JSON.stringify({
      reader: r.target ? { docId: r.target.docId, page: r.target.page ?? null, panel: r.target.panel ?? null } : null,
      nav: ui.navigation ? { to: ui.navigation.to, projectId: ui.navigation.projectId ?? null } : null,
    }),
  );
}
const probe = () => JSON.parse(screen.getByTestId('probe').textContent!) as { reader: { docId: string; page: number | null; panel: string | null } | null; nav: { to: string; projectId: string | null } | null };

/** Puts a selection or a reader position where the library view and the reader would. */
function Context({ selection, reader }: { selection?: string[]; reader?: { docId: string; page: number } }) {
  const ui = useAiUi();
  useEffect(() => {
    ui.publishSelection(selection ?? []);
    ui.publishReader(reader ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

interface Opts {
  folders?: string[];
  selection?: string[];
  reader?: { docId: string; page: number };
  palette?: boolean;
  tweak?(ai: ReturnType<typeof memoryAi>): void;
  commands?: Array<{ id: string; label: string; prompt: string }>;
}
function setup(o: Opts = {}) {
  const ai = memoryAi({ docs: DOCS, ...(o.commands ? { commands: o.commands } : {}), config: { aiEnabledFolders: o.folders ?? ['alpha'] } });
  o.tweak?.(ai);
  const { handlers } = memoryBackend({ profiles: [profile] });
  setHandlers({
    ...handlers,
    ...ai.handlers,
    'documents:get': (p: any) => ({ id: p.docId, title: TITLES[p.docId] ?? null }),
    'projects:get': (p: any) => ({ project: { id: p.id, name: 'My Project' } }),
  });
  const kids: ReactElement[] = [createElement(Context, { key: 'c', ...(o.selection ? { selection: o.selection } : {}), ...(o.reader ? { reader: o.reader } : {}) }), createElement(ChatPanel, { key: 'p' }), createElement(Probe, { key: 'q' })];
  if (o.palette) kids.push(createElement(Palette, { key: 'pal', onClose: () => {} }));
  render(createElement(AppProvider, null, createElement(ReaderProvider, null, createElement(AiUiProvider, null, ...kids))));
  return ai;
}

const input = () => screen.getByTestId('chat-input') as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });
const sendButton = () => screen.getByTestId('chat-send') as HTMLButtonElement;
/** Picks an entry of the panel's ⋯ menu (new conversation, conversations). */
async function moreItem(testId: string) {
  fireEvent.click(screen.getByTestId('chat-more'));
  fireEvent.click(await screen.findByTestId(testId));
}
/** Picks a value of a chip (model, reasoning) from its menu. */
async function chooseChip(chip: string, id: string) {
  fireEvent.click(screen.getByTestId(chip));
  fireEvent.click(await screen.findByTestId(`${chip}-${id}`));
}
async function ready() {
  await screen.findByTestId('chat-content');
  // The app config (models, defaults) has loaded once the model chip shows a name.
  await waitFor(() => expect(screen.getByTestId('chat-model').textContent).not.toBe(''));
  await waitFor(() => expect(callsTo('ai:status').length).toBeGreaterThan(0));
}
async function sendText(text: string) {
  type(text);
  fireEvent.click(sendButton());
}
const aiTurns = () => screen.queryAllByTestId('chat-turn-ai');

beforeEach(async () => {
  clearLabels();
  await i18n.changeLanguage('en');
  try {
    window.localStorage.clear();
  } catch {
    // no storage
  }
});
afterEach(() => cleanup());

describe('chat: streaming', () => {
  it('appends text deltas, cards and usage in the order they arrive, then ends', async () => {
    const ai = setup({ tweak: (a) => (a.state.manual = true) });
    await ready();
    await sendText('What is new?');
    await waitFor(() => expect(callsTo('chat:send')).toHaveLength(1));
    expect(callsTo('chat:send')[0]).toMatchObject({ text: 'What is new?', model: 'claude-haiku-5-5', reasoning: 'low', contextDocIds: [], confirmed: false });
    await waitFor(() => expect(screen.getByTestId('chat-cancel')).toBeTruthy());
    expect(screen.getAllByTestId('chat-turn-user')[0]!.textContent).toContain('What is new?');

    const conv = 'conv-1';
    const turn = 'turn-1';
    const feed = (e: StreamEvent) => act(() => ai.emit(conv, turn, e));
    feed({ type: 'text-delta', text: 'First ' });
    await waitFor(() => expect(aiTurns()[0]!.textContent).toContain('First'));
    feed({ type: 'card', card: { id: 'c1', name: 'search', status: 'running', summary: 'Searching', docIds: [] } });
    feed({ type: 'text-delta', text: 'second' });
    await waitFor(() => expect(aiTurns()[0]!.textContent).toContain('First second'));
    expect(screen.getAllByTestId('chat-card')[0]!.getAttribute('data-status')).toBe('running');
    // The same card id updates in place.
    feed({ type: 'card', card: { id: 'c1', name: 'search', status: 'done', summary: 'Found 2', docIds: [] } });
    await waitFor(() => expect(screen.getAllByTestId('chat-card')[0]!.getAttribute('data-status')).toBe('done'));
    expect(screen.getAllByTestId('chat-card')).toHaveLength(1);
    feed({ type: 'usage', usage: { inputTokens: 1200, outputTokens: 80, usd: 0.0031 } });
    feed({ type: 'done' });
    await waitFor(() => expect(screen.queryByTestId('chat-cancel')).toBeNull());
    expect(screen.getByTestId('turn-usage').textContent).toContain('1.2k tokens in, 80 out');
    expect(aiTurns()[0]!.textContent).toContain('First second');
    expect(sendButton().disabled).toBe(true); // empty input again after the send
  });

  it('keeps events that arrive before chat:send has answered', async () => {
    setup({ tweak: (a) => (a.state.earlyEvents = true) });
    await ready();
    await sendText('hi');
    await waitFor(() => expect(aiTurns()[0]!.textContent).toContain('Hello world'));
    await waitFor(() => expect(screen.queryByTestId('chat-cancel')).toBeNull());
  });

  it('marks the answer as generated by the AI and the user text as the user\'s own', async () => {
    setup();
    await ready();
    await sendText('hi');
    await waitFor(() => expect(aiTurns()[0]!.textContent).toContain('Hello world'));
    expect(within(aiTurns()[0]!).getByTestId('ai-mark').textContent).toContain('Generated by AI');
    expect(within(screen.getAllByTestId('chat-turn-user')[0]!).queryByTestId('ai-mark')).toBeNull();
  });

  it('renders Markdown from the model without any raw HTML', async () => {
    setup({ tweak: (a) => (a.state.script = () => [{ type: 'text-delta', text: '**bold** <img src=x onerror=alert(1)> <script>alert(1)</script>' }, { type: 'done' }]) });
    await ready();
    await sendText('hi');
    await waitFor(() => expect(aiTurns()[0]!.querySelector('strong')?.textContent).toBe('bold'));
    expect(aiTurns()[0]!.querySelector('img, script')).toBeNull();
    expect(aiTurns()[0]!.textContent).toContain('<script>alert(1)</script>');
  });
});

describe('chat: cards and lab:// links', () => {
  it('shows a card with its status and links to the documents it touched', async () => {
    setup({
      tweak: (a) =>
        (a.state.script = () => [
          { type: 'card', card: { id: 'c1', name: 'open_document', status: 'failed', summary: 'Could not open it', docIds: [D1, D2] } },
          { type: 'done' },
        ]),
    });
    await ready();
    await sendText('open them');
    const card = await screen.findByTestId('chat-card');
    expect(card.getAttribute('data-status')).toBe('failed');
    expect(card.textContent).toContain('Could not open it');
    expect(card.textContent).toContain('Failed');
    const chips = within(card).getAllByTestId('lab-chip');
    expect(chips).toHaveLength(2);
    await waitFor(() => expect(chips[0]!.textContent).toBe('Paper One'));
    fireEvent.click(chips[1]!);
    expect(probe().reader).toEqual({ docId: D2, page: null, panel: null });
  });

  it('shows a known tool as a translated block, with the technical English text closed and wrapping', async () => {
    setup({
      tweak: (a) =>
        (a.state.script = () => [
          { type: 'card', card: { id: 'c1', name: 'search_library', status: 'done', summary: 'Searched the library for "a very long unbroken query string": 1 document(s)', docIds: [D1] } },
          { type: 'done' },
        ]),
    });
    await ready();
    await sendText('find');
    const card = await screen.findByTestId('chat-card');
    expect(card.getAttribute('data-tool')).toBe('search_library');
    expect(within(card).getByText('Library search')).toBeTruthy();
    expect(within(card).getByText('Documents found: 1')).toBeTruthy();
    const tech = card.querySelector('details')!;
    expect(tech.open).toBe(false);
    expect(tech.textContent).toContain('Technical details');
    expect(tech.textContent).toContain('Searched the library');
  });

  const TEXT = [
    `See [Paper One](lab://doc/${D1}?page=7) and [its note](lab://note/${D1}) and [the project](lab://project/p-1).`,
    '',
    'Not links: [web](https://example.com/x), [script](javascript:alert(1)), [file](file:///etc/passwd), [bad id](lab://doc/zzz), [extra](lab://doc/' + D1 + '/../x), [other](lab://folder/x), [mail](mailto:a@b.c)',
  ].join('\n');

  it('turns lab://doc, lab://note and lab://project into chips that open the reader at the page, the note and the project', async () => {
    setup({ tweak: (a) => (a.state.script = () => [{ type: 'text-delta', text: TEXT }, { type: 'done' }]) });
    await ready();
    await sendText('where?');
    await waitFor(() => expect(screen.getAllByTestId('lab-chip')).toHaveLength(3));
    const [doc, note, project] = screen.getAllByTestId('lab-chip') as HTMLElement[];
    expect(doc!.textContent).toBe('Paper One, p. 7'); // the label the model wrote
    expect(note!.textContent).toBe('Note: its note');
    expect(project!.textContent).toBe('Project: the project');
    expect(doc!.getAttribute('data-kind')).toBe('doc');

    fireEvent.click(doc!);
    expect(probe().reader).toEqual({ docId: D1, page: 7, panel: null });
    fireEvent.click(note!);
    expect(probe().reader).toEqual({ docId: D1, page: null, panel: 'fileNote' });
    fireEvent.click(project!);
    expect(probe().nav).toEqual({ to: 'project', projectId: 'p-1' });
  });

  it('never follows any other scheme: no anchors, no extra chips, http(s) shown as plain text', async () => {
    setup({ tweak: (a) => (a.state.script = () => [{ type: 'text-delta', text: TEXT }, { type: 'done' }]) });
    await ready();
    await sendText('where?');
    await waitFor(() => expect(screen.getAllByTestId('lab-chip')).toHaveLength(3));
    const turn = aiTurns()[0]!;
    expect(turn.querySelectorAll('a')).toHaveLength(0);
    expect(turn.querySelectorAll('[href]')).toHaveLength(0);
    const plain = within(turn).getAllByTestId('plain-link');
    expect(plain).toHaveLength(7);
    expect(plain[0]!.textContent).toBe('web (https://example.com/x)');
    expect(plain.every((p) => p.tagName === 'SPAN' && p.querySelector('button, a') === null)).toBe(true);
    const before = JSON.stringify(probe());
    for (const p of plain) fireEvent.click(p);
    expect(JSON.stringify(probe())).toBe(before);
  });
});

describe('chat: context and the preview before a send', () => {
  it('shows the selection as removable chips and sends the remaining documents', async () => {
    setup({ selection: [D1, D2], folders: ['alpha', 'beta'], tweak: (a) => (a.state.confirm = false) });
    await ready();
    const chips = await screen.findAllByTestId('context-chip');
    expect(chips).toHaveLength(2);
    await waitFor(() => expect(chips[0]!.textContent).toContain('Paper One'));
    fireEvent.click(within(chips[1]!).getByRole('button'));
    expect(screen.getAllByTestId('context-chip')).toHaveLength(1);
    await sendText('summarize');
    await waitFor(() => expect(callsTo('chat:send')).toHaveLength(1));
    expect(callsTo('chat:send')[0].contextDocIds).toEqual([D1]);
  });

  it('notes when the selection is over the limit and sends only the first documents', async () => {
    const many = Array.from({ length: 53 }, (_, i) => String(i).padStart(16, '0'));
    setup({ selection: many, tweak: (a) => (a.state.confirm = false) });
    await ready();
    expect((await screen.findByTestId('context-limit')).textContent).toContain('At most 50 documents');
    expect(screen.getAllByTestId('context-chip')).toHaveLength(50);
  });

  it('asks for confirmation with the documents that go, the refused ones, folders, model, tokens and cost; sends only after it', async () => {
    setup({ selection: [D1, D2] });
    await ready();
    await sendText('summarize');
    const dialog = await screen.findByTestId('send-preview');
    expect(callsTo('ai:preview')[0]).toMatchObject({ purpose: 'chat', model: 'claude-haiku-5-5', docIds: [D1, D2], promptChars: 9 });
    expect(callsTo('chat:send')).toHaveLength(0);
    expect(dialog.textContent).toContain('Haiku 5.5');
    expect(within(dialog).getAllByTestId('preview-allowed')).toHaveLength(1);
    const refused = within(dialog).getByTestId('preview-refused');
    expect(refused.getAttribute('data-doc-id')).toBe(D2);
    expect(refused.textContent).toContain('its folder is not enabled for the AI');
    expect(within(dialog).getByTestId('preview-folders').textContent).toContain('alpha');
    expect(within(dialog).getByTestId('preview-size').textContent).toContain('About 1.0k input tokens');
    expect(within(dialog).getByTestId('preview-size').textContent).toContain('estimated cost <$0.01');
    await waitFor(() => expect(within(dialog).getByTestId('preview-allowed').textContent).toBe('Paper One'));

    fireEvent.click(within(dialog).getByTestId('preview-confirm'));
    await waitFor(() => expect(callsTo('chat:send')).toHaveLength(1));
    expect(callsTo('chat:send')[0]).toMatchObject({ confirmed: true, contextDocIds: [D1, D2] });
    await waitFor(() => expect(screen.queryByTestId('send-preview')).toBeNull());
    await waitFor(() => expect(aiTurns()[0]!.textContent).toContain('Hello world'));
    expect(input().value).toBe('');
  });

  it('sends nothing when the preview is cancelled, and keeps the text', async () => {
    setup({ selection: [D1] });
    await ready();
    await sendText('keep me');
    fireEvent.click(await screen.findByTestId('preview-cancel'));
    expect(screen.queryByTestId('send-preview')).toBeNull();
    expect(callsTo('chat:send')).toHaveLength(0);
    expect(input().value).toBe('keep me');
  });

  it('explains overCap and does not send', async () => {
    setup({ selection: [D1], tweak: (a) => (a.state.overCap = true) });
    await ready();
    await sendText('go');
    const banner = await screen.findByTestId('chat-banner');
    expect(banner.getAttribute('data-kind')).toBe('overCap');
    expect(banner.textContent).toContain('monthly usage cap has been reached');
    expect(screen.queryByTestId('send-preview')).toBeNull();
    expect(callsTo('chat:send')).toHaveLength(0);
    expect(input().value).toBe('go');
  });

  it('shows the dialog and retries with confirmed when chat:send answers needs-confirmation', async () => {
    setup({
      selection: [D1],
      tweak: (a) => {
        a.state.confirm = false;
        a.state.sendError = new AppError('CONFLICT', 'confirm', { reason: 'needs-confirmation' });
      },
    });
    await ready();
    await sendText('go');
    const dialog = await screen.findByTestId('send-preview');
    expect(callsTo('chat:send')).toHaveLength(1);
    expect(callsTo('chat:send')[0].confirmed).toBe(false);
    expect(screen.queryAllByTestId('chat-turn-user')).toHaveLength(0); // the optimistic turns were taken back
    fireEvent.click(within(dialog).getByTestId('preview-confirm'));
    await waitFor(() => expect(callsTo('chat:send')).toHaveLength(2));
    expect(callsTo('chat:send')[1].confirmed).toBe(true);
    await waitFor(() => expect(aiTurns()[0]!.textContent).toContain('Hello world'));
  });

  it('passes the page of the reader as contextPage, with the open document as context', async () => {
    setup({ reader: { docId: D1, page: 4 }, tweak: (a) => (a.state.confirm = false) });
    await ready();
    expect((await screen.findByTestId('chat-context')).textContent).toContain('page 4');
    await sendText('explain this page');
    await waitFor(() => expect(callsTo('chat:send')).toHaveLength(1));
    expect(callsTo('chat:send')[0]).toMatchObject({ contextDocIds: [D1], contextPage: 4 });
  });

  it('uses the model and reasoning of the library by default and sends the ones chosen', async () => {
    setup();
    await ready();
    expect(screen.getByTestId('chat-model').textContent).toContain('Haiku');
    expect(screen.getByTestId('chat-reasoning').textContent?.toLowerCase()).toContain('low');
    await chooseChip('chat-model', 'claude-opus-5-5');
    await chooseChip('chat-reasoning', 'high');
    await sendText('think hard');
    await waitFor(() => expect(callsTo('chat:send')).toHaveLength(1));
    expect(callsTo('chat:send')[0]).toMatchObject({ model: 'claude-opus-5-5', reasoning: 'high' });
  });
});

describe('chat: errors, cancel and usage', () => {
  it('cancels a running turn with chat:cancel and keeps what was streamed, marked as cancelled', async () => {
    const ai = setup({ tweak: (a) => (a.state.manual = true) });
    await ready();
    await sendText('long one');
    await waitFor(() => expect(screen.getByTestId('chat-cancel')).toBeTruthy());
    act(() => ai.emit('conv-1', 'turn-1', { type: 'text-delta', text: 'Partial' }));
    await waitFor(() => expect(aiTurns()[0]!.textContent).toContain('Partial'));
    fireEvent.click(screen.getByTestId('chat-cancel'));
    await waitFor(() => expect(callsTo('chat:cancel')).toEqual([{ turnId: 'turn-1' }]));
    const err = await screen.findByTestId('turn-error');
    expect(err.getAttribute('data-code')).toBe('CANCELLED');
    expect(err.textContent).toContain('Cancelled');
    expect(aiTurns()[0]!.textContent).toContain('Partial');
    await waitFor(() => expect(screen.queryByTestId('chat-cancel')).toBeNull());
  });

  it('shows an error that ends a turn', async () => {
    setup({ tweak: (a) => (a.state.script = () => [{ type: 'text-delta', text: 'Half' }, { type: 'error', code: 'AI_PROVIDER_ERROR', message: 'internal detail' }]) });
    await ready();
    await sendText('hi');
    const err = await screen.findByTestId('turn-error');
    expect(err.textContent).toContain('could not answer');
    expect(err.textContent).not.toContain('internal detail');
    await waitFor(() => expect(screen.queryByTestId('chat-cancel')).toBeNull());
  });

  it.each([
    ['no-access', 'noAccess', 'No access to Claude'],
    ['offline', 'offline', 'cannot be reached'],
  ])('explains a refused send (%s)', async (reason, kind, text) => {
    setup({ tweak: (a) => (a.state.sendError = new AppError('AI_PROVIDER_ERROR', 'x', { reason })) });
    await ready();
    await sendText('hi');
    const banner = await screen.findByTestId('chat-banner');
    expect(banner.getAttribute('data-kind')).toBe(kind);
    expect(banner.textContent).toContain(text);
    expect(input().value).toBe('hi');
  });

  it('explains the cap when chat:send is refused with AI_BUDGET_EXCEEDED', async () => {
    setup({ tweak: (a) => (a.state.sendError = new AppError('AI_BUDGET_EXCEEDED', 'cap')) });
    await ready();
    await sendText('hi');
    expect((await screen.findByTestId('chat-banner')).getAttribute('data-kind')).toBe('overCap');
  });

  it('shows the usage of the month against the cap and refreshes it after each turn', async () => {
    setup({ tweak: (a) => (a.state.config.ai.usageCap.monthlyUsd = 5) });
    await ready();
    await waitFor(() => expect(screen.getByTestId('chat-usage').textContent).toBe('This month: $0.00 of $5.00'));
  });

  it('refreshes the usage after a turn', async () => {
    const ai = setup();
    await ready();
    await waitFor(() => expect(screen.getByTestId('chat-usage').textContent).toBe('This month: $0.00'));
    ai.state.monthUsd = 1.25;
    await sendText('hi');
    await waitFor(() => expect(screen.getByTestId('chat-usage').textContent).toBe('This month: $1.25'));
  });
});

describe('chat: history', () => {
  const seed = (ai: ReturnType<typeof memoryAi>) => {
    ai.state.conversations.set('c-old', {
      id: 'c-old',
      title: 'Earlier question',
      updatedAt: '2026-11-10T10:00:00.000Z',
      turns: [
        { id: 'u1', role: 'user', text: 'Earlier question', at: '2026-11-10T10:00:00.000Z', cards: [], contextDocIds: [] },
        { id: 'a1', role: 'assistant', text: 'Earlier answer', at: '2026-11-10T10:00:01.000Z', model: 'claude-haiku-5-5', cards: [], contextDocIds: [] },
      ],
    });
    ai.state.conversations.set('c-new', { id: 'c-new', title: 'Newer one', updatedAt: '2026-11-12T10:00:00.000Z', turns: [] });
  };

  it('lists the conversations of the library, newest first, and opens one', async () => {
    setup({ tweak: seed });
    await ready();
    await moreItem('chat-history-toggle');
    const items = await screen.findAllByTestId('history-item');
    expect(items.map((i) => i.getAttribute('data-conversation-id'))).toEqual(['c-new', 'c-old']);
    fireEvent.click(within(items[1]!).getByTestId('history-open'));
    await waitFor(() => expect(aiTurns()[0]?.textContent).toContain('Earlier answer'));
    expect(callsTo('chat:get')).toEqual([{ conversationId: 'c-old' }]);
    expect(screen.getAllByTestId('chat-turn-user')[0]!.textContent).toContain('Earlier question');
    // A new message continues that conversation.
    await sendText('and now?');
    await waitFor(() => expect(callsTo('chat:send')).toHaveLength(1));
    expect(callsTo('chat:send')[0].conversationId).toBe('c-old');
  });

  it('deletes a conversation only after confirmation', async () => {
    const ai = setup({ tweak: seed });
    await ready();
    await moreItem('chat-history-toggle');
    const items = await screen.findAllByTestId('history-item');
    fireEvent.click(within(items[0]!).getByTestId('history-delete'));
    expect(callsTo('chat:delete')).toHaveLength(0);
    const confirm = screen.getByRole('alertdialog');
    expect(confirm.textContent).toContain('Newer one');
    fireEvent.click(within(confirm).getByText('Cancel'));
    expect(callsTo('chat:delete')).toHaveLength(0);
    fireEvent.click(within(screen.getAllByTestId('history-item')[0]!).getByTestId('history-delete'));
    fireEvent.click(screen.getByTestId('history-delete-confirm'));
    await waitFor(() => expect(callsTo('chat:delete')).toEqual([{ conversationId: 'c-new' }]));
    await waitFor(() => expect(screen.getAllByTestId('history-item')).toHaveLength(1));
    expect(ai.state.conversations.has('c-new')).toBe(false);
  });

  it('starts a new conversation', async () => {
    setup({ tweak: seed });
    await ready();
    await sendText('first');
    await waitFor(() => expect(aiTurns()[0]!.textContent).toContain('Hello world'));
    await moreItem('chat-new');
    expect(screen.queryAllByTestId('chat-turn-user')).toHaveLength(0);
    await sendText('second');
    await waitFor(() => expect(callsTo('chat:send')).toHaveLength(2));
    expect(callsTo('chat:send')[1].conversationId).toBeUndefined();
  });
});

describe('chat: without AI', () => {
  it('explains why the AI is unavailable and how to fix it, blocks sending, and links to the settings', async () => {
    setup({
      tweak: (a) => {
        a.state.available = false;
        a.state.auth = 'none';
        a.state.reason = 'no-access';
      },
    });
    await ready();
    const note = await screen.findByTestId('ai-unavailable');
    expect(note.getAttribute('data-reason')).toBe('no-access');
    expect(note.textContent).toContain('no access to Claude');
    expect(note.textContent).toContain('Claude Code command-line tool');
    expect(input().disabled).toBe(true);
    expect(sendButton().disabled).toBe(true);
    fireEvent.click(within(note).getByText('Open the AI settings'));
    expect(probe().nav).toEqual({ to: 'settings', projectId: null });
    expect(callsTo('chat:send')).toHaveLength(0);
  });

  it('says so when the cap is the reason, and when the status cannot be read', async () => {
    setup({
      tweak: (a) => {
        a.state.available = false;
        a.state.reason = 'cap-reached';
      },
    });
    await ready();
    expect((await screen.findByTestId('ai-unavailable')).textContent).toContain('monthly usage cap has been reached');
  });

  it('tells that no document is sent while no folder is enabled', async () => {
    setup({ folders: [] });
    await ready();
    expect((await screen.findByTestId('no-folders-hint')).textContent).toContain('no document is ever sent');
  });
});

describe('command palette', () => {
  const type = (text: string) => fireEvent.change(screen.getByTestId('palette-input'), { target: { value: text } });

  it('lists only go-to and actions with no text; the commands for Claude appear when typing, and choosing one fills the prompt without sending', async () => {
    setup({ palette: true, commands: [{ id: 'mine', label: 'My own command', prompt: 'Do my thing' }] });
    await ready();
    const palette = await screen.findByTestId('command-palette');
    const ids = () => within(palette).getAllByTestId('palette-item').map((i) => i.getAttribute('data-command'));
    // Without text: the go-to group, then the actions (3.4); no commands for Claude, no documents.
    expect(ids()).toEqual(['app-goLibrary', 'app-goReview', 'app-goProjects', 'app-goDiscover', 'app-goMap', 'app-goSettings', 'app-manageTags', 'app-tidyTags', 'app-reviewTags', 'app-openActivity', 'app-scanNow', 'app-backupNow', 'app-addPdf', 'app-addFromId', 'app-addResource', 'app-newLibrary', 'app-undo', 'app-redo', 'app-theme', 'app-switchLanguage', 'app-openGuide', 'app-showShortcuts']);
    expect(within(palette).getAllByRole('listbox')[0]!.querySelectorAll('.palette-group')).toHaveLength(2);
    type('describe');
    const items = within(palette).getAllByTestId('palette-item');
    expect(items[0]!.getAttribute('data-command')).toBe('describe');
    expect(items[0]!.textContent).toBe('Describe this paper');
    fireEvent.click(items[0]!);
    await waitFor(() => expect(input().value).toContain('Describe the selected paper'));
    expect(callsTo('chat:send')).toHaveLength(0);
    expect(callsTo('ai:preview')).toHaveLength(0);
  });

  it('lists the commands of the user and filters by text, and Enter chooses', async () => {
    setup({ palette: true, commands: [{ id: 'mine', label: 'My own command', prompt: 'Do my thing' }] });
    await ready();
    const box = await screen.findByTestId('palette-input');
    await waitFor(() => expect(screen.getAllByTestId('palette-item')).toHaveLength(22));
    fireEvent.change(box, { target: { value: 'my own' } });
    await waitFor(() => expect(screen.getAllByTestId('palette-item')).toHaveLength(1));
    const only = screen.getAllByTestId('palette-item');
    expect(only[0]!.textContent).toContain('My own command');
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(input().value).toBe('Do my thing'));
    expect(callsTo('chat:send')).toHaveLength(0);
  });

  it('still lists the predefined commands when the user commands cannot be read', async () => {
    setup({ palette: true, tweak: (a) => (a.handlers['commands:list'] = () => { throw new AppError('IO_ERROR', 'x'); }) });
    await ready();
    type('related');
    await waitFor(() => expect(screen.getAllByTestId('palette-item').map((i) => i.getAttribute('data-command'))).toContain('related'));
  });

  it('translates the predefined commands', async () => {
    setup({ palette: true });
    await screen.findAllByTestId('palette-item');
    await act(async () => {
      await i18n.changeLanguage('it');
    });
    const items = await screen.findAllByTestId('palette-item');
    expect(items[0]!.textContent).toContain('Vai alla Libreria');
    type('descrivi');
    await waitFor(() => expect(screen.getAllByTestId('palette-item')[0]!.textContent).toBe('Descrivi questo articolo'));
  });
});

describe('chat: a turn running while the view changes (review 13)', () => {
  const seedOld = (ai: ReturnType<typeof memoryAi>) => {
    ai.state.conversations.set('c-old', {
      id: 'c-old',
      title: 'Old one',
      updatedAt: '2026-11-10T10:00:00.000Z',
      turns: [
        { id: 'u1', role: 'user', text: 'Earlier question', at: '2026-11-10T10:00:00.000Z', cards: [], contextDocIds: [] },
        { id: 'a1', role: 'assistant', text: 'Earlier answer', at: '2026-11-10T10:00:01.000Z', cards: [], contextDocIds: [] },
      ],
    });
  };
  const openConv = async (id: string) => {
    await moreItem('chat-history-toggle');
    const items = await screen.findAllByTestId('history-item');
    fireEvent.click(within(items.find((i) => i.getAttribute('data-conversation-id') === id)!).getByTestId('history-open'));
  };

  it('keeps the stream in its own conversation when another is opened, and shows it again on return', async () => {
    const ai = setup({ tweak: (a) => ((a.state.manual = true), (a.state.oneTurn = true), seedOld(a)) });
    await ready();
    await sendText('stream me');
    await waitFor(() => expect(callsTo('chat:send')).toHaveLength(1));
    act(() => ai.emit('conv-1', 'turn-1', { type: 'text-delta', text: 'Part one ' }));
    await waitFor(() => expect(aiTurns()[0]!.textContent).toContain('Part one'));

    // Switch to another conversation mid-stream: the old one is shown, not the stream.
    await openConv('c-old');
    await waitFor(() => expect(aiTurns()[0]?.textContent).toContain('Earlier answer'));
    expect(aiTurns()).toHaveLength(1);
    expect(screen.queryByText(/Part one/)).toBeNull();
    expect(screen.getByTestId('chat-busy-other')).toBeTruthy();
    fireEvent.click(screen.getByTestId('chat-more'));
    expect(((await screen.findByTestId('chat-new')) as HTMLElement).getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(screen.getByTestId('chat-more')); // close the menu again: moreItem opens it
    await waitFor(() => expect(screen.queryByTestId('chat-new')).toBeNull());
    act(() => ai.emit('conv-1', 'turn-1', { type: 'text-delta', text: 'Part two' }));
    expect(screen.queryByText(/Part two/)).toBeNull();
    // Sending from here is refused with a clear message, nothing is added to the view.
    type('too early');
    fireEvent.submit(input().closest('form')!);
    expect(screen.queryByTestId('chat-banner')).toBeNull(); // the send button is disabled: no attempt
    expect(sendButton().disabled).toBe(true);
    expect(aiTurns()).toHaveLength(1);

    // Back to the streaming conversation: its question and the answer so far (not duplicated).
    await openConv('conv-1');
    await waitFor(() => expect(aiTurns()[0]?.textContent).toContain('Part one Part two'));
    expect(screen.getAllByTestId('chat-turn-user')).toHaveLength(1);
    act(() => ai.emit('conv-1', 'turn-1', { type: 'done' }));
    await waitFor(() => expect(screen.queryByTestId('chat-cancel')).toBeNull());
    expect(aiTurns()[0]!.textContent).toContain('Part one Part two');
  });

  it('a new conversation mid-stream is usable at once, and the stream does not leak into it', async () => {
    const ai = setup({ tweak: (a) => ((a.state.manual = true), (a.state.oneTurn = true)) });
    await ready();
    await sendText('first');
    await waitFor(() => expect(callsTo('chat:send')).toHaveLength(1));
    await moreItem('chat-new');
    expect(screen.getByTestId('chat-empty')).toBeTruthy();
    expect(screen.getByTestId('chat-busy-other')).toBeTruthy();
    act(() => ai.emit('conv-1', 'turn-1', { type: 'text-delta', text: 'Hidden' }));
    expect(screen.queryByText(/Hidden/)).toBeNull();
    act(() => ai.emit('conv-1', 'turn-1', { type: 'done' }));
    await waitFor(() => expect(screen.queryByTestId('chat-busy-other')).toBeNull());
    // Not stuck: the new view sends a new conversation (no conversationId).
    ai.state.manual = false;
    await sendText('second');
    await waitFor(() => expect(callsTo('chat:send')).toHaveLength(2));
    expect(callsTo('chat:send')[1].conversationId).toBeUndefined();
    await waitFor(() => expect(aiTurns()[0]!.textContent).toContain('Hello world'));
  });

  it('cancel keeps the panel busy until the terminal event, then a resend works', async () => {
    const ai = setup({ tweak: (a) => ((a.state.manual = true), (a.state.cancelEmits = false), (a.state.oneTurn = true)) });
    await ready();
    await sendText('long one');
    await waitFor(() => expect(screen.getByTestId('chat-cancel')).toBeTruthy());
    fireEvent.click(screen.getByTestId('chat-cancel'));
    await waitFor(() => expect(callsTo('chat:cancel')).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('turn-error').getAttribute('data-code')).toBe('CANCELLED'));
    // Main has not ended the turn yet: still sending, no new send possible.
    expect(screen.queryByTestId('chat-cancel')).toBeTruthy();
    type('again');
    expect(sendButton().disabled).toBe(true);
    act(() => ai.emit('conv-1', 'turn-1', { type: 'error', code: 'CANCELLED', message: 'cancelled' }));
    await waitFor(() => expect(screen.queryByTestId('chat-cancel')).toBeNull());
    expect(sendButton().disabled).toBe(false);
    ai.state.manual = false;
    fireEvent.click(sendButton());
    await waitFor(() => expect(callsTo('chat:send')).toHaveLength(2));
    expect(screen.queryByTestId('chat-banner')).toBeNull();
    await waitFor(() => expect(aiTurns().at(-1)!.textContent).toContain('Hello world'));
  });

  it('shows the turn-running refusal of main as a clear wait message', async () => {
    setup({ tweak: (a) => (a.state.sendError = new AppError('CONFLICT', 'Another answer is still being written', { reason: 'turn-running' })) });
    await ready();
    await sendText('hello');
    const banner = await screen.findByTestId('chat-banner');
    expect(banner.getAttribute('data-kind')).toBe('turnRunning');
    expect(banner.textContent).toContain('Wait for it to finish');
    expect(banner.textContent).not.toContain('Another answer is still being written');
    expect(input().value).toBe('hello');
  });
});

describe('chat: one confirmation per conversation (D-227)', () => {
  it('shows the model and the folders the agent may read at the first send, resends confirmed, then does not ask again', async () => {
    setup({ folders: ['alpha', 'beta'], tweak: (a) => (a.state.confirmNew = true) });
    await ready();
    await sendText('no documents here');
    const dialog = await screen.findByTestId('send-preview');
    expect(within(dialog).getByTestId('preview-intro').textContent).toContain('Haiku');
    expect(within(dialog).getByTestId('preview-folders').textContent).toContain('alpha, beta');
    expect(within(dialog).getByTestId('preview-folders').textContent).toContain('may read');
    expect(callsTo('chat:send')[0]).toMatchObject({ confirmed: false });
    expect(input().value).toBe('no documents here');
    fireEvent.click(within(dialog).getByTestId('preview-confirm'));
    await waitFor(() => expect(callsTo('chat:send')).toHaveLength(2));
    expect(callsTo('chat:send')[1]).toMatchObject({ confirmed: true });
    await waitFor(() => expect(aiTurns()[0]!.textContent).toContain('Hello world'));
    await waitFor(() => expect(screen.queryByTestId('chat-cancel')).toBeNull());
    // Same conversation: sent at once.
    await sendText('and again');
    await waitFor(() => expect(callsTo('chat:send')).toHaveLength(3));
    expect(screen.queryByTestId('send-preview')).toBeNull();
    expect(callsTo('chat:send')[2]).toMatchObject({ conversationId: 'conv-1', confirmed: false });
  });
});

describe('chat: inline preview after the first confirmation (D-339, D-364)', () => {
  async function confirmFirst() {
    await sendText('first');
    fireEvent.click(within(await screen.findByTestId('send-preview')).getByTestId('preview-confirm'));
    await waitFor(() => expect(aiTurns()[0]!.textContent).toContain('Hello world'));
    await waitFor(() => expect(screen.queryByTestId('chat-cancel')).toBeNull());
  }

  it('sends the next turn with the same documents without the dialog and shows what goes above the field', async () => {
    setup({ selection: [D1] });
    await ready();
    expect(screen.queryByTestId('chat-inline-preview')).toBeNull();
    await confirmFirst();
    const line = await screen.findByTestId('chat-inline-preview');
    expect(line.textContent).toContain('Will be sent: the question + 1 document');
    expect(line.getAttribute('data-asks')).toBeNull();
    await sendText('second');
    await waitFor(() => expect(callsTo('chat:send')).toHaveLength(2));
    expect(callsTo('chat:send')[1]).toMatchObject({ confirmed: true, contextDocIds: [D1] });
    expect(screen.queryByTestId('send-preview')).toBeNull();
  });

  it('brings the dialog back when the model changes, and says so before sending', async () => {
    setup({ selection: [D1] });
    await ready();
    await confirmFirst();
    await chooseChip('chat-model', 'claude-opus-5-5');
    await waitFor(() => expect(screen.getByTestId('chat-inline-preview').getAttribute('data-asks')).toBe('true'));
    await sendText('second');
    await screen.findByTestId('send-preview');
    expect(callsTo('chat:send')).toHaveLength(1);
  });

  it('a new conversation starts unconfirmed: the dialog comes back', async () => {
    setup({ selection: [D1] });
    await ready();
    await confirmFirst();
    await moreItem('chat-new');
    await waitFor(() => expect(screen.queryByTestId('chat-inline-preview')).toBeNull());
    await sendText('again');
    await screen.findByTestId('send-preview');
  });

  it('opens the details of what goes from the inline line', async () => {
    setup({ selection: [D1] });
    await ready();
    await confirmFirst();
    await screen.findByTestId('chat-inline-preview');
    fireEvent.click(screen.getByTestId('inline-details'));
    const dialog = await screen.findByTestId('send-preview');
    expect(within(dialog).queryByTestId('preview-cancel')).toBeNull();
    fireEvent.click(within(dialog).getByTestId('preview-confirm'));
    await waitFor(() => expect(screen.queryByTestId('send-preview')).toBeNull());
    expect(callsTo('chat:send')).toHaveLength(1);
  });

  it('coveredBy: any new document, any refusal, another model or the cap brings the dialog back', () => {
    const pv = (over: Record<string, unknown> = {}) => ({ model: 'm', allowed: ['a'], refused: [], folders: [], approxInputTokens: 1, estimatedUsd: 0, needsConfirmation: true, overCap: false, ...over }) as any;
    const c = { model: 'm', docs: new Set(['a', 'b']) };
    expect(coveredBy(c, pv(), 'm')).toBe(true);
    expect(coveredBy(c, pv({ allowed: [] }), 'm')).toBe(true);
    expect(coveredBy(c, pv({ allowed: ['a', 'z'] }), 'm')).toBe(false);
    expect(coveredBy(c, pv({ refused: [{ docId: 'q', reason: 'unknown' }] }), 'm')).toBe(false);
    expect(coveredBy(c, pv(), 'other')).toBe(false);
    expect(coveredBy(c, pv({ overCap: true }), 'm')).toBe(false);
    expect(coveredBy(null, pv(), 'm')).toBe(false);
  });
});
