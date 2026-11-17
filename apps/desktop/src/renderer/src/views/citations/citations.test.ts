// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, CITATION_LIMITS, type LibraryProfile } from '@rl/core';
import i18n from '../../i18n';
import { CitationIndicator, CitationJobsProvider, REFRESH_MANY_MAX, useCitationJob } from '../../lib/citationJobs';
import { LibraryEventsProvider } from '../../lib/events';
import { HistoryProvider } from '../../lib/history';
import { NotifyProvider } from '../../lib/notify';
import { ReaderProvider, useReader } from '../../lib/reader';
import { workLink } from '../../lib/workLinks';
import { AppProvider } from '../../state/app-context';
import { fakeLink, fakeView, memoryCitations } from '../../testing/memoryCitations';
import { makeDocs, memoryLibrary } from '../../testing/memoryLibrary';
import { callsTo, emitEvent, memoryBackend, setHandlers } from '../../testing/mockRl';
import { LibraryView } from '../library/LibraryView';
import { CitationsPanel } from './CitationsPanel';

vi.mock('../../lib/rl', async () => (await import('../../testing/mockRl')).rlModule);

const profile: LibraryProfile = { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' };
const PROVIDERS: any[] = [AppProvider, LibraryEventsProvider, NotifyProvider, HistoryProvider, ReaderProvider, CitationJobsProvider];

function Probe() {
  const { target } = useReader();
  const { version } = useCitationJob();
  return createElement('div', null, createElement('span', { 'data-testid': 'reader-target' }, target?.docId ?? ''), createElement('span', { 'data-testid': 'cit-version' }, String(version)));
}

/** Lets the app load its settings and the active library, so event subscriptions of the providers are in place. */
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 40))));

async function mount(child: ReactNode, extra: Record<string, (p: any) => unknown> = {}, citations = memoryCitations(), lang: 'it' | 'en' = 'en') {
  const { handlers } = memoryBackend({ profiles: [profile], settings: { uiLanguage: lang } });
  setHandlers({ ...handlers, ...citations.handlers, ...extra });
  render(PROVIDERS.reduceRight((c, P) => createElement(P, null, c), createElement('div', null, child, createElement(CitationIndicator), createElement(Probe))));
  await settle();
  return citations;
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  try {
    window.localStorage.clear();
  } catch {
    // no storage
  }
});
afterEach(() => cleanup());

describe('workLink', () => {
  it('gives an identifier, never a URL (the main process builds the address)', () => {
    expect(workLink({ doi: '10.1000/abc' })).toEqual({ kind: 'doi', id: '10.1000/abc' });
    expect(workLink({ doi: 'https://doi.org/10.1000/abc' })).toEqual({ kind: 'doi', id: '10.1000/abc' });
    expect(workLink({ doi: '10.1000/abc', arxivId: '2101.00001' })?.kind).toBe('doi');
    expect(workLink({ arxivId: 'arXiv:2101.00001' })).toEqual({ kind: 'arxiv', id: '2101.00001' });
    expect(workLink({ externalId: 'W123' })).toEqual({ kind: 'openalex', id: 'W123' });
    expect(workLink({ externalId: 'https://evil.example/W1' })).toBeNull();
    expect(workLink({ doi: `10.1000/${'x'.repeat(400)}` })).toBeNull();
    expect(workLink({})).toBeNull();
  });

  it('keeps the bulk limit in step with the contract', () => {
    expect(REFRESH_MANY_MAX).toBe(CITATION_LIMITS.refreshMany);
  });
});

describe('CitationsPanel', () => {
  it('shows a never-fetched empty state that explains the network and uses it only on Refresh', async () => {
    const c = await mount(createElement(CitationsPanel, { docId: 'd1' }));
    const empty = await screen.findByTestId('citations-empty');
    expect(empty.textContent).toContain('only when you ask');
    expect(callsTo('citations:refresh')).toEqual([]);
    c.state.fetchable.set('d1', fakeView('d1', { references: [fakeLink({ title: 'Ref one' })] }));
    fireEvent.click(screen.getByTestId('citations-refresh'));
    await screen.findByTestId('citations-summary');
    expect(callsTo('citations:refresh')).toEqual([{ docId: 'd1' }]);
  });

  it('lists references and citing works with the in-library / missing summary, the count and the date', async () => {
    const c = memoryCitations();
    c.state.stored.set(
      'd1',
      fakeView('d1', {
        references: [
          fakeLink({ title: 'Owned work', year: 2019, venue: 'A Journal', matchedDocId: 'd2', matched: { docId: 'd2', title: 'Owned in library', path: 'a/b.pdf' } }),
          fakeLink({ title: 'Missing work', doi: '10.1000/missing', authors: ['A. One', 'B. Two', 'C. Three', 'D. Four'] }),
          fakeLink({ title: 'Preprint work', arxivId: '2101.00001' }),
        ],
        citedBy: [fakeLink({ title: 'Later work', year: 2024 })],
        citedByCount: 42,
        referencesCheckedAt: '2026-11-01T10:00:00.000Z',
        citedByCheckedAt: '2026-11-03T10:00:00.000Z',
      }),
    );
    await mount(createElement(CitationsPanel, { docId: 'd1' }), {}, c);
    await screen.findByTestId('citations-summary');
    expect(screen.getByTestId('citations-summary').textContent).toBe('References: 1 in library / 2 missing');
    expect(screen.getByTestId('citations-count').textContent).toBe('Cited by 42 works in all');
    expect(screen.getByTestId('citations-checked').textContent).toBe('Last checked: 2026-11-03');
    const refs = screen.getAllByTestId('citation-ref');
    expect(refs.map((r) => r.dataset.inLibrary)).toEqual(['true', 'false', 'false']);
    expect(refs[0]!.textContent).toContain('2019 · A Journal');
    expect(refs[1]!.textContent).toContain('A. One, B. Two, C. Three et al.');
    expect(screen.getAllByTestId('citation-citedby')).toHaveLength(1);

    // the chip opens the document in the reader
    fireEvent.click(within(refs[0]!).getByTestId('citation-ref-open'));
    expect(screen.getByTestId('reader-target').textContent).toBe('d2');
    // missing works link to DOI or arXiv, through the main process opener only
    fireEvent.click(within(refs[1]!).getByTestId('citation-ref-external'));
    fireEvent.click(within(refs[2]!).getByTestId('citation-ref-external'));
    await waitFor(() => expect(callsTo('citations:openExternal')).toEqual([{ kind: 'doi', id: '10.1000/missing' }, { kind: 'arxiv', id: '2101.00001' }]));
  });

  it('renders remote metadata as text only', async () => {
    const c = memoryCitations();
    c.state.stored.set('d1', fakeView('d1', { references: [fakeLink({ title: '<img src=x onerror=alert(1)>Evil‮title', authors: ['<b>Bold</b>'], doi: '10.1/<script>' })] }));
    await mount(createElement(CitationsPanel, { docId: 'd1' }), {}, c);
    const row = await screen.findByTestId('citation-ref');
    expect(row.querySelector('img, b, script')).toBeNull();
    expect(row.textContent).toContain('<img src=x onerror=alert(1)>Eviltitle');
    expect(row.textContent).toContain('<b>Bold</b>');
  });

  it('pages long lists', async () => {
    const c = memoryCitations();
    c.state.stored.set('d1', fakeView('d1', { references: Array.from({ length: 120 }, (_, i) => fakeLink({ title: `Work ${i}` })) }));
    await mount(createElement(CitationsPanel, { docId: 'd1' }), {}, c);
    await screen.findByTestId('citations-summary');
    expect(screen.getAllByTestId('citation-ref')).toHaveLength(50);
    fireEvent.click(screen.getByTestId('citation-ref-more'));
    expect(screen.getAllByTestId('citation-ref')).toHaveLength(100);
  });

  it.each([
    ['offline', 'No connection'],
    ['rate-limited', 'rate limit'],
    ['http', 'answered with an error'],
  ])('says clearly why a refresh failed (%s)', async (reason, text) => {
    const c = memoryCitations();
    c.state.refreshError = new AppError('NETWORK_ERROR', 'x', { reason });
    await mount(createElement(CitationsPanel, { docId: 'd1' }), {}, c);
    await screen.findByTestId('citations-empty');
    fireEvent.click(screen.getByTestId('citations-refresh'));
    expect((await screen.findByTestId('citations-error')).textContent).toContain(text);
    // the stored (empty) state is still there and Refresh can be tried again
    expect(screen.getByTestId('citations-refresh')).toHaveProperty('disabled', false);
  });

  it('explains a work no source knows', async () => {
    const c = memoryCitations();
    c.state.refreshError = new AppError('NOT_FOUND', 'x');
    await mount(createElement(CitationsPanel, { docId: 'd1' }), {}, c);
    await screen.findByTestId('citations-empty');
    fireEvent.click(screen.getByTestId('citations-refresh'));
    expect((await screen.findByTestId('citations-error')).textContent).toContain('No online source knows');
  });

  it('works in Italian too', async () => {
    await mount(createElement(CitationsPanel, { docId: 'd1' }), {}, memoryCitations(), 'it');
    // The Italian part of the view strings loads asynchronously: wait for the text, not only for the element.
    await waitFor(() => expect(screen.getByTestId('citations-empty').textContent).toContain('solo su richiesta'));
    expect(screen.getByTestId('citations-refresh').textContent).toBe('Aggiorna');
  });
});

describe('bulk citation refresh', () => {
  function Starter({ ids }: { ids: string[] }) {
    const job = useCitationJob();
    return createElement('button', { type: 'button', 'data-testid': 'go', onClick: () => void job.start(ids) }, 'go');
  }

  it('starts one job for the documents, follows the progress, cancels and ends', async () => {
    const c = await mount(createElement(Starter, { ids: ['d1', 'd2', 'd3'] }));
    expect(screen.queryByTestId('citations-indicator')).toBeNull();
    fireEvent.click(screen.getByTestId('go'));
    await waitFor(() => expect(c.state.manyStarted).toEqual([['d1', 'd2', 'd3']]));
    // an event that arrives before the answer is not lost, one of another job is ignored
    act(() => c.progress({ state: 'running', total: 3, done: 1 }));
    act(() => emitEvent('citations:progress', { jobId: 'other', state: 'running', total: 9, done: 9, failed: 0, skipped: 0 }));
    expect((await screen.findByTestId('citations-text')).textContent).toBe('Citations: 1/3');
    fireEvent.click(screen.getByTestId('citations-cancel'));
    await waitFor(() => expect(c.state.cancelled).toEqual(['job-1']));
    act(() => c.progress({ state: 'cancelled', total: 3, done: 1 }));
    expect(screen.getByTestId('citations-text').textContent).toBe('Citations stopped: 1/3 done');
    expect(screen.getByTestId('cit-version').textContent).toBe('1');
    act(() => c.progress({ state: 'done', total: 3, done: 3, skipped: 1, failed: 1 }));
    expect(screen.getByTestId('citations-text').textContent).toBe('Citations updated: 3/3 (1 skipped, 0 not found, 1 failed)');
    fireEvent.click(screen.getByTestId('citations-dismiss'));
    expect(screen.queryByTestId('citations-indicator')).toBeNull();
  });

  it('shows a network failure of the job by its code and refuses too many documents without calling', async () => {
    const c = await mount(createElement(Starter, { ids: ['d1'] }));
    fireEvent.click(screen.getByTestId('go'));
    await waitFor(() => expect(c.state.manyStarted).toHaveLength(1));
    act(() => c.progress({ state: 'failed', total: 1, done: 0, failed: 1, error: { code: 'NETWORK_ERROR', message: 'x' } }));
    expect((await screen.findByTestId('citations-error')).textContent).toContain('could not be reached');
    cleanup();
    const c2 = await mount(createElement(Starter, { ids: Array.from({ length: REFRESH_MANY_MAX + 1 }, (_, i) => `d${i}`) }));
    fireEvent.click(screen.getByTestId('go'));
    await waitFor(() => expect(screen.getByTestId('toasts').textContent).toContain('At most 2000 documents'));
    expect(c2.state.manyStarted).toEqual([]);
  });

  it('refuses a second job while one is running and disables the button of the selection', async () => {
    const lib = memoryLibrary({ docs: makeDocs(4) });
    const c = await mount(createElement('div', null, createElement(LibraryView), createElement(Starter, { ids: ['d1'] })), lib.handlers);
    await screen.findAllByTestId('search-result');
    fireEvent.click(screen.getAllByTestId('search-result')[0]!);
    fireEvent.click(await screen.findByTestId('bulk-citations'));
    await waitFor(() => expect(c.state.manyStarted).toHaveLength(1));
    act(() => c.progress({ state: 'running', total: 1, done: 0 }));
    await waitFor(() => expect(screen.getByTestId('bulk-citations')).toHaveProperty('disabled', true));
    fireEvent.click(screen.getByTestId('go'));
    await waitFor(() => expect(screen.getByTestId('toasts').textContent).toContain('already running'));
    expect(c.state.manyStarted).toHaveLength(1);
    act(() => c.progress({ state: 'done', total: 1, done: 1 }));
    await waitFor(() => expect(screen.getByTestId('bulk-citations')).toHaveProperty('disabled', false));
  });

  it('is offered from the library selection and starts the job for the selected documents', async () => {
    const lib = memoryLibrary({ docs: makeDocs(4) });
    const c = await mount(createElement(LibraryView), lib.handlers);
    await screen.findAllByTestId('search-result');
    const rows = screen.getAllByTestId('search-result');
    fireEvent.click(rows[0]!);
    fireEvent.click(rows[1]!, { ctrlKey: true });
    fireEvent.click(await screen.findByTestId('bulk-citations'));
    await waitFor(() => expect(c.state.manyStarted).toHaveLength(1));
    expect(c.state.manyStarted[0]).toHaveLength(2);
    expect(callsTo('citations:refresh')).toEqual([]);
  });
});

describe('CitationsPanel across documents', () => {
  it('does not carry the refreshing state or the page size over to another document', async () => {
    let finish!: () => void;
    const slow = new Promise<void>((r) => (finish = r));
    const many = Array.from({ length: 60 }, (_, i) => fakeLink({ title: `Ref ${i}` }));
    const c = memoryCitations();
    c.state.stored.set('d1', fakeView('d1', { references: many }));
    c.state.stored.set('d2', fakeView('d2', { references: many }));
    function Switch() {
      const [id, setId] = useState('d1');
      return createElement('div', null, createElement('button', { type: 'button', 'data-testid': 'switch', onClick: () => setId('d2') }), createElement(CitationsPanel, { docId: id }));
    }
    const refresh = async (p: any) => {
      if (p.docId === 'd1') await slow;
      return fakeView(p.docId);
    };
    await mount(createElement(Switch), { 'citations:refresh': refresh }, c);
    await screen.findAllByTestId('citation-ref');
    fireEvent.click(screen.getByTestId('citation-ref-more'));
    expect(screen.getAllByTestId('citation-ref')).toHaveLength(60);
    fireEvent.click(screen.getByTestId('citations-refresh'));
    await waitFor(() => expect(screen.getByTestId('citations-refresh')).toHaveProperty('disabled', true));
    fireEvent.click(screen.getByTestId('switch'));
    await waitFor(() => expect(screen.getByTestId('citations-refresh')).toHaveProperty('disabled', false));
    await waitFor(() => expect(screen.getAllByTestId('citation-ref')).toHaveLength(50));
    await act(async () => {
      finish();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByTestId('citations-refresh')).toHaveProperty('disabled', false);
  });
});

describe('document detail', () => {
  it('loads the citations panel only when asked, and fetches nothing until Refresh', async () => {
    const lib = memoryLibrary({ docs: makeDocs(3) });
    const c = await mount(createElement(LibraryView), lib.handlers);
    await screen.findAllByTestId('search-result');
    fireEvent.click(screen.getAllByTestId('search-result')[0]!);
    fireEvent.click(await screen.findByTestId('selection-details'));
    const toggle = await screen.findByTestId('citations-toggle');
    expect(callsTo('citations:get')).toEqual([]);
    expect(screen.queryByTestId('citations-panel')).toBeNull();
    fireEvent.click(toggle);
    await screen.findByTestId('citations-empty');
    expect(callsTo('citations:get')).toHaveLength(1);
    expect(c.state.refreshed).toEqual([]);
    fireEvent.click(toggle);
    expect(screen.queryByTestId('citations-panel')).toBeNull();
  });
});
