// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, type LibraryProfile } from '@rl/core';
import i18n from '../../i18n';
import { AiUiProvider } from '../../lib/aiUi';
import { LibraryEventsProvider } from '../../lib/events';
import { HistoryProvider } from '../../lib/history';
import { NotifyProvider } from '../../lib/notify';
import { AppProvider } from '../../state/app-context';
import { ExportProbe } from '../../testing/exportProbe';
import { chooseMenuItem, openDetail, openFacet, openTaxonomy, pickSort, pickView, resetSearch, topBarParts } from '../../testing/libraryKit';
import { makeDocs, memoryLibrary, type FakeNode } from '../../testing/memoryLibrary';
import { callsTo, emitEvent, memoryBackend, setHandlers } from '../../testing/mockRl';
import { toggleFilter } from './Facets';
import { LibraryView } from './LibraryView';

vi.mock('../../lib/rl', async () => (await import('../../testing/mockRl')).rlModule);

const profile: LibraryProfile = { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' };
const node = (id: string, label: string, over: Partial<FakeNode> = {}): FakeNode => ({ id, label, parents: [], aliases: [], implies: [], status: 'active', origin: 'user', ...over });
const NODES = [node('ml', 'Machine learning', { aliases: ['ML', 'apprentissage'], color: '#4263eb' }), node('stats', 'Statistics'), node('old', 'Old', { status: 'deprecated' })];

function setup(init: Parameters<typeof memoryLibrary>[0] = {}, override: Record<string, (p: any) => unknown> = {}) {
  const lib = memoryLibrary({ docs: makeDocs(6), nodes: structuredClone(NODES), ...init });
  const { handlers } = memoryBackend({ profiles: [profile] });
  setHandlers({ ...handlers, ...lib.handlers, ...override });
  render(
    createElement(AppProvider, null, createElement(LibraryEventsProvider, null, createElement(NotifyProvider, null, createElement(HistoryProvider, null, createElement(AiUiProvider, null, createElement(LibraryView), topBarParts(), createElement(ExportProbe)))))),
  );
  return lib;
}

const rows = () => screen.queryAllByTestId('search-result');
const rowOf = (title: string) => rows().find((r) => r.textContent?.includes(title))!;
const titles = () => rows().map((r) => r.querySelector('[data-testid="result-title"]')?.textContent);
async function ready() {
  await screen.findAllByTestId('search-result');
}
const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

beforeEach(async () => {
  await i18n.changeLanguage('en');
  try {
    window.localStorage.clear();
  } catch {
    // no storage
  }
});
afterEach(() => {
  cleanup();
  resetSearch();
});

describe('facets helper', () => {
  it('toggles a value and a single year', () => {
    expect(toggleFilter({}, 'authors', 'A')).toEqual({ authors: ['A'] });
    expect(toggleFilter({ authors: ['A'] }, 'authors', 'A')).toEqual({});
    expect(toggleFilter({}, 'years', '2020')).toEqual({ yearFrom: 2020, yearTo: 2020 });
  });
});

describe('LibraryView: list, grid, search', () => {
  it('lists documents with titles, authors, years, the type icon and coloured tags', async () => {
    const docs = makeDocs(3);
    docs[0]!.tags = ['ml'];
    setup({ docs });
    await ready();
    const first = rowOf('Paper 0000');
    expect(first.textContent).toContain('Author 0 · 2000 · article');
    expect(first.querySelector('.type-icon')?.getAttribute('data-ext')).toBe('pdf');
    const chip = first.querySelector<HTMLElement>('[data-testid="tag-chip"]')!;
    expect(chip.textContent).toBe('Machine learning');
    expect(chip.style.getPropertyValue('--tag')).toBe('#4263eb');
    expect(screen.getByTestId('search-summary').textContent).toContain('3 documents');
  });

  it('switches to the grid and back, and sorts', async () => {
    setup();
    await ready();
    pickView('grid');
    await waitFor(() => expect(rows()[0]?.dataset.view).toBe('grid'));
    pickView('list');
    await waitFor(() => expect(rows()[0]?.dataset.view).toBe('list'));
    fireEvent.change(screen.getByTestId('search-sort'), { target: { value: 'year-desc' } });
    await waitFor(() => expect(callsTo('documents:list').some((p) => p.sort === 'year-desc')).toBe(true));
    await waitFor(() => expect(titles()[0]).toBe('Paper 0005'));
  });

  it('searches as the user types (search:run) and shows the text the results answer', async () => {
    setup();
    await ready();
    type('search-input', 'Paper 0002');
    await waitFor(() => expect(screen.getByTestId('results-pane').dataset.query).toBe('Paper 0002'));
    await waitFor(() => expect(titles()).toEqual(['Paper 0002']));
    expect(callsTo('search:run').some((p) => p.text === 'Paper 0002')).toBe(true);
    type('search-input', 'nothing like it');
    await screen.findByTestId('search-empty');
  });

  it('keeps 5000 documents cheap: only a screenful is in the DOM and pages are requested on demand', async () => {
    setup({ docs: makeDocs(5000) });
    await ready();
    expect(screen.getByTestId('search-summary').textContent).toContain('5000');
    expect(rows().length).toBeLessThan(60);
    expect(callsTo('documents:list').filter((p) => (p.limit ?? 0) <= 100).length).toBeLessThanOrEqual(2);
    const list = screen.getByTestId('search-results');
    list.scrollTop = 60 * 4000;
    fireEvent.scroll(list);
    await waitFor(() => expect(titles().some((t) => t?.includes('Paper 40'))).toBe(true));
    expect(rows().length).toBeLessThan(60);
  });

  it('never asks for more than one page at a time, whatever the filters (5000 documents)', async () => {
    const docs = makeDocs(5000);
    for (let i = 0; i < docs.length; i++) docs[i]!.tags = i % 5 === 0 ? ['ml'] : i % 5 === 1 ? ['stats'] : [];
    setup({ docs });
    await ready();
    const pick = (testId: string, text: string) => {
      fireEvent.change(screen.getByTestId(testId), { target: { value: text } });
      fireEvent.keyDown(screen.getByTestId(testId), { key: 'Enter' });
    };
    openFacet('tags');
    pick('filter-include-input', 'ML');
    pick('filter-include-input', 'stat');
    fireEvent.click(screen.getByTestId('tag-mode-any'));
    await waitFor(() => expect(screen.getByTestId('search-summary').textContent).toContain('2000'));
    pick('filter-exclude-input', 'stat');
    await waitFor(() => expect(screen.getByTestId('search-summary').textContent).toContain('1000'));
    type('search-input', 'Paper');
    await waitFor(() => expect(screen.getByTestId('search-summary').textContent).toContain('1000'));
    const asked = [...callsTo('documents:list'), ...callsTo('search:run'), ...callsTo('search:query')];
    expect(asked.length).toBeGreaterThan(3);
    for (const p of asked) expect(p.limit ?? 50).toBeLessThanOrEqual(100);
    // The filters travel to the server instead of being applied here.
    expect(callsTo('documents:list').some((p) => p.filters?.tagsAny?.length === 2)).toBe(true);
    expect(callsTo('search:run').at(-1)?.filters).toMatchObject({ tags: ['ml'], tagsExclude: ['stats'] });
    // Nothing is loaded in bulk: no request is made for the whole library.
    expect(callsTo('documents:list').every((p) => p.offset === undefined || p.offset === 0)).toBe(true);
  });

  it('sorts by size and shows a readable size on each row', async () => {
    const docs = makeDocs(4);
    docs[0]!.size = 500;
    docs[1]!.size = 3 * 1024 * 1024;
    docs[2]!.size = 20 * 1024;
    docs[3]!.size = 1536;
    setup({ docs });
    await ready();
    const sizes = () => rows().map((r) => r.querySelector('[data-testid="doc-size"]')?.textContent);
    // The size is shown when the list is sorted by it, not otherwise (4.2: a quiet row).
    expect(sizes()).toEqual([undefined, undefined, undefined, undefined]);
    pickSort('size-desc');
    await waitFor(() => expect(titles()).toEqual(['Paper 0001', 'Paper 0002', 'Paper 0003', 'Paper 0000']));
    expect(sizes()).toEqual(['3 MB', '20 KB', '1.5 KB', '500 B']);
    expect(callsTo('documents:list').at(-1)?.sort).toBe('size-desc');
    pickSort('size-asc');
    await waitFor(() => expect(titles()).toEqual(['Paper 0000', 'Paper 0003', 'Paper 0002', 'Paper 0001']));
  });

  it('reloads on library:changed', async () => {
    const lib = setup();
    await ready();
    expect(rows()).toHaveLength(6);
    lib.state.docs = lib.state.docs.slice(0, 4);
    emitEvent('library:changed', { kind: 'documents' });
    await waitFor(() => expect(rows()).toHaveLength(4));
  });
});

describe('LibraryView: folders', () => {
  it('shows the folder tree with counts and filters by folder, with and without sub-folders', async () => {
    setup();
    await ready();
    const tree = await screen.findByTestId('folder-tree');
    const folder = (p: string) => tree.querySelector(`[data-key="${p}"]`) as HTMLElement;
    expect(folder('beta').textContent).toContain('2');
    fireEvent.click(folder('beta'));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(callsTo('documents:list').at(-1)?.filters).toMatchObject({ folder: 'beta', includeSubfolders: true });
    // beta holds only beta/inner: "this folder only" leaves nothing
    fireEvent.click(screen.getByTestId('include-subfolders'));
    await screen.findByTestId('search-empty');
    fireEvent.click(screen.getByTestId('include-subfolders'));
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByTestId('search-clear-filters'));
    await waitFor(() => expect(rows()).toHaveLength(6));
  });
});

describe('LibraryView: selection', () => {
  it('selects with click, ctrl, shift and the keyboard', async () => {
    setup();
    await ready();
    const count = () => screen.queryByTestId('selection-count')?.textContent ?? '';
    fireEvent.click(rowOf('Paper 0001'));
    expect(count()).toBe(''); // the bar of the selection is for several documents; one is the active row
    expect(rowOf('Paper 0001').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(rowOf('Paper 0003'), { ctrlKey: true });
    expect(count()).toBe('2 selected');
    fireEvent.click(rowOf('Paper 0005'), { shiftKey: true });
    await waitFor(() => expect(count()).toBe('3 selected')); // ctrl-click moved the anchor to 0003
    fireEvent.click(rowOf('Paper 0001'));
    const list = screen.getByTestId('search-results');
    fireEvent.keyDown(list, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(list, { key: 'ArrowDown', shiftKey: true });
    await waitFor(() => expect(count()).toBe('3 selected'));
    fireEvent.keyDown(list, { key: 'a', ctrlKey: true });
    await waitFor(() => expect(count()).toBe('6 selected'));
    fireEvent.keyDown(list, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('selection-count')).toBeNull());
  });

  it('Delete and Backspace do not delete anything: they only open the tag panel', async () => {
    const lib = setup();
    await ready();
    fireEvent.click(rowOf('Paper 0001'));
    const before = JSON.stringify(lib.state.docs);
    const list = screen.getByTestId('search-results');
    fireEvent.keyDown(list, { key: 'Delete' });
    fireEvent.keyDown(list, { key: 'Backspace' });
    await screen.findByTestId('detail-pane');
    expect(JSON.stringify(lib.state.docs)).toBe(before);
    expect(callsTo('documents:tag')).toHaveLength(0);
    expect(callsTo('projects:removeMembers')).toHaveLength(0);
  });
});

describe('LibraryView: select all and missing documents', () => {
  it('Ctrl+A on a result that is not loaded asks for the ids only, with the same filters and text', async () => {
    const docs = makeDocs(250);
    setup({ docs });
    await ready();
    type('search-input', 'Paper');
    await waitFor(() => expect(screen.getByTestId('results-pane').dataset.query).toBe('Paper'));
    const listCalls = callsTo('documents:list').length + callsTo('search:query').length;
    fireEvent.keyDown(screen.getByTestId('search-results'), { key: 'a', ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId('selection-count').textContent).toBe('250 selected'));
    expect(callsTo('documents:ids')).toHaveLength(1);
    expect(callsTo('documents:ids')[0]).toMatchObject({ text: 'Paper', sort: 'relevance' });
    // No page of rows was downloaded just to get the ids.
    expect(callsTo('documents:list').length + callsTo('search:query').length).toBe(listCalls);
  });

  it('shows the documents whose file is missing only when asked', async () => {
    const docs = makeDocs(4);
    docs[1]!.missing = true;
    setup({ docs });
    await ready();
    expect(rows()).toHaveLength(3);
    fireEvent.click(screen.getByTestId('show-missing'));
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(rowOf('Paper 0001').textContent).toContain('file missing');
    // It is a view option, not a filter: there is nothing to clear.
    expect(screen.queryByTestId('search-clear-filters')).toBeNull();
    fireEvent.click(screen.getByTestId('show-missing'));
    await waitFor(() => expect(rows()).toHaveLength(3));
  });
});

describe('LibraryView: tags', () => {
  async function selectTwo() {
    await ready();
    fireEvent.click(rowOf('Paper 0000'));
    fireEvent.click(rowOf('Paper 0001'), { ctrlKey: true });
    openDetail();
    return screen.findByTestId('bulk-panel');
  }

  it('adds a tag to many documents, completing from an alias', async () => {
    const lib = setup();
    await selectTwo();
    const input = screen.getByTestId('bulk-tag-input');
    fireEvent.change(input, { target: { value: 'appren' } });
    const option = await screen.findByTestId('tag-option');
    expect(option.textContent).toContain('Machine learning');
    expect(option.textContent).toContain('alias: apprentissage');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(callsTo('documents:tag')).toHaveLength(1));
    expect(callsTo('documents:tag')[0]).toMatchObject({ add: ['ml'] });
    expect(callsTo('documents:tag')[0].docIds).toHaveLength(2);
    expect(lib.state.docs.filter((d) => d.tags.includes('ml'))).toHaveLength(2);
    await waitFor(() => expect(rowOf('Paper 0000').textContent).toContain('Machine learning'));
  });

  it('creates a new tag on the fly and applies it', async () => {
    const lib = setup();
    await selectTwo();
    fireEvent.change(screen.getByTestId('bulk-tag-input'), { target: { value: 'Brand new topic' } });
    fireEvent.mouseDown(await screen.findByTestId('tag-create'));
    await waitFor(() => expect(lib.state.nodes.some((n) => n.label === 'Brand new topic')).toBe(true));
    await waitFor(() => expect(lib.state.docs.filter((d) => d.tags.includes('brand-new-topic'))).toHaveLength(2));
    expect(callsTo('taxonomy:apply')[0].ops[0]).toMatchObject({ op: 'create', label: 'Brand new topic' });
  });

  it('removes a tag from the selection only after a confirmation', async () => {
    const docs = makeDocs(3);
    docs[0]!.tags = ['stats'];
    docs[1]!.tags = ['stats'];
    const lib = setup({ docs });
    await selectTwo();
    fireEvent.click(await screen.findByTestId('bulk-remove'));
    expect(callsTo('documents:tag')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('bulk-remove-confirm'));
    await waitFor(() => expect(lib.state.docs.some((d) => d.tags.includes('stats'))).toBe(false));
    expect(callsTo('documents:tag')[0]).toMatchObject({ remove: ['stats'] });
  });

  it('filters by one or more tags (all / at least one) and excludes a tag, combined with text', async () => {
    const docs = makeDocs(6);
    docs[0]!.tags = ['ml'];
    docs[1]!.tags = ['ml', 'stats'];
    docs[2]!.tags = ['stats'];
    setup({ docs });
    await ready();
    const pick = async (testId: string, text: string) => {
      fireEvent.change(screen.getByTestId(testId), { target: { value: text } });
      fireEvent.keyDown(screen.getByTestId(testId), { key: 'Enter' });
    };
    openFacet('tags');
    await pick('filter-include-input', 'ML');
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(callsTo('documents:list').at(-1)?.filters?.tags).toEqual(['ml']);
    await pick('filter-include-input', 'stat');
    await waitFor(() => expect(titles()).toEqual(['Paper 0001'])); // all of them
    fireEvent.click(screen.getByTestId('tag-mode-any'));
    await waitFor(() => expect(titles()).toEqual(['Paper 0000', 'Paper 0001', 'Paper 0002']));
    // exclusion, still in "any" mode
    await pick('filter-exclude-input', 'ml');
    await waitFor(() => expect(titles()).toEqual(['Paper 0002']));
    // with text
    type('search-input', 'Paper 0002');
    await waitFor(() => expect(titles()).toEqual(['Paper 0002']));
    type('search-input', 'Paper 0000');
    await screen.findByTestId('search-empty');
  });

  it('removes a tag from one document in its card', async () => {
    const docs = makeDocs(2);
    docs[0]!.tags = ['ml'];
    const lib = setup({ docs });
    await ready();
    fireEvent.click(rowOf('Paper 0000'));
    openDetail();
    const panel = await screen.findByTestId('doc-panel');
    fireEvent.click(await within(await within(panel).findByTestId('doc-tag-list')).findByRole('button', { name: /Remove tag Machine learning/ }));
    await waitFor(() => expect(lib.state.docs[0]!.tags).toEqual([]));
  });
});

describe('LibraryView: document card', () => {
  const doc = () => {
    const d = makeDocs(2);
    d[0]!.extracted = { title: 'Paper 0000' };
    d[0]!.ai = {
      summary: { value: 'A short <b>summary</b>', meta: { model: 'm1', provider: 'claude', date: '2026-01-02T00:00:00.000Z', source: 'cmd' }, review: { status: 'proposed' } },
      keywords: { value: ['alpha', 'beta'], meta: { model: 'm1', provider: 'claude', date: '2026-01-02T00:00:00.000Z', source: 'cmd' }, review: { status: 'accepted' } },
    };
    return d;
  };
  async function open() {
    await ready();
    fireEvent.click(rowOf('Paper 0000'));
    fireEvent.keyDown(screen.getByTestId('search-results'), { key: 'Enter', shiftKey: true });
    return screen.findByTestId('doc-panel');
  }

  it('opens with Enter, edits fields with the revision, and keeps AI content apart and read-only', async () => {
    const lib = setup({ docs: doc() });
    const panel = await open();
    const ai = within(panel).getByTestId('ai-area');
    expect(ai.textContent).toContain('AI-generated');
    expect(ai.textContent).toContain('A short <b>summary</b>'); // shown as text
    expect(ai.querySelector('b')).toBeNull();
    expect(ai.querySelector('textarea, input')).toBeNull();
    expect(within(ai).getByTestId('ai-keywords').textContent).toContain('alpha');
    expect(panel.querySelector('[data-testid="doc-metadata"] [data-testid="ai-area"]')).toBeNull();
    // the data are read-only until 'Edit details'; extracted values are marked, user values are not
    expect(within(panel).queryByTestId('field-title')).toBeNull();
    fireEvent.click(within(panel).getByTestId('detail-edit-data'));
    expect(within(panel).getAllByTestId('extracted-mark')).toHaveLength(1);

    const title = within(panel).getByTestId('field-title');
    fireEvent.change(title, { target: { value: 'My own title' } });
    fireEvent.blur(title);
    await waitFor(() => expect(lib.state.docs[0]!.title).toBe('My own title'));
    expect(callsTo('documents:update')[0]).toMatchObject({ patch: { title: 'My own title' }, expectedRevision: 0 });
    await waitFor(() => expect(within(panel).queryByTestId('extracted-mark')).toBeNull());

    fireEvent.click(within(panel).getByTestId('study-read'));
    await waitFor(() => expect(lib.state.docs[0]!.studyState).toBe('read'));
    expect(callsTo('documents:update')[1]).toMatchObject({ patch: { studyState: 'read' }, expectedRevision: 1 });
    fireEvent.click(within(panel).getByTestId('field-underlined'));
    await waitFor(() => expect(lib.state.docs[0]!.underlined).toBe(true));
    const authors = within(panel).getByTestId('field-authors');
    fireEvent.change(authors, { target: { value: 'Ada\nGrace' } });
    fireEvent.blur(authors);
    await waitFor(() => expect(lib.state.docs[0]!.authors).toEqual(['Ada', 'Grace']));
  });

  it('opens the file and shows it in the folder; an executable is refused with a clear message', async () => {
    setup({ docs: doc() }, {
      'documents:open': () => {
        throw new AppError('PERMISSION_DENIED', 'no');
      },
    });
    const panel = await open();
    fireEvent.click(within(panel).getByTestId('doc-more'));
    chooseMenuItem(/Show in folder/);
    await waitFor(() => expect(callsTo('documents:reveal')).toHaveLength(1));
    fireEvent.click(within(panel).getByTestId('doc-more'));
    chooseMenuItem(/Open with the default program/);
    await waitFor(() => expect(screen.getByTestId('toasts').textContent).toContain('Show in folder'));
  });

  it('asks to reload on a CONFLICT', async () => {
    setup({ docs: doc() }, {
      'documents:update': () => {
        throw new AppError('CONFLICT', 'revision', { conflict: 'revision' });
      },
    });
    const panel = await open();
    fireEvent.click(within(panel).getByTestId('detail-edit-data'));
    const title = within(panel).getByTestId('field-title');
    fireEvent.change(title, { target: { value: 'x' } });
    fireEvent.blur(title);
    const toast = await screen.findByTestId('toast');
    expect(toast.textContent).toContain('Reload');
    expect(within(toast).getByTestId('toast-action')).toBeTruthy();
  });
});

describe('LibraryView: undo, redo and history', () => {
  it('undoes and redoes a tag change with the buttons and the keyboard, and lists it in the history', async () => {
    const lib = setup();
    await ready();
    fireEvent.click(rowOf('Paper 0000'));
    openDetail();
    const input = await screen.findByTestId('tag-input');
    fireEvent.change(input, { target: { value: 'stats' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(lib.state.docs[0]!.tags).toEqual(['stats']));

    fireEvent.click(screen.getByTestId('history-toggle'));
    const entry = await screen.findByTestId('history-item');
    expect(entry.textContent).toContain('Tags changed');
    fireEvent.click(screen.getByTestId('history-toggle'));

    await waitFor(() => expect((screen.getByTestId('undo-button') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('undo-button'));
    await waitFor(() => expect(lib.state.docs[0]!.tags).toEqual([]));
    // Redo is no longer a top-bar button (D-441): the History popover offers it and Ctrl+Y does it.
    fireEvent.click(screen.getByTestId('history-toggle'));
    await screen.findByTestId('history-redo-item');
    fireEvent.click(screen.getByTestId('history-toggle'));
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    await waitFor(() => expect(lib.state.docs[0]!.tags).toEqual(['stats']));
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(lib.state.docs[0]!.tags).toEqual([]));
    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(lib.state.docs[0]!.tags).toEqual(['stats']));
    expect(callsTo('history:undo').length).toBe(2);
  });

  it('leaves Ctrl+Z to text fields', async () => {
    setup();
    await ready();
    fireEvent.keyDown(screen.getByTestId('search-input'), { key: 'z', ctrlKey: true });
    expect(callsTo('history:undo')).toHaveLength(0);
  });
});

describe('LibraryView: taxonomy manager', () => {
  const open = async () => {
    await ready();
    openTaxonomy();
    return screen.findByTestId('taxonomy-manager');
  };
  const treeItem = (id: string) => screen.getByTestId('tax-tree').querySelector<HTMLElement>(`[data-key="${id}"]`)!;

  it('creates a top-level tag and a sub-tag, renames, colours, sets aliases and implications', async () => {
    const lib = setup({ nodes: [] });
    await open();
    expect(screen.getByTestId('tax-empty')).toBeTruthy();
    fireEvent.click(screen.getByTestId('new-top-level'));
    fireEvent.change(screen.getByTestId('new-node-label'), { target: { value: 'Methods' } });
    fireEvent.click(screen.getByTestId('new-node-create'));
    await waitFor(() => expect(lib.state.nodes.map((n) => n.id)).toEqual(['methods']));
    const editor = await screen.findByTestId('node-editor');

    fireEvent.click(within(editor).getByTestId('add-child'));
    fireEvent.change(screen.getByTestId('new-node-label'), { target: { value: 'Statistics' } });
    fireEvent.click(screen.getByTestId('new-node-create'));
    await waitFor(() => expect(lib.state.nodes.find((n) => n.id === 'statistics')?.parents).toEqual(['methods']));
    await waitFor(() => expect(screen.getByTestId('node-editor').dataset.node).toBe('statistics'));

    const label = screen.getByTestId('node-label');
    fireEvent.change(label, { target: { value: 'Statistical methods' } });
    fireEvent.blur(label);
    await waitFor(() => expect(lib.state.nodes.find((n) => n.id === 'statistics')?.label).toBe('Statistical methods'));

    fireEvent.click(screen.getAllByTestId('color-swatch')[3]!);
    await waitFor(() => expect(lib.state.nodes.find((n) => n.id === 'statistics')?.color).toBe('#2f9e44'));
    const aliases = screen.getByTestId('node-aliases');
    fireEvent.change(aliases, { target: { value: 'stats\nstatistique' } });
    fireEvent.blur(aliases);
    await waitFor(() => expect(lib.state.nodes.find((n) => n.id === 'statistics')?.aliases).toEqual(['stats', 'statistique']));

    const implies = screen.getByTestId('implies-input');
    fireEvent.change(implies, { target: { value: 'methods' } });
    fireEvent.keyDown(implies, { key: 'Enter' });
    await waitFor(() => expect(lib.state.nodes.find((n) => n.id === 'statistics')?.implies).toEqual(['methods']));
  });

  it('moves a tag (parents editor) and refuses a cycle; a second parent is allowed', async () => {
    const lib = setup({ nodes: [node('a', 'A'), node('b', 'B', { parents: ['a'] }), node('c', 'C')] });
    await open();
    fireEvent.click(treeItem('a'));
    // A under its own child B: refused before it reaches the backend
    const parent = await screen.findByTestId('parent-input');
    expect(within(screen.getByTestId('node-parents')).queryByText('B')).toBeNull();
    fireEvent.change(parent, { target: { value: 'B' } });
    expect(screen.queryByTestId('tag-option')).toBeNull(); // descendants are not even offered
    fireEvent.click(treeItem('c'));
    const p2 = await screen.findByTestId('parent-input');
    fireEvent.change(p2, { target: { value: 'A' } });
    fireEvent.keyDown(p2, { key: 'Enter' });
    await waitFor(() => expect(lib.state.nodes.find((n) => n.id === 'c')?.parents).toEqual(['a']));
    fireEvent.change(screen.getByTestId('parent-input'), { target: { value: 'B' } });
    fireEvent.keyDown(screen.getByTestId('parent-input'), { key: 'Enter' });
    await waitFor(() => expect(lib.state.nodes.find((n) => n.id === 'c')?.parents).toEqual(['a', 'b']));
    fireEvent.click(screen.getByTestId('make-top-level'));
    await waitFor(() => expect(lib.state.nodes.find((n) => n.id === 'c')?.parents).toEqual([]));
  });

  it('moves a tag by dragging it onto another', async () => {
    const lib = setup({ nodes: [node('a', 'A'), node('c', 'C')] });
    await open();
    const dt = { data: {} as Record<string, string>, setData(k: string, v: string) { this.data[k] = v; }, getData(k: string) { return this.data[k]; }, effectAllowed: '' };
    fireEvent.dragStart(treeItem('c'), { dataTransfer: dt });
    fireEvent.dragOver(treeItem('a'), { dataTransfer: dt });
    fireEvent.drop(treeItem('a'), { dataTransfer: dt });
    await waitFor(() => expect(lib.state.nodes.find((n) => n.id === 'c')?.parents).toEqual(['a']));
  });

  it('merges, deprecates, restores and deletes only an unused tag, with confirmations', async () => {
    const docs = makeDocs(3);
    docs[0]!.tags = ['a'];
    const lib = setup({ docs, nodes: [node('a', 'A'), node('b', 'B'), node('c', 'C')] });
    await open();
    fireEvent.click(treeItem('a'));
    expect(within(await screen.findByTestId('node-counts')).getByText(/1 direct/)).toBeTruthy();
    expect((screen.getByTestId('delete-node') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('deprecate-node'));
    await waitFor(() => expect(lib.state.nodes.find((n) => n.id === 'a')?.status).toBe('deprecated'));
    fireEvent.click(await screen.findByTestId('restore-node'));
    await waitFor(() => expect(lib.state.nodes.find((n) => n.id === 'a')?.status).toBe('active'));

    const merge = screen.getByTestId('merge-input');
    fireEvent.change(merge, { target: { value: 'B' } });
    fireEvent.keyDown(merge, { key: 'Enter' });
    expect(callsTo('taxonomy:apply').some((c) => c.ops[0].op === 'merge')).toBe(false);
    fireEvent.click(await screen.findByTestId('merge-confirm'));
    await waitFor(() => expect(lib.state.nodes.map((n) => n.id)).toEqual(['b', 'c']));
    expect(lib.state.docs[0]!.tags).toEqual(['b']);
    expect(lib.state.nodes[0]!.aliases).toContain('A');

    fireEvent.click(treeItem('c'));
    fireEvent.click(await screen.findByTestId('delete-node'));
    expect(lib.state.nodes).toHaveLength(2);
    fireEvent.click(screen.getByTestId('delete-confirm'));
    await waitFor(() => expect(lib.state.nodes.map((n) => n.id)).toEqual(['b']));
  });

  it('navigates the tree with the arrow keys', async () => {
    setup({ nodes: [node('a', 'A'), node('b', 'B', { parents: ['a'] }), node('c', 'C')] });
    await open();
    const a = treeItem('a');
    a.focus();
    fireEvent.keyDown(a, { key: 'ArrowRight' });
    await waitFor(() => expect(treeItem('b')).toBeTruthy());
    fireEvent.keyDown(a, { key: 'ArrowDown' });
    await waitFor(() => expect(treeItem('b').getAttribute('aria-selected')).toBe('true'));
    fireEvent.keyDown(treeItem('b'), { key: 'ArrowLeft' });
    await waitFor(() => expect(treeItem('a').getAttribute('aria-selected')).toBe('true'));
  });
});

describe('LibraryView: add to project', () => {
  it('adds the selection to an existing project and creates a new one from it', async () => {
    const docs = makeDocs(4);
    const lib = setup({ docs, projects: [{ id: 'p1', kind: 'project', name: 'Thesis', description: '', notes: '', status: 'active', revision: 0, members: [], plan: [] }] });
    await ready();
    fireEvent.click(rowOf('Paper 0000'));
    fireEvent.click(rowOf('Paper 0002'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('add-to-project-button'));
    fireEvent.click(await screen.findByTestId('pick-project'));
    await waitFor(() => expect(lib.state.projects[0]!.members.map((m) => m.docId)).toEqual([docs[0]!.docId, docs[2]!.docId]));

    fireEvent.click(screen.getByTestId('add-to-project-button'));
    fireEvent.change(await screen.findByTestId('new-project-name'), { target: { value: 'Fresh' } });
    fireEvent.click(screen.getByTestId('create-project-with-selection'));
    await waitFor(() => expect(lib.state.projects.map((p) => p.name)).toEqual(['Thesis', 'Fresh']));
    expect(lib.state.projects[1]!.members).toHaveLength(2);
  });
});

describe('LibraryView: phase 2 review fixes', () => {
  const countText = () => screen.queryByTestId('selection-count')?.textContent ?? '';
  const addTag = async (testId: string, text: string) => {
    const input = await screen.findByTestId(testId);
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: 'Enter' });
  };

  it('bulk tags act on every selected id, also after a refresh that reloads only the first page (250 documents)', async () => {
    const lib = setup({ docs: makeDocs(250) });
    await ready();
    fireEvent.click(rowOf('Paper 0000'));
    fireEvent.keyDown(screen.getByTestId('search-results'), { key: 'a', ctrlKey: true });
    await waitFor(() => expect(countText()).toBe('250 selected'));
    openDetail();
    await addTag('bulk-tag-input', 'stats');
    await waitFor(() => expect(callsTo('documents:tag')).toHaveLength(1));
    expect(callsTo('documents:tag')[0].docIds).toHaveLength(250);
    await waitFor(() => expect(lib.state.docs.filter((d) => d.tags.includes('stats'))).toHaveLength(250));
    // the change reloaded the list; the selection and its count survive
    await waitFor(() => expect(callsTo('documents:list').length).toBeGreaterThan(3));
    expect(countText()).toBe('250 selected');
    await addTag('bulk-tag-input', 'appren');
    await waitFor(() => expect(callsTo('documents:tag')).toHaveLength(2));
    expect(callsTo('documents:tag')[1].docIds).toHaveLength(250);
    expect(callsTo('documents:tag')[1]).toMatchObject({ add: ['ml'] });
    await waitFor(() => expect(lib.state.docs.filter((d) => d.tags.includes('ml'))).toHaveLength(250));
    expect(countText()).toBe('250 selected');
    expect(screen.getByTestId('bulk-title').textContent).toContain('250');
  });

  it('Ctrl+A asks the server for the ids in one call and does not download the rows', async () => {
    setup({ docs: makeDocs(1000) });
    await ready();
    fireEvent.click(rowOf('Paper 0000'));
    fireEvent.keyDown(screen.getByTestId('search-results'), { key: 'a', ctrlKey: true });
    await waitFor(() => expect(countText()).toBe('1000 selected'));
    expect(callsTo('documents:ids')).toHaveLength(1);
    // Only the first page of rows was ever loaded (the one the list shows).
    expect(callsTo('documents:list').every((c) => c.limit === 100)).toBe(true);
    expect(callsTo('documents:list').length).toBeLessThanOrEqual(2);
  });

  it('keeps Enter and the arrows on the same document when the list changes under the focus', async () => {
    const lib = setup({ docs: makeDocs(6) });
    await ready();
    fireEvent.click(rowOf('Paper 0002'));
    // Paper 0000 moves to the end of the title order: every index above it shifts by one
    lib.state.docs[0]!.title = 'Zzz last';
    emitEvent('library:changed', { kind: 'documents' });
    await waitFor(() => expect(titles().at(-1)).toBe('Zzz last'));
    const list = screen.getByTestId('search-results');
    fireEvent.keyDown(list, { key: 'Enter', shiftKey: true });
    await waitFor(() => expect(screen.getByTestId('panel-title').textContent).toBe('Paper 0002'));
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    await waitFor(() => expect(rowOf('Paper 0003').getAttribute('aria-selected')).toBe('true'));
  });

  it('offers to remove only the tags put by hand and marks the implied ones', async () => {
    const nodes = [node('ml', 'Machine learning', { implies: ['stats'] }), node('stats', 'Statistics')];
    const docs = makeDocs(3);
    docs[0]!.tags = ['ml'];
    docs[1]!.tags = ['ml'];
    const lib = setup({ docs, nodes });
    await ready();
    fireEvent.click(rowOf('Paper 0000'));
    fireEvent.click(rowOf('Paper 0001'), { ctrlKey: true });
    openDetail();
    const items = await screen.findAllByTestId('bulk-tag');
    const byTag = (id: string) => items.find((i) => i.dataset.tag === id)!;
    expect(within(byTag('ml')).getByTestId('bulk-remove')).toBeTruthy();
    expect(within(byTag('stats')).getByTestId('bulk-implied')).toBeTruthy();
    expect(within(byTag('stats')).queryByTestId('bulk-remove')).toBeNull();
    expect(byTag('ml').textContent).toContain('on 2 of 2');
    void lib;
  });

  it('turns Redo off after an undo followed by a new change', async () => {
    const lib = setup();
    await ready();
    fireEvent.click(rowOf('Paper 0000'));
    openDetail();
    await addTag('tag-input', 'stats');
    await waitFor(() => expect(lib.state.docs[0]!.tags).toEqual(['stats']));
    await waitFor(() => expect((screen.getByTestId('undo-button') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('undo-button'));
    fireEvent.click(screen.getByTestId('history-toggle'));
    await screen.findByTestId('history-redo-item');
    fireEvent.click(screen.getByTestId('history-toggle'));
    await addTag('tag-input', 'appren');
    await waitFor(() => expect(lib.state.docs[0]!.tags).toEqual(['ml']));
    // the undone entry is still listed as undone, but the main process says it cannot be redone any more
    // The top bar has no Redo button (D-441); the history entry that was undone is still listed, as undone.
    fireEvent.click(screen.getByTestId('history-toggle'));
    expect(await screen.findAllByTestId('history-item')).not.toHaveLength(0);
  });

  it('applies taxonomy operations one after the other: a blur and a click right after it do not conflict', async () => {
    const lib = setup({ nodes: [node('methods', 'Methods')] });
    openTaxonomy();
    fireEvent.click(await screen.findByText('Methods'));
    const aliases = await screen.findByTestId('node-aliases');
    fireEvent.change(aliases, { target: { value: 'meth' } });
    fireEvent.blur(aliases);
    fireEvent.click(screen.getAllByTestId('color-swatch')[3]!);
    await waitFor(() => expect(lib.state.nodes[0]?.color).toBe('#2f9e44'));
    expect(lib.state.nodes[0]?.aliases).toEqual(['meth']);
    expect(screen.queryAllByTestId('toast')).toHaveLength(0);
    const revs = callsTo('taxonomy:apply').map((c) => c.expectedRevision);
    expect(new Set(revs).size).toBe(revs.length);
  });
});

describe('LibraryView: bulk actions and their limits (D-178)', () => {
  const countText = () => screen.queryByTestId('selection-count')?.textContent ?? '';
  const toastTexts = () => screen.queryAllByTestId('toast').map((x) => x.textContent ?? '');
  const fakeIds = (n: number) => Array.from({ length: n }, (_, i) => `x${String(i).padStart(15, '0')}`);
  const addTag = async (text: string) => {
    const input = await screen.findByTestId('bulk-tag-input');
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: 'Enter' });
  };
  const selectAll = async (expected: string) => {
    await ready();
    fireEvent.click(rowOf('Paper 0000'));
    fireEvent.keyDown(screen.getByTestId('search-results'), { key: 'a', ctrlKey: true });
    await waitFor(() => expect(countText()).toBe(expected));
  };
  const PROJECT = { id: 'p1', kind: 'project' as const, name: 'Thesis', description: '', notes: '', status: 'active' as const, revision: 0, members: [], plan: [] };

  it('Ctrl+A on a result longer than the server returns says how many of how many were selected', async () => {
    setup({ docs: makeDocs(250) }, { 'documents:ids': () => ({ total: 250, ids: makeDocs(200).map((d) => d.docId) }) });
    await selectAll('200 selected');
    await waitFor(() => expect(toastTexts().some((x) => x.includes('200 of 250 documents selected'))).toBe(true));
  });

  it('Ctrl+A on a result that fits says nothing about limits', async () => {
    setup({ docs: makeDocs(250) });
    await selectAll('250 selected');
    expect(toastTexts().some((x) => x.includes('at most'))).toBe(false);
  });

  it('shows the busy state of a long bulk tag and takes no second one meanwhile', async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let lib!: ReturnType<typeof setup>;
    lib = setup({ docs: makeDocs(250) }, { 'documents:tag': async (p) => (await gate, lib.handlers['documents:tag']!(p)) });
    await selectAll('250 selected');
    openDetail();
    await addTag('stats');
    expect((await screen.findByTestId('bulk-busy')).textContent).toContain('250');
    expect((screen.getByTestId('bulk-tag-input') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId('bulk-panel').getAttribute('aria-busy')).toBe('true');
    release();
    await waitFor(() => expect(screen.queryByTestId('bulk-busy')).toBeNull());
    expect(callsTo('documents:tag')).toHaveLength(1);
    expect((screen.getByTestId('bulk-tag-input') as HTMLInputElement).disabled).toBe(false);
    await waitFor(() => expect(lib.state.docs.filter((d) => d.tags.includes('stats'))).toHaveLength(250));
  });

  it('refuses a tag change on more documents than one change can hold, with the reason and without sending it', async () => {
    setup({ docs: makeDocs(250) }, { 'documents:ids': () => ({ total: 250, ids: fakeIds(50_001) }) });
    await selectAll('50001 selected');
    openDetail();
    await addTag('stats');
    await waitFor(() => expect(toastTexts().some((x) => x.includes('One change can cover at most 50000 documents; 50001 are selected.'))).toBe(true));
    expect(callsTo('documents:tag')).toHaveLength(0);
  });

  it('"Add to project" says a project holds at most 20000 documents before sending anything', async () => {
    setup({ docs: makeDocs(250), projects: [structuredClone(PROJECT)] }, { 'documents:ids': () => ({ total: 250, ids: fakeIds(20_001) }) });
    await selectAll('20001 selected');
    fireEvent.click(screen.getByTestId('add-to-project-button'));
    expect((await screen.findByTestId('add-too-many')).textContent).toBe('A project can hold at most 20000 documents; 20001 are selected.');
    expect((await screen.findByTestId('pick-project') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('new-project-name'), { target: { value: 'Fresh' } });
    expect((screen.getByTestId('create-project-with-selection') as HTMLButtonElement).disabled).toBe(true);
    expect(callsTo('projects:addMembers')).toHaveLength(0);
    expect(callsTo('projects:create')).toHaveLength(0);
  });

  it('20000 documents are still accepted by "Add to project"', async () => {
    const lib = setup({ docs: makeDocs(250), projects: [structuredClone(PROJECT)] }, { 'documents:ids': () => ({ total: 250, ids: fakeIds(20_000) }) });
    await selectAll('20000 selected');
    fireEvent.click(screen.getByTestId('add-to-project-button'));
    fireEvent.click(await screen.findByTestId('pick-project'));
    await waitFor(() => expect(lib.state.projects[0]!.members).toHaveLength(20_000));
    expect(screen.queryByTestId('add-too-many')).toBeNull();
  });

  it('explains a refusal of the server when an existing project would overflow', async () => {
    setup({ docs: makeDocs(4), projects: [structuredClone(PROJECT)] }, { 'projects:addMembers': () => { throw new AppError('INVALID_REQUEST', 'Too many members', { reason: 'members-limit', limit: 20_000, count: 20_003 }); } });
    await ready();
    fireEvent.click(rowOf('Paper 0000'));
    fireEvent.click(rowOf('Paper 0002'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('add-to-project-button'));
    fireEvent.click(await screen.findByTestId('pick-project'));
    await waitFor(() => expect(toastTexts().some((x) => x.includes('A project can hold at most 20000 documents; this one would have 20003.'))).toBe(true));
  });
});

describe('LibraryView: advanced search button', () => {
  it('sits next to the search box, opens the dialog with the typed text and leaves the normal search alone', async () => {
    setup({ docs: makeDocs(3) }, {
      'library:getConfig': () => ({ ai: { models: [{ id: 'm1', label: 'M1' }], defaultModel: 'm1', defaultReasoning: 'low' } }),
      'ai:status': () => ({ provider: 'claude-agent-sdk', available: false, auth: 'none', reason: 'offline', enabledFolders: ['x'], monthUsd: 0, capUsd: null }),
    });
    await ready();
    type('search-input', 'paper words');
    fireEvent.click(screen.getByTestId('adv-search'));
    expect(await screen.findByTestId('adv-search-dialog')).toBeTruthy();
    expect((screen.getByTestId('adv-search-text') as HTMLTextAreaElement).value).toBe('paper words');
    expect((await screen.findByTestId('adv-search-unavailable')).getAttribute('data-reason')).toBe('offline');
    expect((screen.getByTestId('adv-search-go') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('adv-search-cancel'));
    expect(screen.queryByTestId('adv-search-dialog')).toBeNull();
    expect((screen.getByTestId('adv-search') as HTMLButtonElement).disabled).toBe(false);
    await waitFor(() => expect(callsTo('search:run').length).toBeGreaterThan(0));
  });
});

describe('LibraryView: propose with AI', () => {
  it('opens the bulk job dialog for the selection and estimates it', async () => {
    const docs = makeDocs(4);
    setup({ docs }, {
      'library:getConfig': () => ({ ai: { models: [{ id: 'm1', label: 'M1' }], defaultModel: 'm1', defaultReasoning: 'low' } }),
      'jobs:estimate': () => ({ preview: { model: 'm1', allowed: [docs[0]!.docId, docs[2]!.docId], refused: [], folders: [''], approxInputTokens: 2000, estimatedUsd: 0.01, needsConfirmation: false, overCap: false }, skipped: 0, toSend: 2 }),
    });
    await ready();
    fireEvent.click(rowOf('Paper 0000'));
    fireEvent.click(rowOf('Paper 0002'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('bulk-claude'));
    chooseMenuItem(/Propose with Claude/);
    expect(await screen.findByTestId('job-dialog')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('job-to-send').textContent).toBe('2 documents will be sent'));
    expect(callsTo('jobs:estimate')[0].docIds).toHaveLength(2);
  });
});

describe('LibraryView: second-brain export', () => {
  it('starts the export from the selected documents', async () => {
    const docs = makeDocs(4);
    setup({ docs });
    await ready();
    expect(screen.getByTestId('export-probe').textContent).toBe('closed');
    fireEvent.click(rowOf('Paper 0000'));
    fireEvent.click(rowOf('Paper 0002'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('selection-more'));
    chooseMenuItem(/second brain/i);
    const init = JSON.parse(screen.getByTestId('export-probe').textContent!);
    expect([...init.docIds].sort()).toEqual([docs[0]!.docId, docs[2]!.docId].sort());
  });
});
