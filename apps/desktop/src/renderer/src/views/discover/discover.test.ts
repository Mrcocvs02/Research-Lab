// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, type LibraryProfile } from '@rl/core';
import i18n from '../../i18n';
import { AiUiProvider } from '../../lib/aiUi';
import { CitationJobsProvider } from '../../lib/citationJobs';
import { LibraryEventsProvider } from '../../lib/events';
import { HistoryProvider } from '../../lib/history';
import { NotifyProvider } from '../../lib/notify';
import { ReaderProvider, useReader } from '../../lib/reader';
import { WatchProvider } from '../../lib/watch';
import { Shell } from '../../shell/Shell';
import { AppProvider } from '../../state/app-context';
import { memoryCitations } from '../../testing/memoryCitations';
import { callsTo, emitEvent, memoryBackend, setHandlers } from '../../testing/mockRl';
import { DiscoverView } from './DiscoverView';
import { resetWatchOps } from './watchOps';

vi.mock('../../lib/rl', async () => (await import('../../testing/mockRl')).rlModule);

const profile: LibraryProfile = { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' };
const PROVIDERS: any[] = [AppProvider, LibraryEventsProvider, NotifyProvider, HistoryProvider, ReaderProvider, AiUiProvider, CitationJobsProvider, WatchProvider];
const NOW = '2026-11-17T10:00:00.000Z';

const source = (id: string, over: Record<string, unknown> = {}) => ({ id, kind: 'author', query: `query ${id}`, label: `Source ${id}`, enabled: true, ...over });
const seen = (sourceId: string, n: number, over: Record<string, unknown> = {}) => ({ sourceId, externalId: `W${sourceId}${n}`, title: `Found ${sourceId}-${n}`, authors: ['A. Writer'], year: 2026, doi: `10.1000/${sourceId}${n}`, ...over });
const wanted = (n: number, over: Record<string, unknown> = {}) => ({
  key: `doi:10.1000/w${n}`,
  work: { doi: `10.1000/w${n}`, title: `Wanted ${n}`, authors: ['B. Author'], year: 2020, source: 'openalex' },
  citing: [
    { docId: `c${n}a`, title: `Citing ${n}a` },
    { docId: `c${n}b`, title: null },
  ],
  citingCount: 2,
  score: 2,
  ...over,
});

function Probe() {
  const { target } = useReader();
  return createElement('span', { 'data-testid': 'reader-target' }, target?.docId ?? '');
}

async function mount(c = memoryCitations(), extra: Record<string, (p: any) => unknown> = {}, node: any = createElement(DiscoverView)) {
  const { handlers } = memoryBackend({ profiles: [profile] });
  setHandlers({ ...handlers, ...c.handlers, 'scan:status': () => ({ libraryId: 'lib-a', state: 'idle', seen: 0, processed: 0, indexed: 0 }), ...extra });
  render(PROVIDERS.reduceRight((child, P) => createElement(P, null, child), createElement('div', null, node, createElement(Probe))));
  await act(async () => void (await new Promise((r) => setTimeout(r, 40))));
  return c;
}
const tab = (id: string) => fireEvent.click(screen.getByTestId(`discover-tab-${id}`));
const NETWORK_CHANNELS = ['watch:check', 'watch:checkPublished', 'citations:refresh', 'citations:refreshMany'];

beforeEach(async () => {
  resetWatchOps();
  await i18n.changeLanguage('en');
});
afterEach(() => cleanup());

describe('Discover: tabs and the network', () => {
  it('opens on "Read next" with the four tabs and makes no network call by itself', async () => {
    const c = memoryCitations({ sources: [source('s1')] });
    await mount(c);
    for (const id of ['readnext', 'new', 'published', 'sources']) expect(screen.getByTestId(`discover-tab-${id}`)).toBeTruthy();
    expect(screen.getByTestId('discover-tab-readnext').getAttribute('aria-selected')).toBe('true');
    for (const id of ['new', 'published', 'sources', 'readnext']) tab(id);
    await waitFor(() => expect(callsTo('recommend:readNext').length).toBeGreaterThan(0));
    for (const ch of NETWORK_CHANNELS) expect(callsTo(ch)).toEqual([]);
  });
});

describe('Discover: read next', () => {
  it('shows each work with why, the citing documents as chips that open them, and opens the DOI externally', async () => {
    const c = memoryCitations();
    c.state.readNext = { items: [wanted(1, { citingCount: 5 })], documentsWithCitations: 12 };
    await mount(c);
    const item = await screen.findByTestId('readnext-item');
    expect(callsTo('recommend:readNext')[0]).toEqual({ minCiting: 2 });
    expect(item.textContent).toContain('Wanted 1');
    expect(within(item).getByTestId('readnext-why').textContent).toBe('Why: cited by 5 of your documents');
    expect(item.textContent).toContain('+3 more');
    const chips = within(item).getAllByTestId('readnext-citing');
    expect(chips.map((x) => x.textContent)).toEqual(['Citing 1a', 'Untitled work']);
    fireEvent.click(chips[0]!);
    expect(screen.getByTestId('reader-target').textContent).toBe('c1a');
    fireEvent.click(within(item).getByTestId('readnext-item-external'));
    await waitFor(() => expect(callsTo('citations:openExternal')).toEqual([{ kind: 'doi', id: '10.1000/w1' }]));
    expect(screen.queryByTestId('readnext-few')).toBeNull();
  });

  it('dismisses a recommendation', async () => {
    const c = memoryCitations();
    c.state.readNext = { items: [wanted(1), wanted(2)], documentsWithCitations: 12 };
    await mount(c);
    const items = await screen.findAllByTestId('readnext-item');
    fireEvent.click(within(items[0]!).getByTestId('readnext-dismiss'));
    await waitFor(() => expect(screen.getAllByTestId('readnext-item')).toHaveLength(1));
    expect(c.state.dismissedKeys).toEqual(['doi:10.1000/w1']);
    expect(screen.getByTestId('readnext-item').textContent).toContain('Wanted 2');
  });

  it('says when few documents have citations yet, and how to get more', async () => {
    const c = memoryCitations();
    c.state.readNext = { items: [], documentsWithCitations: 2 };
    await mount(c);
    expect((await screen.findByTestId('readnext-few')).textContent).toContain('Only 2 documents have stored citations');
    expect(screen.getByTestId('readnext-few').textContent).toContain('Refresh citations');
    expect(screen.getByTestId('readnext-empty')).toBeTruthy();
  });

  it('says so when no document has stored citations at all', async () => {
    await mount();
    expect((await screen.findByTestId('readnext-few')).textContent).toContain('No document has stored citations yet');
  });

  it('limits the scope to a project or a folder and passes the minimum', async () => {
    const c = memoryCitations();
    await mount(c, {
      'projects:list': () => ({ items: [{ id: 'p1', kind: 'project', name: 'Project one', description: '', status: 'active', revision: 1, createdAt: NOW, updatedAt: NOW, counts: {} }] }),
      'library:listFolders': (p: any) => ({ folders: p.parent ? [] : [{ path: 'alpha', name: 'alpha', hasChildren: false }] }),
    });
    await screen.findByTestId('readnext-few');
    fireEvent.change(screen.getByTestId('readnext-scope'), { target: { value: 'project' } });
    const before = callsTo('recommend:readNext').length;
    fireEvent.change(await screen.findByTestId('readnext-project'), { target: { value: 'p1' } });
    await waitFor(() => expect(callsTo('recommend:readNext').length).toBe(before + 1));
    expect(callsTo('recommend:readNext').at(-1)).toEqual({ minCiting: 2, projectId: 'p1' });
    fireEvent.change(screen.getByTestId('readnext-scope'), { target: { value: 'folder' } });
    await waitFor(() => expect(within(screen.getByTestId('readnext-folder')).getAllByRole('option')).toHaveLength(2));
    fireEvent.change(screen.getByTestId('readnext-folder'), { target: { value: 'alpha' } });
    fireEvent.change(screen.getByTestId('readnext-min'), { target: { value: '3' } });
    await waitFor(() => expect(callsTo('recommend:readNext').at(-1)).toEqual({ minCiting: 3, folder: 'alpha' }));
  });
});

describe('Discover: new works', () => {
  const setup = async () => {
    const c = memoryCitations({ sources: [source('s1'), source('s2', { kind: 'topic', label: '' })], items: [seen('s1', 1), seen('s1', 2, { inLibrary: 'd9', doi: undefined, arxivId: '2101.00001' }), seen('s2', 1, { doi: undefined, externalId: 'W77' })] });
    await mount(c);
    tab('new');
    await screen.findAllByTestId('watch-item');
    return c;
  };

  it('lists items with the in-library chip and links for the others, filters by source and dismisses', async () => {
    const c = await setup();
    const items = screen.getAllByTestId('watch-item');
    expect(items.map((i) => i.dataset.inLibrary)).toEqual(['false', 'true', 'false']);
    fireEvent.click(within(items[1]!).getByTestId('watch-item-open'));
    expect(screen.getByTestId('reader-target').textContent).toBe('d9');
    fireEvent.click(within(items[0]!).getByTestId('watch-item-external'));
    fireEvent.click(within(items[2]!).getByTestId('watch-item-external'));
    await waitFor(() => expect(callsTo('citations:openExternal')).toEqual([{ kind: 'doi', id: '10.1000/s11' }, { kind: 'openalex', id: 'W77' }]));

    fireEvent.change(screen.getByTestId('watch-filter'), { target: { value: 's2' } });
    await waitFor(() => expect(screen.getAllByTestId('watch-item')).toHaveLength(1));
    expect(callsTo('watch:items').at(-1)).toMatchObject({ sourceId: 's2' });
    fireEvent.click(screen.getByTestId('watch-dismiss'));
    await waitFor(() => expect(screen.queryAllByTestId('watch-item')).toHaveLength(0));
    expect(c.state.dismissedItems).toEqual([{ sourceId: 's2', externalId: 'W77' }]);
    expect(screen.getByTestId('watch-empty')).toBeTruthy();
  });

  it('checks on request only, shows the result and the sources that failed with the reason', async () => {
    const c = await setup();
    expect(callsTo('watch:check')).toEqual([]);
    c.state.checkResult = { checked: 2, newItems: 1, failed: [{ sourceId: 's2', code: 'NETWORK_ERROR' }, { sourceId: 'gone', code: 'INTERNAL' }] };
    fireEvent.click(screen.getByTestId('watch-check'));
    await screen.findByTestId('watch-result');
    expect(callsTo('watch:check')).toEqual([{}]);
    expect(screen.getByTestId('watch-result').textContent).toContain('2 sources checked, 1 new.');
    const failed = screen.getAllByTestId('watch-failed');
    expect(failed[0]!.textContent).toContain('Could not check “query s2”');
    expect(failed[0]!.textContent).toContain('could not be reached');
    expect(failed[1]!.textContent).toContain('removed source');
  });

  it('shows a failed check as a clear error and keeps the list', async () => {
    const c = await setup();
    c.state.checkError = new AppError('NETWORK_ERROR', 'x', { reason: 'offline' });
    fireEvent.click(screen.getByTestId('watch-check'));
    expect((await screen.findByTestId('watch-error')).textContent).toContain('No connection');
    expect(screen.getAllByTestId('watch-item')).toHaveLength(3);
  });

  it('cannot check without sources', async () => {
    await mount();
    tab('new');
    await waitFor(() => expect(screen.getByTestId('watch-check')).toHaveProperty('disabled', true));
    expect(screen.getByTestId('watch-empty')).toBeTruthy();
  });
});

describe('Discover: published versions', () => {
  const proposal = (n: number) => ({
    docId: `d${n}`,
    title: `Preprint ${n}`,
    current: { doi: null, arxivId: '2101.0000' + n, venue: null, year: 2021 },
    found: { doi: `10.1000/pub${n}`, venue: 'A Journal', venueRef: 'vol 3', year: 2022, source: 'openalex' },
    revision: 4 + n,
  });

  it('looks only on request, shows current against found, applies after confirmation with the revision and offers undo', async () => {
    const c = memoryCitations();
    c.state.published = { checked: 7, proposals: [proposal(1), proposal(2)], failed: 1 };
    await mount(c);
    tab('published');
    expect(screen.getByText(/Not looked up yet/)).toBeTruthy();
    expect(callsTo('watch:checkPublished')).toEqual([]);
    fireEvent.click(screen.getByTestId('published-own-only'));
    fireEvent.click(screen.getByTestId('published-check'));
    const items = await screen.findAllByTestId('published-item');
    expect(callsTo('watch:checkPublished')).toEqual([{ ownOnly: true }]);
    expect(screen.getByTestId('published-summary').textContent).toBe('7 documents checked, 2 proposals, 1 could not be checked.');
    expect(within(items[0]!).getByTestId('published-current-doi').textContent).toBe('—');
    expect(within(items[0]!).getByTestId('published-found-doi').textContent).toBe('10.1000/pub1');

    fireEvent.click(within(items[0]!).getByTestId('published-open'));
    await waitFor(() => expect(callsTo('citations:openExternal')).toEqual([{ kind: 'doi', id: '10.1000/pub1' }]));

    fireEvent.click(within(items[0]!).getByTestId('published-confirm'));
    await waitFor(() => expect(c.state.applied).toHaveLength(1));
    expect(c.state.applied[0]).toEqual({ docId: 'd1', doi: '10.1000/pub1', venue: 'A Journal', venueRef: 'vol 3', year: 2022, source: 'openalex', expectedRevision: 5 });
    await waitFor(() => expect(screen.getAllByTestId('published-item')).toHaveLength(1));
    const toast = (await screen.findAllByTestId('toast-action')).find((b) => b.textContent === 'Undo')!;
    fireEvent.click(toast);
    await waitFor(() => expect(c.state.undone).toEqual(['chg-1']));
  });

  it('keeps the proposal when the confirmation is refused (stale revision) and says nothing was found when so', async () => {
    const c = memoryCitations();
    c.state.published = { checked: 1, proposals: [proposal(1)], failed: 0 };
    c.state.applyError = new AppError('CONFLICT', 'stale');
    await mount(c);
    tab('published');
    fireEvent.click(screen.getByTestId('published-check'));
    fireEvent.click(await screen.findByTestId('published-confirm'));
    await waitFor(() => expect(screen.getByTestId('toasts').querySelector('[data-kind="error"]')).not.toBeNull());
    expect(screen.getAllByTestId('published-item')).toHaveLength(1);
    c.state.published = { checked: 1, proposals: [], failed: 0 };
    fireEvent.click(screen.getByTestId('published-check'));
    await screen.findByTestId('published-empty');
  });

  it('shows a network failure of the lookup', async () => {
    const c = memoryCitations();
    c.state.publishedError = new AppError('NETWORK_ERROR', 'x', { reason: 'rate-limited' });
    await mount(c);
    tab('published');
    fireEvent.click(screen.getByTestId('published-check'));
    expect((await screen.findByTestId('published-error')).textContent).toContain('rate limit');
  });
});

describe('Discover: sources', () => {
  it('adds a source (a query is required), edits, disables and removes with a confirmation', async () => {
    const c = memoryCitations({ sources: [source('s1', { lastCheckedAt: NOW })], items: [seen('s1', 1), seen('s1', 2)] });
    await mount(c);
    tab('sources');
    const row = await screen.findByTestId('watch-source-item');
    expect(row.textContent).toContain('Source s1');
    expect(row.textContent).toContain('Last checked: 2026-11-17');
    expect(within(row).getByTestId('watch-source-new').textContent).toBe('2 new');

    fireEvent.click(screen.getByTestId('watch-source-add'));
    fireEvent.click(screen.getByTestId('watch-source-save'));
    expect(screen.getByTestId('watch-source-invalid')).toBeTruthy();
    expect(c.state.saved).toEqual([]);
    fireEvent.change(screen.getByTestId('watch-source-kind'), { target: { value: 'topic' } });
    fireEvent.change(screen.getByTestId('watch-source-query'), { target: { value: ' graph learning ' } });
    fireEvent.change(screen.getByTestId('watch-source-label'), { target: { value: 'Graphs' } });
    fireEvent.click(screen.getByTestId('watch-source-save'));
    await waitFor(() => expect(screen.getAllByTestId('watch-source-item')).toHaveLength(2));
    expect(c.state.saved[0]).toEqual({ kind: 'topic', query: 'graph learning', label: 'Graphs', enabled: true });

    // own preprints need no query
    fireEvent.click(screen.getByTestId('watch-source-add'));
    fireEvent.change(screen.getByTestId('watch-source-kind'), { target: { value: 'own-preprint' } });
    expect(screen.queryByTestId('watch-source-query')).toBeNull();
    fireEvent.click(screen.getByTestId('watch-source-save'));
    await waitFor(() => expect(screen.getAllByTestId('watch-source-item')).toHaveLength(3));
    expect(c.state.saved[1]).toMatchObject({ kind: 'own-preprint', query: '' });

    // edit keeps the id
    fireEvent.click(within(screen.getAllByTestId('watch-source-item')[0]!).getByTestId('watch-source-edit'));
    fireEvent.change(screen.getByTestId('watch-source-label'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByTestId('watch-source-save'));
    await waitFor(() => expect(screen.getAllByTestId('watch-source-name')[0]!.textContent).toBe('Renamed'));
    expect(c.state.saved[2]).toMatchObject({ id: 's1', label: 'Renamed' });

    // enable switch
    fireEvent.click(within(screen.getAllByTestId('watch-source-item')[0]!).getByTestId('watch-source-enabled'));
    await waitFor(() => expect(screen.getAllByTestId('watch-source-item')[0]!.dataset.enabled).toBe('false'));
    expect(c.state.saved[3]).toMatchObject({ id: 's1', enabled: false });

    // remove asks first
    fireEvent.click(within(screen.getAllByTestId('watch-source-item')[0]!).getByTestId('watch-source-remove'));
    expect(c.state.removed).toEqual([]);
    fireEvent.click(screen.getByTestId('watch-source-remove-confirm'));
    await waitFor(() => expect(screen.getAllByTestId('watch-source-item')).toHaveLength(2));
    expect(c.state.removed).toEqual(['s1']);
  });

  it('shows an empty state and the error of a refused save', async () => {
    const c = memoryCitations();
    await mount(c);
    tab('sources');
    await screen.findByTestId('watch-source-empty');
    c.state.saveError = new AppError('INVALID_REQUEST', 'bad');
    fireEvent.click(screen.getByTestId('watch-source-add'));
    fireEvent.change(screen.getByTestId('watch-source-query'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('watch-source-save'));
    expect((await screen.findByTestId('watch-source-error')).textContent).toContain('not valid');
  });
});

describe('Discover badge in the navigation', () => {
  it('counts the new works from watch:list only, follows watch:changed and never goes online', async () => {
    const c = memoryCitations({ sources: [source('s1'), source('s2')], items: [seen('s1', 1), seen('s1', 2), seen('s2', 1)] });
    await mount(c, {}, createElement(Shell, { section: 'library', onSection() {}, onNewLibrary() {}, children: createElement('p', null, 'main') }));
    const badge = await screen.findByTestId('discover-badge');
    expect(badge.textContent).toBe('3');
    expect(badge.getAttribute('aria-label')).toBe('3 new works found');
    expect(screen.getByTestId('nav-discover')).toBeTruthy();
    c.state.items[0].dismissed = true;
    act(() => emitEvent('watch:changed', { newItems: 0 }));
    await waitFor(() => expect(screen.getByTestId('discover-badge').textContent).toBe('2'));
    for (const ch of [...NETWORK_CHANNELS, 'watch:items', 'recommend:readNext']) expect(callsTo(ch)).toEqual([]);
  });

  it('shows no badge when nothing is new', async () => {
    await mount(memoryCitations({ sources: [source('s1')] }), {}, createElement(Shell, { section: 'library', onSection() {}, onNewLibrary() {}, children: createElement('p', null, 'main') }));
    await waitFor(() => expect(callsTo('watch:list').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('discover-badge')).toBeNull();
  });
});

describe('Discover in Italian', () => {
  it('has all its texts translated', async () => {
    const { handlers } = memoryBackend({ profiles: [profile], settings: { uiLanguage: 'it' } });
    const c = memoryCitations();
    setHandlers({ ...handlers, ...c.handlers });
    render(PROVIDERS.reduceRight((child, P) => createElement(P, null, child), createElement(DiscoverView)));
    await act(async () => void (await new Promise((r) => setTimeout(r, 40))));
    expect(screen.getByTestId('discover-tab-readnext').textContent).toBe('Da leggere dopo');
    tab('new');
    expect(screen.getByTestId('watch-check').textContent).toBe('Controlla ora');
  });
});

describe('Discover: long checks', () => {
  const held = () => {
    let release!: () => void;
    const p = new Promise<void>((r) => (release = r));
    return { p, release };
  };
  const proposal = (n: number, over: Record<string, unknown> = {}) => ({
    docId: `d${n}`,
    title: `Preprint ${n}`,
    current: { doi: null, arxivId: `2101.0000${n}`, venue: null, year: 2021 },
    found: { doi: `10.1000/pub${n}`, venue: 'A Journal', venueRef: null, year: 2022, source: 'openalex' },
    revision: 1,
    ...over,
  });

  it('shows the progress of a source check and cancels it, then shows what was checked', async () => {
    const c = memoryCitations({ sources: [source('s1'), source('s2')] });
    const h = held();
    c.state.hold = h.p;
    c.state.checkResult = { checked: 1, newItems: 0, failed: [] };
    await mount(c);
    tab('new');
    fireEvent.click(await screen.findByTestId('watch-check'));
    act(() => emitEvent('watch:progress', { op: 'check', done: 1, total: 2, failed: 0 }));
    expect((await screen.findByTestId('watch-progress')).textContent).toContain('1 of 2 sources');
    fireEvent.click(screen.getByTestId('watch-cancel'));
    await waitFor(() => expect(c.state.watchCancelled).toEqual(['check']));
    h.release();
    await screen.findByTestId('watch-result');
    expect(screen.queryByTestId('watch-progress')).toBeNull();
  });

  it('keeps a running published check when the tab is left and shows its answer on return', async () => {
    const c = memoryCitations();
    const h = held();
    c.state.hold = h.p;
    c.state.published = { checked: 2, proposals: [proposal(1)], failed: 0 };
    await mount(c);
    tab('published');
    fireEvent.click(screen.getByTestId('published-check'));
    act(() => emitEvent('watch:progress', { op: 'checkPublished', done: 3, total: 9, failed: 1 }));
    expect((await screen.findByTestId('published-progress')).textContent).toContain('3 of 9 documents');
    tab('sources');
    tab('published');
    expect((await screen.findByTestId('published-progress')).textContent).toContain('Looking');
    expect(screen.getByTestId('published-check')).toHaveProperty('disabled', true);
    h.release();
    await screen.findByTestId('published-item');
    expect(callsTo('watch:checkPublished')).toHaveLength(1);
    // the answer outlives the tab too
    tab('new');
    tab('published');
    expect(screen.getByTestId('published-item')).toBeTruthy();
  });

  it('does not offer to apply a published version whose DOI another document already has', async () => {
    const c = memoryCitations();
    c.state.published = { checked: 1, proposals: [proposal(1, { ownedBy: 'd9' })], failed: 0 };
    await mount(c);
    tab('published');
    fireEvent.click(screen.getByTestId('published-check'));
    await screen.findByTestId('published-item');
    expect(screen.getByTestId('published-owned').textContent).toContain('already has this DOI');
    expect(screen.getByTestId('published-confirm')).toHaveProperty('disabled', true);
  });

  it('offers to set a damaged watch file aside and starts again', async () => {
    const c = memoryCitations({ sources: [source('s1')] });
    c.state.listError = new AppError('SCHEMA_INVALID', 'bad');
    await mount(c);
    fireEvent.click(await screen.findByTestId('watch-reset'));
    await waitFor(() => expect(c.state.resets).toBe(1));
    await waitFor(() => expect(screen.queryByTestId('watch-damaged')).toBeNull());
  });

  it('waits for a pause before asking again when the minimum changes', async () => {
    await mount();
    await screen.findByTestId('readnext-few');
    const before = callsTo('recommend:readNext').length;
    fireEvent.change(screen.getByTestId('readnext-min'), { target: { value: '3' } });
    fireEvent.change(screen.getByTestId('readnext-min'), { target: { value: '4' } });
    await act(async () => void (await new Promise((r) => setTimeout(r, 120))));
    expect(callsTo('recommend:readNext').length).toBe(before);
    await waitFor(() => expect(callsTo('recommend:readNext').length).toBe(before + 1));
    expect(callsTo('recommend:readNext').at(-1)).toEqual({ minCiting: 4 });
  });
});
