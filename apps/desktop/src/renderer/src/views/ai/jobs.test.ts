// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, type LibraryProfile } from '@rl/core';
import i18n from '../../i18n';
import { AiUiProvider, useAiUi } from '../../lib/aiUi';
import { JobsProvider } from '../../lib/jobs';
import { JobIndicator } from '../../shell/ActivityRows';
import { NotifyProvider } from '../../lib/notify';
import { AppProvider } from '../../state/app-context';
import { memoryAi } from '../../testing/memoryAi';
import { memoryWork } from '../../testing/memoryWork';
import { callsTo, emitEvent, memoryBackend, setHandlers } from '../../testing/mockRl';
import { JobDialog } from './JobDialog';

vi.mock('../../lib/rl', async () => (await import('../../testing/mockRl')).rlModule);

const profile: LibraryProfile = { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' };
const D1 = '1111111111111111';
const D2 = '2222222222222222';
const DOCS = [
  { docId: D1, path: 'alpha/one.pdf' },
  { docId: D2, path: 'beta/two.pdf' },
];

function Probe() {
  const ui = useAiUi();
  return createElement('div', { 'data-testid': 'probe' }, ui.navigation?.to ?? '');
}

function setup(o: { ids?: string[]; tweak?(ai: ReturnType<typeof memoryAi>, work: ReturnType<typeof memoryWork>): void; dialog?: boolean; folders?: string[]; onClose?(): void } = {}) {
  const ai = memoryAi({ docs: DOCS, config: { aiEnabledFolders: o.folders ?? ['alpha'] } });
  const work = memoryWork(ai);
  o.tweak?.(ai, work);
  const { handlers } = memoryBackend({ profiles: [profile] });
  setHandlers({ ...handlers, ...ai.handlers, ...work.handlers, 'documents:get': (p: any) => ({ id: p.docId, title: 'Paper' }) });
  const kids: any[] = [createElement(JobIndicator, { key: 'i' }), createElement(Probe, { key: 'p' })];
  if (o.dialog !== false) kids.push(createElement(JobDialog, { key: 'd', docIds: o.ids ?? [D1, D2], onClose: o.onClose ?? (() => {}) }));
  render(createElement(AppProvider, null, createElement(NotifyProvider, null, createElement(AiUiProvider, null, createElement(JobsProvider, null, ...kids)))));
  return { ai, work };
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => cleanup());

describe('bulk AI job: no enabled folder (D-339)', () => {
  it('does not open: it closes at once with a notice that leads to the settings', async () => {
    const onClose = vi.fn();
    setup({ folders: [], onClose });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('job-dialog')).toBeNull();
  });
});

describe('bulk AI job: dialog layout (4.15)', () => {
  it('keeps the buttons in the fixed footer, outside the scrolling body', async () => {
    setup();
    const confirm = await screen.findByTestId('job-confirm');
    expect(confirm.closest('.dlg-foot')).not.toBeNull();
    expect(screen.getByTestId('job-dialog').querySelector('.dlg-scroll')!.contains(confirm)).toBe(false);
  });
});

describe('bulk AI job: unavailable AI', () => {
  it.each(['offline', 'no-access'] as const)('says why at once (%s) and does not allow starting', async (reason) => {
    const { work } = setup({ tweak: (ai) => ((ai.state.available = false), (ai.state.reason = reason)) });
    expect((await screen.findByTestId('job-unavailable')).getAttribute('data-reason')).toBe(reason);
    await waitFor(() => expect(screen.getByTestId('job-to-send')).toBeTruthy());
    expect((screen.getByTestId('job-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect(work.state.started).toHaveLength(0);
  });
});

describe('bulk AI job: estimate, confirm, progress', () => {
  it('estimates what goes (allowed, refused, tokens, cost) before anything starts', async () => {
    const { work } = setup();
    await waitFor(() => expect(screen.getByTestId('job-to-send').textContent).toBe('1 document will be sent'));
    expect(screen.getByTestId('job-refused').textContent).toContain('its folder is not enabled');
    expect(screen.getByTestId('job-folders').textContent).toContain('alpha');
    expect(screen.getByTestId('job-size').textContent).toContain('1.0k');
    expect(work.state.started).toHaveLength(0);
    // defaults of the library config
    expect(work.state.estimates[0]).toMatchObject({ kind: 'suggest', docIds: [D1, D2], fields: ['tags', 'description'], regenerate: false });
    expect((screen.getByTestId('job-model') as HTMLSelectElement).value).toBe('claude-haiku-5-5');
  });

  it('asks for a new estimate when the fields, model or "propose again" change, and shows skipped documents', async () => {
    const { work } = setup({
      tweak: (_ai, w) => {
        w.state.skipped = 1;
      },
    });
    await waitFor(() => expect(screen.getByTestId('job-skipped').textContent).toContain('1 document skipped'));
    expect(screen.getByTestId('job-nothing')).toBeTruthy();
    expect((screen.getByTestId('job-confirm') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('job-regenerate'));
    fireEvent.click(screen.getByTestId('job-field-summary'));
    await waitFor(() => expect(work.state.estimates.at(-1)).toMatchObject({ regenerate: true, fields: ['tags', 'description', 'summary'] }));
  });

  it('warns when the job would go over the cap and does not allow it', async () => {
    setup({ tweak: (ai) => void (ai.state.overCap = true) });
    expect(await screen.findByTestId('job-over-cap')).toBeTruthy();
    expect((screen.getByTestId('job-confirm') as HTMLButtonElement).disabled).toBe(true);
  });

  it('starts with confirmed: true and the indicator follows the progress, then offers the review', async () => {
    const { work } = setup();
    await waitFor(() => expect((screen.getByTestId('job-confirm') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('job-confirm'));
    await waitFor(() => expect(work.state.started).toHaveLength(1));
    expect(work.state.started[0]).toMatchObject({ confirmed: true, docIds: [D1, D2], fields: ['tags', 'description'] });
    const ind = await screen.findByTestId('job-indicator');
    expect(screen.getByTestId('job-text').textContent).toBe('AI proposals: 0/2 · $0.00');

    act(() => work.progress({ done: 1, usd: 0.004 }));
    expect(screen.getByTestId('job-text').textContent).toBe('AI proposals: 1/2 · <$0.01');

    fireEvent.click(screen.getByTestId('job-cancel'));
    await waitFor(() => expect(work.state.cancelled).toEqual(['job-1']));

    act(() => work.progress({ state: 'done', done: 2 }));
    expect(ind.getAttribute('data-state')).toBe('done');
    expect(screen.queryByTestId('job-cancel')).toBeNull();
    fireEvent.click(screen.getByTestId('job-review'));
    expect(screen.getByTestId('probe').textContent).toBe('review');
    fireEvent.click(screen.getByTestId('job-dismiss'));
    expect(screen.queryByTestId('job-indicator')).toBeNull();
  });

  it('shows the refusals of the start (no access, cap) in the dialog', async () => {
    setup({ tweak: (_ai, w) => void (w.state.startError = new AppError('AI_PROVIDER_ERROR', 'x', { reason: 'no-access' })) });
    await waitFor(() => expect((screen.getByTestId('job-confirm') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('job-confirm'));
    expect((await screen.findByTestId('job-error-note')).textContent).toContain('No access to Claude');
  });

  it('shows a job that was already running when the window opened, and a failed one with its reason', async () => {
    setup({
      dialog: false,
      tweak: (_ai, w) => {
        w.state.jobs = [{ jobId: 'job-9', kind: 'suggest', fields: ['tags'], model: 'm', state: 'failed', total: 3, done: 1, failed: 1, skipped: 0, usd: 0.5, createdAt: '2026-11-17T10:00:00.000Z', error: { code: 'AI_BUDGET_EXCEEDED', message: 'cap' } }];
      },
    });
    expect((await screen.findByTestId('job-text')).textContent).toBe('AI proposals failed: 1/3 done, 1 failed');
    expect(screen.getByTestId('job-error').textContent).toContain('usage cap');
    expect(callsTo('jobs:list')).toHaveLength(1);
    act(() => emitEvent('jobs:progress', { jobId: 'job-10', kind: 'suggest', fields: ['tags'], model: 'm', state: 'running', total: 2, done: 0, failed: 0, skipped: 0, usd: 0, createdAt: '2026-11-17T11:00:00.000Z' }));
    await waitFor(() => expect(screen.getByTestId('job-indicator').getAttribute('data-state')).toBe('running'));
  });
});
