// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, type LibraryProfile } from '@rl/core';
import i18n from '../../i18n';
import { AiUiProvider } from '../../lib/aiUi';
import { LibraryEventsProvider } from '../../lib/events';
import { HistoryProvider } from '../../lib/history';
import { JobsProvider } from '../../lib/jobs';
import { NotifyProvider } from '../../lib/notify';
import { ReaderProvider } from '../../lib/reader';
import { AppProvider } from '../../state/app-context';
import { memoryAi } from '../../testing/memoryAi';
import { memoryWork } from '../../testing/memoryWork';
import { callsTo, memoryBackend, setHandlers } from '../../testing/mockRl';
import { clearLabels } from '../chat/useLabels';
import { TaxonomyProvider } from '../library/useTaxonomy';
import { ReviewView } from './ReviewView';

vi.mock('../../lib/rl', async () => (await import('../../testing/mockRl')).rlModule);

const profile: LibraryProfile = { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' };
const D1 = '1111111111111111';
const D2 = '2222222222222222';
const meta = { model: 'claude-haiku-5-5', provider: 'claude-agent-sdk', date: '2026-11-16T10:00:00.000Z', source: 'job' };
const item = (docId: string, field: string, value: unknown, over: Record<string, unknown> = {}) => ({ docId, title: docId === D1 ? 'Paper One' : 'Paper Two', path: docId === D1 ? 'alpha/one.pdf' : 'beta/two.pdf', revision: 3, status: 'proposed', meta, field, value, ...over });
const node = (id: string, label: string) => ({ id, label, parents: [], aliases: [], implies: [], status: 'active', color: undefined, counts: { direct: 0, total: 0 } });

function setup(items: any[], tweak: (w: ReturnType<typeof memoryWork>) => void = () => {}) {
  const ai = memoryAi({ docs: [] });
  const work = memoryWork(ai);
  work.state.reviewItems = items;
  tweak(work);
  const { handlers } = memoryBackend({ profiles: [profile] });
  setHandlers({
    ...handlers,
    ...ai.handlers,
    ...work.handlers,
    'documents:get': (p: any) => ({ id: p.docId, title: p.docId === D1 ? 'Paper One' : 'Paper Two' }),
    'taxonomy:get': () => ({ revision: 1, nodes: [node('tag-a', 'Alpha tag'), node('tag-b', 'Beta tag')], venues: [], documentTypes: [] }),
    'history:list': () => ({ items: [], canUndo: true, canRedo: false }),
    'history:undo': () => ({ summary: 'review' }),
  });
  const providers: any[] = [AppProvider, LibraryEventsProvider, NotifyProvider, HistoryProvider, ReaderProvider, AiUiProvider, JobsProvider, TaxonomyProvider];
  render(providers.reduceRight((child, P) => createElement(P, null, child), createElement(ReviewView)));
  return work;
}

const row = (field: string, docId = D1) => screen.getAllByTestId('review-item').find((e) => e.getAttribute('data-field') === field && e.getAttribute('data-doc-id') === docId)!;

beforeEach(async () => {
  clearLabels();
  await i18n.changeLanguage('en');
});
afterEach(() => cleanup());

describe('review of AI proposals', () => {
  it('lists the proposals grouped by document with the AI mark, the stats and taxonomy labels on tags', async () => {
    setup([item(D1, 'tags', ['tag-a', 'tag-b']), item(D1, 'description', 'About things'), item(D2, 'keywords', ['x', 'y'])], (w) => {
      w.state.tagsProposed = 4;
      w.state.tagsAccepted = 3;
    });
    const groups = await screen.findAllByTestId('review-group');
    expect(groups).toHaveLength(2);
    expect(within(groups[0]!).getAllByTestId('review-item')).toHaveLength(2);
    expect(within(groups[0]!).getByTestId('review-doc-title').textContent).toBe('Paper One');
    expect(within(row('tags')).getAllByTestId('review-tag').map((b) => b.textContent)).toEqual(['Alpha tag', 'Beta tag']);
    expect(within(row('description')).getByTestId('review-ai-mark').textContent).toContain('claude-haiku-5-5');
    expect(screen.getByTestId('review-pending').textContent).toBe('3 proposals to review');
    expect(screen.getByTestId('review-rate').textContent).toBe('Tags accepted: 75% (3 of 4)');
  });

  it('accepts a subset of the tags with the revision, and offers undo of that change', async () => {
    const w = setup([item(D1, 'tags', ['tag-a', 'tag-b'])]);
    await screen.findByTestId('review-item');
    fireEvent.click(within(row('tags')).getAllByTestId('review-tag')[1]!);
    expect(within(row('tags')).getByTestId('review-accept').textContent).toBe('Accept 1 tag');
    fireEvent.click(within(row('tags')).getByTestId('review-accept'));
    await waitFor(() => expect(w.state.decisions).toHaveLength(1));
    expect(w.state.decisions[0]).toEqual({ docId: D1, field: 'tags', decision: 'accept', keepTagIds: ['tag-a'], expectedRevision: 3 });
    await waitFor(() => expect(screen.queryByTestId('review-item')).toBeNull());
    expect(screen.getByTestId('review-empty')).toBeTruthy();
    fireEvent.click(await screen.findByTestId('toast-action'));
    await waitFor(() => expect(callsTo('history:undo')).toEqual([{ changeId: 'change-1' }]));
  });

  it('accepts all the tags as they are, and cannot accept when none is kept', async () => {
    const w = setup([item(D1, 'tags', ['tag-a'])]);
    await screen.findByTestId('review-item');
    fireEvent.click(within(row('tags')).getByTestId('review-tag'));
    expect((within(row('tags')).getByTestId('review-accept') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(row('tags')).getByTestId('review-tag'));
    fireEvent.click(within(row('tags')).getByTestId('review-accept'));
    await waitFor(() => expect(w.state.decisions[0]).toEqual({ docId: D1, field: 'tags', decision: 'accept', expectedRevision: 3 }));
  });

  it('edits a description and a list, and rejects a field', async () => {
    const w = setup([item(D1, 'description', 'About things'), item(D1, 'keywords', ['x', 'y']), item(D2, 'summary', 'Short')]);
    await screen.findAllByTestId('review-item');
    fireEvent.click(within(row('description')).getByTestId('review-edit'));
    fireEvent.change(within(row('description')).getByTestId('review-edit-text'), { target: { value: 'My own words' } });
    fireEvent.click(within(row('description')).getByTestId('review-edit-save'));
    await waitFor(() => expect(w.state.decisions[0]).toMatchObject({ field: 'description', decision: 'edit', text: 'My own words', expectedRevision: 3 }));

    await waitFor(() => expect(screen.queryAllByTestId('review-item')).toHaveLength(2));
    fireEvent.click(within(row('keywords')).getByTestId('review-edit'));
    fireEvent.change(within(row('keywords')).getByTestId('review-edit-text'), { target: { value: 'one\ntwo\none' } });
    fireEvent.click(within(row('keywords')).getByTestId('review-edit-save'));
    await waitFor(() => expect(w.state.decisions[1]).toMatchObject({ field: 'keywords', decision: 'edit', items: ['one', 'two'] }));

    await waitFor(() => expect(screen.queryAllByTestId('review-item')).toHaveLength(1));
    fireEvent.click(within(row('summary', D2)).getByTestId('review-reject'));
    await waitFor(() => expect(w.state.decisions[2]).toMatchObject({ docId: D2, field: 'summary', decision: 'reject' }));
  });

  it('keeps and corrects new tags: label, parent, aliases, and drops the unchecked ones', async () => {
    const w = setup([
      item(D1, 'newTags', [
        { label: 'Fresh', parentId: null, aliases: [], reason: 'nothing fits' },
        { label: 'Other', parentId: null, aliases: [] },
      ]),
    ]);
    await screen.findByTestId('review-item');
    const rows = within(row('newTags')).getAllByTestId('review-newtag');
    fireEvent.change(within(rows[0]!).getByTestId('review-newtag-label'), { target: { value: 'Fresher' } });
    await waitFor(() => expect(within(rows[0]!).getAllByRole('option').length).toBeGreaterThan(1));
    fireEvent.change(within(rows[0]!).getByTestId('review-newtag-parent'), { target: { value: 'tag-a' } });
    fireEvent.change(within(rows[0]!).getByTestId('review-newtag-aliases'), { target: { value: 'fr, fresh ' } });
    fireEvent.click(within(rows[1]!).getByTestId('review-newtag-keep'));
    fireEvent.click(within(row('newTags')).getByTestId('review-accept'));
    await waitFor(() => expect(w.state.decisions).toHaveLength(1));
    expect(w.state.decisions[0]).toMatchObject({ field: 'newTags', decision: 'accept', keepNewTags: [{ index: 0, label: 'Fresher', parentId: 'tag-a', aliases: ['fr', 'fresh'] }] });
  });

  it('accepts or rejects the whole page at once (one change) and reports what could not be decided', async () => {
    const w = setup([item(D1, 'description', 'a'), item(D2, 'summary', 'b')]);
    await screen.findAllByTestId('review-item');
    fireEvent.click(screen.getByTestId('review-accept-all'));
    await waitFor(() => expect(w.state.manyDecisions).toHaveLength(1));
    expect(w.state.manyDecisions[0]).toEqual({ items: [{ docId: D1, field: 'description' }, { docId: D2, field: 'summary' }], decision: 'accept' });
    await waitFor(() => expect(screen.getByTestId('review-empty')).toBeTruthy());
    expect((await screen.findAllByTestId('toast'))[0]!.textContent).toContain('2 proposals accepted');
  });

  it('rejects the whole page', async () => {
    const w = setup([item(D1, 'description', 'a')]);
    await screen.findByTestId('review-item');
    fireEvent.click(screen.getByTestId('review-reject-all'));
    await waitFor(() => expect(w.state.manyDecisions[0]?.decision).toBe('reject'));
  });

  it('shows a stale revision as a notice with the invitation to reload', async () => {
    setup([item(D1, 'description', 'a')], (w) => void (w.state.decideError = new AppError('CONFLICT', 'stale', { reason: 'revision' })));
    await screen.findByTestId('review-item');
    fireEvent.click(within(row('description')).getByTestId('review-accept'));
    const toast = await screen.findByTestId('toast');
    expect(toast.getAttribute('data-kind')).toBe('error');
    expect(screen.getByTestId('toast-action').textContent).toBe('Reload');
  });

  it('pages the queue and filters by field', async () => {
    const many = Array.from({ length: 60 }, (_, i) => item(String(i).padStart(16, '0'), 'description', `text ${i}`));
    setup(many);
    expect(await screen.findAllByTestId('review-item')).toHaveLength(50);
    expect(screen.getByTestId('review-page').textContent).toBe('Page 1 of 2');
    fireEvent.click(screen.getByTestId('review-page-next'));
    await waitFor(() => expect(screen.getAllByTestId('review-item')).toHaveLength(10));
    expect(callsTo('review:list').at(-1)).toMatchObject({ offset: 50, limit: 50 });
    fireEvent.change(screen.getByTestId('review-filter'), { target: { value: 'keywords' } });
    await waitFor(() => expect(screen.getByTestId('review-empty')).toBeTruthy());
    expect(callsTo('review:list').at(-1)).toMatchObject({ fields: ['keywords'], offset: 0 });
  });
});
