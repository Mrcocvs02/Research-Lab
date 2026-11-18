// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, type LibraryProfile } from '@rl/core';
import i18n from '../../i18n';
import { AiUiProvider, useAiUi } from '../../lib/aiUi';
import { LibraryEventsProvider } from '../../lib/events';
import { HistoryProvider } from '../../lib/history';
import { InboxProvider } from '../../lib/inbox';
import { JobsProvider } from '../../lib/jobs';
import { NotifyProvider } from '../../lib/notify';
import { ReaderProvider } from '../../lib/reader';
import { Shell } from '../../shell/Shell';
import { AppProvider } from '../../state/app-context';
import { memoryAi } from '../../testing/memoryAi';
import { memoryWork } from '../../testing/memoryWork';
import { callsTo, emitEvent, memoryBackend, setHandlers } from '../../testing/mockRl';
import { clearLabels } from '../chat/useLabels';
import { InboxView } from './InboxView';

vi.mock('../../lib/rl', async () => (await import('../../testing/mockRl')).rlModule);

const profile: LibraryProfile = { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' };
const node = (id: string, label: string) => ({ id, label, parents: [], aliases: [], implies: [], status: 'active', color: undefined, counts: { direct: 0, total: 0 } });

function Probe() {
  const ui = useAiUi();
  return createElement('div', { 'data-testid': 'probe' }, ui.navigation?.to ?? '');
}
function Section() {
  const [tab, setTab] = useState<'arrivals' | 'proposals'>('arrivals');
  const { navigation } = useAiUi();
  // what the app root does with a navigation request
  const [seen, setSeen] = useState(0);
  if (navigation && navigation.nonce !== seen) {
    setSeen(navigation.nonce);
    setTab(navigation.to === 'review' ? 'proposals' : 'arrivals');
  }
  return createElement(InboxView, { tab, onTab: setTab });
}

function setup(o: { items?: any[]; folders?: string[]; tweak?(w: ReturnType<typeof memoryWork>, ai: ReturnType<typeof memoryAi>): void } = {}) {
  const ai = memoryAi({ docs: [], folders: o.folders ?? ['alpha', 'beta'], config: { aiEnabledFolders: ['alpha'] } });
  const work = memoryWork(ai);
  work.state.inbox = o.items ?? [];
  o.tweak?.(work, ai);
  const { handlers } = memoryBackend({ profiles: [profile] });
  setHandlers({
    ...handlers,
    ...ai.handlers,
    ...work.handlers,
    'scan:status': () => ({ libraryId: 'lib-a', state: 'idle', seen: 0, processed: 0, indexed: 0 }),
    'documents:get': (p: any) => ({ id: p.docId, title: 'Existing Paper' }),
    'taxonomy:get': () => ({ revision: 1, nodes: [node('tag-a', 'Alpha tag'), node('tag-b', 'Beta tag')], venues: [], documentTypes: [] }),
    'history:list': () => ({ items: [], canUndo: true, canRedo: false }),
    'history:undo': () => ({ summary: 'inbox' }),
    'review:list': () => ({ items: [], total: 0 }),
    'review:stats': () => ({ pending: {}, tags: { proposed: 0, accepted: 0, rate: null }, newTags: { proposed: 0, accepted: 0 } }),
  });
  const providers: any[] = [AppProvider, LibraryEventsProvider, NotifyProvider, HistoryProvider, ReaderProvider, AiUiProvider, JobsProvider, InboxProvider];
  render(providers.reduceRight((child, P) => createElement(P, null, child), createElement('div', null, createElement(Shell, { section: 'review', onSection() {}, onNewLibrary() {}, children: createElement(Section) }), createElement(Probe))));
  return work;
}

/** A drag event as the window receives it (happy-dom has no DataTransfer). */
function drag(type: string, files: File[] = []) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { types: ['Files'], files, dropEffect: '' } });
  act(() => void window.dispatchEvent(e));
  return e;
}
const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' });

beforeEach(async () => {
  clearLabels();
  await i18n.changeLanguage('en');
  (window as any).rlBridge = { pathForFile: (f: File) => (f.name === 'nopath.pdf' ? '' : `drop/${f.name}`) };
});
afterEach(() => {
  cleanup();
  delete (window as any).rlBridge;
});

const card = () => screen.getByTestId('inbox-item');

describe('inbox: dropping and choosing PDFs', () => {
  it('shows a hint while dragging, adds the dropped files by path, lists the refused ones and counts them in the badge', async () => {
    const work = setup();
    await screen.findByTestId('inbox-view');
    drag('dragenter');
    expect(screen.getByTestId('drop-hint')).toBeTruthy();
    drag('dragleave');
    expect(screen.queryByTestId('drop-hint')).toBeNull();

    drag('dragenter');
    const e = drag('drop', [pdf('one.pdf'), new File(['x'], 'notes.txt'), pdf('nopath.pdf')]);
    expect(e.defaultPrevented).toBe(true);
    expect(screen.queryByTestId('drop-hint')).toBeNull();
    await waitFor(() => expect(work.state.added).toEqual([['drop/one.pdf', 'drop/notes.txt']]));
    expect(await screen.findByTestId('inbox-badge')).toBeTruthy();
    expect(screen.getByTestId('inbox-badge').textContent).toBe('1');
    expect(screen.getByTestId('probe').textContent).toBe('inbox');
    const refused = await screen.findByTestId('inbox-refused');
    expect(within(refused).getByTestId('inbox-refused-item').textContent).toContain('notes.txt — not a PDF file');
    expect(await screen.findAllByTestId('inbox-item')).toHaveLength(1);
  });

  it('ignores drags that carry no files', async () => {
    setup();
    await screen.findByTestId('inbox-view');
    const e = new Event('dragenter', { cancelable: true });
    Object.defineProperty(e, 'dataTransfer', { value: { types: ['text/plain'], files: [] } });
    act(() => void window.dispatchEvent(e));
    expect(screen.queryByTestId('drop-hint')).toBeNull();
    expect(e.defaultPrevented).toBe(false);
  });

  it('adds files with the "Add PDF…" button (dialog of the main process)', async () => {
    const work = setup({
      tweak: (w) => {
        w.state.chooseResult = { added: [w.makeItem('chosen.pdf')], refused: [{ name: 'big.pdf', reason: 'too-large' }] };
      },
    });
    fireEvent.click(await screen.findByTestId('inbox-add'));
    await waitFor(() => expect(callsTo('inbox:choose')).toHaveLength(1));
    expect(await screen.findByTestId('inbox-refused-item')).toBeTruthy();
    expect(screen.getByTestId('inbox-refused-item').getAttribute('data-reason')).toBe('too-large');
    expect(work.state.inbox).toHaveLength(1);
  });
});

describe('inbox: an item', () => {
  it('shows the file, identifiers and lookup state, retries a failed lookup, and follows inbox:changed', async () => {
    const work = setup({ tweak: (w) => void (w.state.inbox = [w.makeItem('paper.pdf', { lookup: { state: 'offline' }, metadata: null })]) });
    await screen.findByTestId('inbox-item');
    fireEvent.click(screen.getByTestId('inbox-edit'));
    expect(screen.getByTestId('inbox-file-name').textContent).toBe('paper.pdf');
    expect(screen.getByTestId('inbox-size').textContent).toBe('2 KB');
    expect(screen.getByTestId('inbox-detected').textContent).toContain('DOI 10.1000/test');
    expect(screen.getByTestId('inbox-lookup').getAttribute('data-state')).toBe('offline');
    expect(screen.getByTestId('inbox-meta-source').textContent).toContain('Detected in the file');
    expect((screen.getByTestId('inbox-title') as HTMLInputElement).value).toBe('Detected title');
    fireEvent.click(screen.getByTestId('inbox-lookup-retry'));
    await waitFor(() => expect(work.state.lookups).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('inbox-lookup').getAttribute('data-state')).toBe('found'));
    expect(screen.queryByTestId('inbox-lookup-retry')).toBeNull();

    work.state.inbox.push(work.makeItem('second.pdf'));
    act(() => work.emitInbox());
    await waitFor(() => expect(screen.getAllByTestId('inbox-item')).toHaveLength(2));
  });

  it('confirms a dropped file with the edited metadata, name and folder, and offers undo', async () => {
    const work = setup({ tweak: (w) => void (w.state.inbox = [w.makeItem('paper.pdf', { proposal: { name: 'paper.pdf', folder: '', tagIds: ['tag-a'], newTags: [], tagsFrom: 'similar' } })]) });
    await screen.findByTestId('inbox-item');
    fireEvent.click(screen.getByTestId('inbox-edit'));
    expect(screen.getByTestId('inbox-meta-source').textContent).toContain('online record (OpenAlex)');
    expect((screen.getByTestId('inbox-title') as HTMLInputElement).value).toBe('Online title');
    expect(screen.getByTestId('inbox-tags-from').textContent).toContain('similar documents');
    expect(within(screen.getByTestId('inbox-tags')).getByTestId('tag-chip').textContent).toContain('Alpha tag');

    fireEvent.change(screen.getByTestId('inbox-title'), { target: { value: 'My title' } });
    fireEvent.change(screen.getByTestId('inbox-authors'), { target: { value: 'C. Person\nD. Person' } });
    fireEvent.change(screen.getByTestId('inbox-year'), { target: { value: '2019' } });
    fireEvent.change(screen.getByTestId('inbox-name'), { target: { value: 'renamed.pdf' } });
    await waitFor(() => expect(within(screen.getByTestId('inbox-folder')).getAllByRole('option').length).toBeGreaterThan(1));
    fireEvent.change(screen.getByTestId('inbox-folder'), { target: { value: 'beta' } });
    fireEvent.click(within(screen.getByTestId('inbox-tags')).getByRole('button'));
    fireEvent.click(screen.getByTestId('inbox-confirm'));
    await waitFor(() => expect(work.state.confirms).toHaveLength(1));
    expect(work.state.confirms[0]).toEqual({
      id: work.state.confirms[0].id,
      name: 'renamed.pdf',
      folder: 'beta',
      tagIds: [],
      newTags: [],
      metadata: { title: 'My title', authors: ['C. Person', 'D. Person'], year: 2019, venue: 'Journal', doi: '10.1000/test', arxivId: null },
      allowDuplicate: false,
    });
    await waitFor(() => expect(screen.queryByTestId('inbox-item')).toBeNull());
    expect(screen.getByTestId('inbox-empty')).toBeTruthy();
    fireEvent.click(await screen.findByTestId('toast-action'));
    await waitFor(() => expect(callsTo('history:undo')).toEqual([{ changeId: 'change-inbox' }]));
  });

  it('a file of the library has no name or folder, and its confirm sends none', async () => {
    const work = setup({ tweak: (w) => void (w.state.inbox = [w.makeItem('found.pdf', { kind: 'library', path: 'alpha/found.pdf' })]) });
    await screen.findByTestId('inbox-item');
    expect(screen.queryByTestId('inbox-name')).toBeNull();
    expect(screen.queryByTestId('inbox-folder')).toBeNull();
    expect(screen.getByTestId('inbox-item').getAttribute('data-kind')).toBe('library');
    fireEvent.click(screen.getByTestId('inbox-confirm'));
    await waitFor(() => expect(work.state.confirms).toHaveLength(1));
    expect(work.state.confirms[0]).not.toHaveProperty('name');
    expect(work.state.confirms[0]).not.toHaveProperty('folder');
  });

  it('refuses the same file (link to the existing one) and asks before adding a same-work duplicate', async () => {
    const work = setup({
      tweak: (w) => {
        w.state.inbox = [
          w.makeItem('same.pdf', { duplicate: { kind: 'same-file', docId: 'aaaaaaaaaaaaaaaa', title: 'Existing Paper', path: 'alpha/old.pdf' } }),
          w.makeItem('work.pdf', { duplicate: { kind: 'same-work', docId: 'bbbbbbbbbbbbbbbb', title: null, path: 'alpha/other.pdf' } }),
        ];
      },
    });
    const [same, other] = await screen.findAllByTestId('inbox-item');
    expect((within(same!).getByTestId('inbox-confirm') as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(within(same!).getByTestId('lab-chip').textContent).toBe('Existing Paper'));

    const confirm = within(other!).getByTestId('inbox-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    expect(confirm.textContent).toBe('Add anyway');
    fireEvent.click(confirm);
    await waitFor(() => expect(work.state.confirms).toHaveLength(1));
    expect(work.state.confirms[0]).toMatchObject({ allowDuplicate: true });
  });

  it('says when a file with that name exists in the folder', async () => {
    setup({
      tweak: (w) => {
        w.state.inbox = [w.makeItem('paper.pdf')];
        w.state.confirmError = new AppError('CONFLICT', 'exists', { reason: 'exists' });
      },
    });
    fireEvent.click(await screen.findByTestId('inbox-confirm'));
    expect((await screen.findByTestId('inbox-error')).textContent).toContain('already exists');
    expect(screen.getByTestId('inbox-item')).toBeTruthy();
  });

  it('shows a sync conflict copy with a link to its document, and leaves it out of the bulk confirm', async () => {
    setup({ tweak: (w) => void (w.state.inbox = [w.makeItem('copy.pdf', { conflictOf: { docId: 'cccccccccccccccc', title: 'Annotated one' } }), w.makeItem('a.pdf'), w.makeItem('b.pdf')]) });
    const rows = await screen.findAllByTestId('inbox-item');
    const conflict = within(rows[0]!).getByTestId('inbox-conflict');
    expect(conflict.textContent).toContain('Annotated one');
    expect(within(rows[0]!).queryByTestId('inbox-select')).toBeNull();
    fireEvent.click(screen.getByTestId('inbox-select-all'));
    expect(screen.getByTestId('inbox-confirm-selected').textContent).toBe('Confirm the 2 selected');
  });

  it('dismisses an item', async () => {
    const work = setup({ tweak: (w) => void (w.state.inbox = [w.makeItem('paper.pdf')]) });
    fireEvent.click(await screen.findByTestId('inbox-dismiss'));
    await waitFor(() => expect(work.state.dismissed).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId('inbox-item')).toBeNull());
  });
});

describe('inbox: tags with Claude', () => {
  it('previews what goes, then asks for tags with confirmed: true and shows the new nodes with keep boxes', async () => {
    const work = setup({ tweak: (w) => void (w.state.inbox = [w.makeItem('paper.pdf', { proposal: { name: 'paper.pdf', folder: 'alpha', tagIds: [], newTags: [], tagsFrom: 'none' } })]) });
    await screen.findByTestId('inbox-item');
    fireEvent.click(screen.getByTestId('inbox-edit'));
    await waitFor(() => expect(within(screen.getByTestId('inbox-folder')).getAllByRole('option').length).toBeGreaterThan(1));
    fireEvent.click(screen.getByTestId('inbox-propose-tags'));
    const dialog = await screen.findByTestId('send-preview');
    expect(work.state.previews[0]).toMatchObject({ model: 'claude-haiku-5-5', folder: 'alpha' });
    expect(within(dialog).getByTestId('preview-allowed').textContent).toContain('paper.pdf');
    expect(work.state.proposals).toHaveLength(0);
    fireEvent.click(within(dialog).getByTestId('preview-confirm'));
    await waitFor(() => expect(work.state.proposals).toHaveLength(1));
    expect(work.state.proposals[0]).toMatchObject({ model: 'claude-haiku-5-5', reasoning: 'low', folder: 'alpha', confirmed: true });
    await waitFor(() => expect(screen.getByTestId('inbox-tags-from').textContent).toContain('Claude'));
    expect(within(screen.getByTestId('inbox-tags')).getByTestId('tag-chip').textContent).toContain('Alpha tag');
    expect(screen.getByTestId('inbox-new-tags').textContent).toContain('Brand new');
    fireEvent.click(screen.getByTestId('inbox-new-tag-keep'));
    fireEvent.click(screen.getByTestId('inbox-confirm'));
    await waitFor(() => expect(work.state.confirms).toHaveLength(1));
    expect(work.state.confirms[0].tagIds).toEqual(['tag-a']);
    expect(work.state.confirms[0].newTags).toEqual([]);
  });

  it('keeps the new nodes that stay checked', async () => {
    const work = setup({ tweak: (w) => void (w.state.inbox = [w.makeItem('paper.pdf', { proposal: { name: 'paper.pdf', folder: 'alpha', tagIds: [], newTags: [], tagsFrom: 'none' } })]) });
    await screen.findByTestId('inbox-item');
    fireEvent.click(screen.getByTestId('inbox-edit'));
    fireEvent.click(screen.getByTestId('inbox-propose-tags'));
    fireEvent.click(await screen.findByTestId('preview-confirm'));
    await screen.findByTestId('inbox-new-tags');
    fireEvent.click(screen.getByTestId('inbox-confirm'));
    await waitFor(() => expect(work.state.confirms).toHaveLength(1));
    expect(work.state.confirms[0].newTags).toEqual([{ label: 'Brand new', parentId: null, aliases: [], reason: 'nothing fits' }]);
  });

  it('says clearly when the target folder is not enabled for the AI, without sending anything', async () => {
    const work = setup({ tweak: (w) => void (w.state.inbox = [w.makeItem('paper.pdf', { proposal: { name: 'paper.pdf', folder: 'beta', tagIds: [], newTags: [], tagsFrom: 'none' } })]) });
    await screen.findByTestId('inbox-item');
    fireEvent.click(screen.getByTestId('inbox-edit'));
    fireEvent.click(screen.getByTestId('inbox-propose-tags'));
    expect((await screen.findByTestId('inbox-ai-error')).textContent).toContain('not enabled for sending to Claude');
    expect(screen.queryByTestId('send-preview')).toBeNull();
    expect(work.state.proposals).toHaveLength(0);
  });

  it('shows offline and no-access refusals of the request', async () => {
    setup({
      tweak: (w) => {
        w.state.inbox = [w.makeItem('paper.pdf', { proposal: { name: 'paper.pdf', folder: 'alpha', tagIds: [], newTags: [], tagsFrom: 'none' } })];
        w.state.proposeError = new AppError('AI_PROVIDER_ERROR', 'x', { reason: 'offline' });
      },
    });
    await screen.findByTestId('inbox-item');
    fireEvent.click(screen.getByTestId('inbox-edit'));
    fireEvent.click(screen.getByTestId('inbox-propose-tags'));
    fireEvent.click(await screen.findByTestId('preview-confirm'));
    expect((await screen.findByTestId('inbox-ai-error')).textContent).toContain('cannot be reached');
    expect(screen.queryByTestId('send-preview')).toBeNull();
  });
});

describe('inbox: tabs', () => {
  it('switches to the AI proposals, which load on demand', async () => {
    setup();
    await screen.findByTestId('inbox-view');
    expect(callsTo('review:list')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('inbox-tab-proposals'));
    expect(await screen.findByTestId('review-view')).toBeTruthy();
    expect(callsTo('review:list')).toHaveLength(1);
  });
});

describe('inbox: startup cost and refusals in the provider', () => {
  it('at library open only the cheap count is asked (never the full list); a finished scan asks for a recount', async () => {
    const work = setup({ items: [] });
    await screen.findByTestId('inbox-view');
    await waitFor(() => expect(callsTo('inbox:count').length).toBeGreaterThanOrEqual(1));
    expect(callsTo('inbox:count')[0]).toEqual({ recount: false });
    // the view itself lists when it opens: that is where lookups may start
    expect(callsTo('inbox:list').length).toBeGreaterThanOrEqual(1);
    const before = callsTo('inbox:count').length;
    work.state.inbox = [work.makeItem('x.pdf')];
    act(() => emitEvent('scan:progress', { libraryId: 'lib-a', state: 'done', seen: 1, processed: 1, indexed: 1 }));
    await waitFor(() => expect(callsTo('inbox:count').length).toBe(before + 1));
    expect(callsTo('inbox:count').at(-1)).toEqual({ recount: true });
    await waitFor(() => expect(screen.getByTestId('inbox-badge').textContent).toBe('1'));
  });

  it('a drop that carries no usable path (from a browser) shows a refusal instead of nothing', async () => {
    const work = setup();
    await screen.findByTestId('inbox-view');
    drag('drop', [pdf('nopath.pdf')]);
    expect((await screen.findAllByTestId('toast')).some((t) => /not a file on this computer/i.test(t.textContent ?? ''))).toBe(true);
    expect(work.state.added).toEqual([]);
  });
});
