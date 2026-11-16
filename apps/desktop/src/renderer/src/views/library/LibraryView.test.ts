// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryProfile } from '@rl/core';
import i18n from '../../i18n';
import { AppProvider } from '../../state/app-context';
import { callsTo, emitEvent, memoryBackend, setHandlers } from '../../testing/mockRl';
import { SEARCH_MARK_CLOSE as C, SEARCH_MARK_OPEN as O } from '@rl/core';
import { Snippet } from './Snippet';
import { toggleFilter } from './Facets';
import { LibraryView } from './LibraryView';

vi.mock('../../lib/rl', async () => (await import('../../testing/mockRl')).rlModule);

const profile: LibraryProfile = { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' };
const hit = {
  docId: 'abcdef0123456789',
  title: 'Sparse Attention',
  authors: ['Ada L'],
  year: 2021,
  type: 'article',
  path: 'papers/sparse.pdf',
  studyState: 'to-read',
  score: 1,
  field: 'text',
  snippet: `layouts keep ${O}quality${C} while saving memory`,
  page: 2,
  pages: [{ page: 2, snippet: `layouts keep ${O}quality${C}` }],
};
const emptyFacets = { total: 0, tags: [], authors: [], types: [], venues: [], studyStates: [], years: [], folders: [] };

function setup(scan: Record<string, unknown> = {}) {
  const { handlers } = memoryBackend({ profiles: [profile] });
  setHandlers({
    ...handlers,
    'scan:status': () => ({ libraryId: 'lib-a', state: 'done', seen: 1, processed: 0, indexed: 1, ...scan }),
    'scan:start': () => ({ libraryId: 'lib-a', state: 'running', seen: 0, processed: 0, indexed: 0 }),
    'search:run': (p: any) => ({
      total: p.text === 'none' ? 0 : 1,
      hits: p.text === 'none' ? [] : [hit],
      tookMs: 3.2,
      facets: { ...emptyFacets, total: 1, tags: [{ value: 'ml', label: 'Machine learning', count: 1 }], years: [{ value: '2021', count: 1 }] },
    }),
  });
  render(createElement(AppProvider, null, createElement(LibraryView)));
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => cleanup());

describe('LibraryView', () => {
  it('lists results with title, authors, year, marked snippet and pages', async () => {
    setup();
    const results = await screen.findByTestId('search-results');
    const item = within(results).getByTestId('search-result');
    expect(item.textContent).toContain('Sparse Attention');
    expect(item.textContent).toContain('Ada L · 2021 · article');
    const marks = item.querySelectorAll('mark');
    expect([...marks].map((m) => m.textContent)).toEqual(['quality']);
    expect(within(item).getByTestId('result-pages').textContent).toContain('p. 2');
    expect(screen.getByTestId('search-summary').textContent).toContain('1 document');
  });

  it('searches as the user types and shows an empty state', async () => {
    setup();
    await screen.findByTestId('search-results');
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'none' } });
    await screen.findByTestId('search-empty');
    expect(callsTo('search:run').some((p) => p.text === 'none')).toBe(true);
  });

  it('sends the facet choice as a filter', async () => {
    setup();
    const facet = await screen.findByTestId('facet-tags');
    fireEvent.click(within(facet).getByLabelText(/Machine learning/));
    await waitFor(() => expect(callsTo('search:run').some((p) => p.filters?.tags?.[0] === 'ml')).toBe(true));
    fireEvent.click(screen.getByTestId('search-clear-filters'));
    await waitFor(() => expect(callsTo('search:run').at(-1).filters).toEqual({}));
  });

  it('starts a scan when none ran yet, and offers cancel while one runs', async () => {
    setup({ state: 'idle', indexed: 0 });
    await waitFor(() => expect(callsTo('scan:start')).toHaveLength(1));
    emitEvent('scan:progress', { libraryId: 'lib-a', state: 'running', phase: 'extracting', seen: 3, processed: 1, total: 3, indexed: 0 });
    await screen.findByTestId('scan-cancel');
  });
});

describe('pagination', () => {
  const TOTAL = 460;
  const mk = (i: number) => ({ ...hit, docId: i.toString(16).padStart(16, '0'), title: `Doc ${i}` });
  const slice = (p: any) => Array.from({ length: Math.max(0, Math.min(p.limit, TOTAL - (p.offset ?? 0))) }, (_, k) => mk((p.offset ?? 0) + k));

  it('reaches every result in fixed-size pages and hides the button at the end', async () => {
    const { handlers } = memoryBackend({ profiles: [profile] });
    setHandlers({
      ...handlers,
      'scan:status': () => ({ libraryId: 'lib-a', state: 'done', seen: 1, processed: 0, indexed: 1 }),
      'search:run': (p: any) => ({ total: TOTAL, hits: slice(p), tookMs: 1, facets: { ...emptyFacets, total: TOTAL } }),
      'search:query': (p: any) => {
        if (p.limit > 200) throw new Error('page size above the channel maximum');
        return { total: TOTAL, hits: slice(p), tookMs: 1 };
      },
    });
    render(createElement(AppProvider, null, createElement(LibraryView)));
    await screen.findByTestId('search-results');
    let clicks = 0;
    while (screen.queryByTestId('search-more')) {
      const before = screen.getAllByTestId('search-result').length;
      fireEvent.click(screen.getByTestId('search-more'));
      await waitFor(() => expect(screen.getAllByTestId('search-result').length).toBeGreaterThan(before));
      if (++clicks > 40) throw new Error('the button never disappears');
    }
    expect(screen.getAllByTestId('search-result')).toHaveLength(TOTAL);
    expect(new Set(screen.getAllByTestId('search-result').map((e) => e.getAttribute('data-doc-id'))).size).toBe(TOTAL);
    expect(clicks).toBe(Math.ceil(TOTAL / 25) - 1);
    const offsets = callsTo('search:query').map((p) => p.offset);
    expect(offsets[0]).toBe(25);
    expect(offsets.at(-1)).toBe(450);
    expect(callsTo('search:query').every((p) => p.limit === 25)).toBe(true);
  });
});

describe('helpers', () => {
  it('Snippet never produces HTML', () => {
    const { container } = render(createElement(Snippet, { text: `a <b>x</b> ${O}hit${C} z` }));
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('mark')?.textContent).toBe('hit');
    expect(container.textContent).toBe('a <b>x</b> hit z');
  });

  it('Snippet treats [[ ]] and bidi overrides as plain text', () => {
    const { container } = render(createElement(Snippet, { text: `[[fake]] ${O}real${C} \u202Eevil` }));
    expect([...container.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['real']);
    expect(container.textContent).toBe('[[fake]] real evil');
  });

  it('toggleFilter adds, removes and handles years', () => {
    expect(toggleFilter({}, 'tags', 'a')).toEqual({ tags: ['a'] });
    expect(toggleFilter({ tags: ['a'] }, 'tags', 'a')).toEqual({});
    expect(toggleFilter({}, 'years', '2020')).toEqual({ yearFrom: 2020, yearTo: 2020 });
    expect(toggleFilter({ yearFrom: 2020, yearTo: 2020 }, 'years', '2020')).toEqual({});
  });
});
