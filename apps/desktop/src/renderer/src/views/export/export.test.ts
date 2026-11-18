// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, defaultLibraryConfig, type LibraryProfile } from '@rl/core';
import i18n from '../../i18n';
import { AiUiProvider, useAiUi, type ExportInit } from '../../lib/aiUi';
import { AppProvider } from '../../state/app-context';
import { callsTo, emitEvent, memoryBackend, setHandlers } from '../../testing/mockRl';
import { Palette } from '../chat/Palette';
import { ExportDialog } from './ExportDialog';
import { folderNameValid, fromSelection, loadPast, rememberExport, sanitizeFolderName, toSelection, emptyDraft } from './exportModel';

vi.mock('../../lib/rl', async () => (await import('../../testing/mockRl')).rlModule);

const profile: LibraryProfile = { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' };
const DEST = { path: '/tmp/out', name: 'out' };

const estimate = (over: Record<string, unknown> = {}, target: Record<string, unknown> | null = null) => ({
  documents: 12,
  citedAdded: 3,
  files: 40,
  approxTokens: 5000,
  indexTokens: 900,
  copyBytes: 0,
  aiDisabledDocuments: 0,
  missingFiles: 0,
  target: target ? { previousExportAt: null, editedFiles: 0, ...target } : null,
  ...over,
});

interface Opts {
  init?: ExportInit;
  /** What `export:preview` answers when a target is given. */
  target?: Record<string, unknown>;
  preview?: Record<string, unknown>;
  run?: (p: any) => unknown;
  presets?: unknown[];
  past?: boolean;
  /** `export:preview` fails with this (code) when it has a target (`withTarget`) or always. */
  previewError?: { code: any; withTarget?: boolean; details?: Record<string, unknown> };
}

function setup(o: Opts = {}) {
  const { handlers } = memoryBackend({ profiles: [profile] });
  const config = { ...defaultLibraryConfig({ name: 'Alpha', language: 'en' }), exportPresets: o.presets ?? [] };
  setHandlers({
    ...handlers,
    'library:getConfig': () => config,
    'projects:list': () => ({ items: [{ id: 'p1', name: 'Thesis' }] }),
    'taxonomy:get': () => ({ nodes: [{ id: 't1', label: 'Optics', status: 'active' }] }),
    'dialog:chooseFolder': () => DEST,
    'export:preview': (p: any) => {
      if (o.previewError && (!o.previewError.withTarget || p.target)) throw new AppError(o.previewError.code, 'x', o.previewError.details);
      return estimate(o.preview, p.target ? o.target ?? { state: 'new' } : null);
    },
    'export:run': o.run ?? (() => ({ jobId: 'job-1' })),
    'export:status': () => ({ jobId: 'job-1', state: 'running', phase: 'collect', done: 0, total: 0, result: null, error: null }),
    'export:cancel': () => ({ cancelled: true }),
    'export:reveal': () => ({ ok: true }),
  });
  if (o.past) rememberExport('lib-a', { folderName: 'old-brain', destination: DEST.path, at: '2026-11-01T10:00:00.000Z', selection: { ...toSelection(emptyDraft()), projectId: 'p1', sources: 'copies' } });
  const onClose = vi.fn();
  render(createElement(AppProvider, null, createElement(AiUiProvider, null, createElement(ExportDialog, { init: o.init ?? { projectId: 'p1', name: 'Thesis' }, onClose }))));
  return { onClose };
}

const done = (over: Record<string, unknown> = {}) => ({
  jobId: 'job-1',
  state: 'done',
  phase: 'done',
  done: 10,
  total: 10,
  error: null,
  result: { dir: '/tmp/out/thesis', written: 8, updated: 1, unchanged: 5, keptEdited: ['papers/a.md'], copyErrors: [], orphaned: 2, copiedBytes: 0 },
  ...over,
});

async function chooseDestination() {
  fireEvent.click(await screen.findByTestId('export-choose'));
  await screen.findByTestId('export-dest-path');
}
const runButton = () => screen.getByTestId('export-run') as HTMLButtonElement;

beforeEach(async () => {
  await i18n.changeLanguage('en');
  try {
    window.localStorage.clear();
  } catch {
    // no storage
  }
});
afterEach(() => cleanup());

describe('export model', () => {
  it('sanitizes folder names and applies the contract rules', () => {
    expect(sanitizeFolderName('My: thesis / v2?')).toBe('My- thesis - v2');
    expect(sanitizeFolderName('name. ')).toBe('name');
    expect(sanitizeFolderName('con')).toBe('con-export');
    expect(sanitizeFolderName('x'.repeat(300))).toHaveLength(120);
    for (const bad of ['', ' ', '.', '..', 'a/b', 'a:b', 'trail.', 'nul', 'COM1.txt']) expect(folderNameValid(bad), bad).toBe(false);
    for (const good of ['second-brain', 'Tesi 2026', 'a.b']) expect(folderNameValid(good), good).toBe(true);
  });

  it('round-trips a selection and remembers the last five exports per folder', () => {
    const d = { ...emptyDraft(), projectId: 'p1', clusters: [{ id: 'c1', label: 'Optics' }], sources: 'none' as const };
    expect(fromSelection(toSelection(d))).toMatchObject({ projectId: 'p1', sources: 'none', clusters: [{ id: 'c1', label: 'c1' }] });
    for (let i = 0; i < 7; i++) rememberExport('lib-a', { folderName: `f${i}`, destination: '/d', at: '2026-01-01T00:00:00.000Z', selection: toSelection(d) });
    rememberExport('lib-a', { folderName: 'f6', destination: '/d', at: '2026-02-01T00:00:00.000Z', selection: toSelection(d) });
    const past = loadPast('lib-a');
    expect(past).toHaveLength(5);
    expect(past.map((p) => p.folderName)).toEqual(['f6', 'f5', 'f4', 'f3', 'f2']);
    expect(loadPast('other')).toEqual([]);
  });
});

describe('ExportDialog', () => {
  it('starts from the entry point, estimates before running and needs a destination from the folder dialog', async () => {
    setup();
    const est = await screen.findByTestId('est-documents');
    expect(est.textContent).toBe('12');
    expect((screen.getByTestId('export-project') as HTMLSelectElement).value).toBe('p1');
    expect(callsTo('export:preview')[0]).toMatchObject({ selection: { projectId: 'p1', sources: 'none', includeNotes: true } });
    expect(callsTo('export:preview')[0].target).toBeUndefined();
    expect(runButton().disabled).toBe(true);
    expect((screen.getByTestId('export-folder-name') as HTMLInputElement).value).toBe('Thesis');

    await chooseDestination();
    expect(callsTo('dialog:chooseFolder')[0]).toMatchObject({ purpose: 'export-destination' });
    await waitFor(() => expect(screen.getByTestId('export-target-note').getAttribute('data-state')).toBe('new'));
    expect(callsTo('export:preview').at(-1).target).toEqual({ destination: '/tmp/out', folderName: 'Thesis' });
    expect(runButton().disabled).toBe(false);
  });

  it('asks for something to export when the selection is empty', async () => {
    setup({ init: {} });
    expect(await screen.findByTestId('export-empty')).toBeTruthy();
    expect(callsTo('export:preview')).toHaveLength(0);
    await chooseDestination();
    expect(runButton().disabled).toBe(true);
    fireEvent.change(screen.getByTestId('export-project'), { target: { value: 'p1' } });
    await waitFor(() => expect(runButton().disabled).toBe(false));
  });

  it('shows the selection as removable chips and sends the union of documents, clusters and the rest', async () => {
    setup({ init: { docIds: ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'], clusters: [{ id: 'c1', label: 'Optics cluster' }] } });
    expect(await screen.findByTestId('export-docs')).toBeTruthy();
    expect(screen.getByTestId('export-clusters').textContent).toContain('Optics cluster');
    await waitFor(() => expect(callsTo('export:preview')[0]).toMatchObject({ selection: { docIds: ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'], clusterIds: ['c1'] } }));
    fireEvent.click(within(screen.getByTestId('export-clusters')).getByRole('button'));
    await waitFor(() => expect(callsTo('export:preview').at(-1).selection.clusterIds).toEqual([]));
  });

  it('applies the options of a preset', async () => {
    setup({ presets: [{ id: 'pr1', name: 'Lean', includeCited: true, citedDepth: 2, sources: 'none', includeNotes: false, includeAnnotations: false }] });
    const select = await screen.findByTestId('export-preset');
    fireEvent.change(select, { target: { value: 'pr1' } });
    await waitFor(() => expect(callsTo('export:preview').at(-1).selection).toMatchObject({ includeCited: true, citedDepth: 2, sources: 'none', includeNotes: false, includeAnnotations: false }));
    expect((screen.getByTestId('export-depth') as HTMLSelectElement).value).toBe('2');
  });

  it('refuses an invalid folder name and fixes it on leaving the field', async () => {
    setup();
    await chooseDestination();
    const field = screen.getByTestId('export-folder-name') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'a/b?' } });
    expect(await screen.findByText('This is not a valid folder name.')).toBeTruthy();
    expect(runButton().disabled).toBe(true);
    fireEvent.blur(field);
    await waitFor(() => expect(field.value).toBe('a-b'));
    await waitFor(() => expect(runButton().disabled).toBe(false));
  });

  it('explains a folder that is not empty or belongs to another library and does not run', async () => {
    setup({ target: { state: 'not-empty' } });
    await chooseDestination();
    const note = await screen.findByTestId('export-target-note');
    await waitFor(() => expect(note.getAttribute('data-state')).toBe('not-empty'));
    expect(note.textContent).toContain('not an export of this library');
    expect(runButton().disabled).toBe(true);
    cleanup();

    setup({ target: { state: 'other-library' } });
    await chooseDestination();
    await waitFor(() => expect(screen.getByTestId('export-target-note').textContent).toContain('export of another library'));
    expect(runButton().disabled).toBe(true);
  });

  it('shows a run-time conflict (the folder changed after the estimate)', async () => {
    setup({
      run: () => {
        throw new AppError('CONFLICT', 'x', { reason: 'not-empty' });
      },
    });
    await chooseDestination();
    await waitFor(() => expect(runButton().disabled).toBe(false));
    fireEvent.click(runButton());
    const c = await screen.findByTestId('export-conflict');
    expect(c.getAttribute('data-reason')).toBe('not-empty');
    expect(c.textContent).toContain('nothing was written');
    expect(runButton().disabled).toBe(true);
  });

  it('announces an update in place for an earlier export, with the edited sections kept', async () => {
    setup({ target: { state: 'previous-export', previousExportAt: '2026-11-01T10:00:00.000Z', editedFiles: 2 } });
    await chooseDestination();
    await waitFor(() => expect(screen.getByTestId('export-target-note').getAttribute('data-state')).toBe('previous-export'));
    expect(screen.getByTestId('export-target-note').textContent).toContain('updated in place');
    expect(screen.getByTestId('export-target-note').textContent).toContain('2 files have a generated section you edited by hand');
    expect(runButton().textContent).toBe('Update the export');
  });

  it('asks for explicit confirmation when documents are in folders not enabled for AI, then runs with confirmed', async () => {
    let first = true;
    setup({
      preview: { aiDisabledDocuments: 4 },
      run: (p: any) => {
        if (!p.confirmed && first) {
          first = false;
          throw new AppError('CONFLICT', 'x', { reason: 'needs-confirmation', documents: 4 });
        }
        return { jobId: 'job-1' };
      },
    });
    await chooseDestination();
    expect((await screen.findByTestId('export-ai-warning')).textContent).toContain('4 selected documents are in folders not enabled for AI');
    await waitFor(() => expect(runButton().disabled).toBe(false));
    fireEvent.click(runButton());
    const confirm = await screen.findByTestId('export-confirm');
    expect(confirm.textContent).toContain('anyone who opens the export folder with an agent');
    expect(callsTo('export:run')).toHaveLength(1);
    expect(callsTo('export:run')[0].confirmed).toBe(false);
    fireEvent.click(screen.getByTestId('export-confirm-yes'));
    await screen.findByTestId('export-progress-panel');
    expect(callsTo('export:run')[1].confirmed).toBe(true);
  });

  it('can be declined at the confirmation: nothing runs', async () => {
    setup({
      preview: { aiDisabledDocuments: 1 },
      run: () => {
        throw new AppError('CONFLICT', 'x', { reason: 'needs-confirmation', documents: 1 });
      },
    });
    await chooseDestination();
    await waitFor(() => expect(runButton().disabled).toBe(false));
    fireEvent.click(runButton());
    fireEvent.click(await screen.findByTestId('export-confirm-no'));
    expect(screen.queryByTestId('export-confirm')).toBeNull();
    expect(callsTo('export:run')).toHaveLength(1);
  });

  it('shows progress, can cancel, and summarises the result (written, unchanged, kept edited, orphaned)', async () => {
    setup();
    await chooseDestination();
    await waitFor(() => expect(runButton().disabled).toBe(false));
    fireEvent.click(runButton());
    await screen.findByTestId('export-progress-panel');
    act(() => emitEvent('export:progress', { jobId: 'job-1', state: 'running', phase: 'write', done: 3, total: 10, result: null, error: null }));
    expect(screen.getByTestId('export-progress-count').textContent).toBe('3 / 10');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('3');
    // Events of another job are ignored.
    act(() => emitEvent('export:progress', { jobId: 'other', state: 'done', phase: 'done', done: 1, total: 1, result: null, error: null }));
    expect(screen.queryByTestId('export-result')).toBeNull();

    fireEvent.click(screen.getByTestId('export-cancel'));
    await waitFor(() => expect(callsTo('export:cancel')).toEqual([{ jobId: 'job-1' }]));

    act(() => emitEvent('export:progress', done()));
    const result = await screen.findByTestId('export-result');
    expect(result.getAttribute('data-state')).toBe('done');
    expect(screen.getByTestId('res-written').textContent).toBe('8');
    expect(screen.getByTestId('res-updated').textContent).toBe('1');
    expect(screen.getByTestId('res-unchanged').textContent).toBe('5');
    expect(screen.getByTestId('res-kept').textContent).toBe('1');
    expect(screen.getByTestId('res-orphaned').textContent).toBe('2');
    expect(screen.getByTestId('res-kept-list').textContent).toContain('papers/a.md');
    fireEvent.click(screen.getByTestId('export-reveal'));
    await waitFor(() => expect(callsTo('export:reveal')).toEqual([{ jobId: 'job-1' }]));
  });

  it('says so when the export was cancelled or failed', async () => {
    setup();
    await chooseDestination();
    await waitFor(() => expect(runButton().disabled).toBe(false));
    fireEvent.click(runButton());
    await screen.findByTestId('export-progress-panel');
    act(() => emitEvent('export:progress', done({ state: 'cancelled' })));
    expect((await screen.findByTestId('export-result')).textContent).toContain('files already written stay');
    cleanup();

    setup();
    await chooseDestination();
    await waitFor(() => expect(runButton().disabled).toBe(false));
    fireEvent.click(runButton());
    await screen.findByTestId('export-progress-panel');
    act(() => emitEvent('export:progress', done({ state: 'failed', result: null, error: { code: 'IO_ERROR', message: 'disk full' } })));
    expect((await screen.findByTestId('export-failed')).textContent).toContain('disk full');
  });

  it('remembers a finished export and offers it for an update in place next time', async () => {
    setup();
    await chooseDestination();
    await waitFor(() => expect(runButton().disabled).toBe(false));
    fireEvent.click(runButton());
    await screen.findByTestId('export-progress-panel');
    act(() => emitEvent('export:progress', done()));
    await screen.findByTestId('export-result');
    expect(loadPast('lib-a')).toHaveLength(1);
    cleanup();

    setup({ init: {}, target: { state: 'previous-export', previousExportAt: '2026-11-01T10:00:00.000Z' } });
    const item = await screen.findByTestId('export-past-item');
    expect(item.textContent).toContain('Thesis');
    fireEvent.click(item);
    expect((screen.getByTestId('export-project') as HTMLSelectElement).value).toBe('p1');
    expect((screen.getByTestId('export-folder-name') as HTMLInputElement).value).toBe('Thesis');
    expect((await screen.findByTestId('export-dest-path')).textContent).toBe('/tmp/out');
    await waitFor(() => expect(screen.getByTestId('export-target-note').getAttribute('data-state')).toBe('previous-export'));
    expect(runButton().disabled).toBe(false);
  });

  it('asks for the folder again when the approval of the earlier destination is gone', async () => {
    setup({ past: true, previewError: { code: 'INVALID_REQUEST', withTarget: true, details: { reason: 'destination-not-approved' } } });
    fireEvent.click(await screen.findByTestId('export-past-item'));
    expect((screen.getByTestId('export-folder-name') as HTMLInputElement).value).toBe('old-brain');
    expect((screen.getByTestId('export-sources') as HTMLSelectElement).value).toBe('copies');
    expect(await screen.findByTestId('export-pick-again')).toBeTruthy();
    expect(screen.queryByTestId('export-dest-path')).toBeNull();
    expect(runButton().disabled).toBe(true);
  });

  it('does not loop on another invalid request: the destination stays and the real reason shows', async () => {
    setup({ previewError: { code: 'INVALID_REQUEST', withTarget: true, details: { reason: 'too-many' } } });
    await chooseDestination();
    expect((await screen.findByTestId('export-estimate-error')).textContent).toContain('too many documents');
    expect(screen.queryByTestId('export-pick-again')).toBeNull();
    expect(screen.getByTestId('export-dest-path')).toBeTruthy();
  });

  it('refuses a destination inside the library with a clear message and does not run', async () => {
    setup({ previewError: { code: 'CONFLICT', withTarget: true, details: { reason: 'inside-library' } } });
    await chooseDestination();
    const note = await screen.findByTestId('export-conflict');
    expect(note.getAttribute('data-reason')).toBe('inside-library');
    expect(note.textContent).toContain('inside the library folder');
    await waitFor(() => expect(runButton().disabled).toBe(true));
  });

  it('asks to confirm a large copy with its size, and runs with confirmed', async () => {
    setup({
      preview: { copyBytes: 3 * 1024 ** 3 },
      run: (p: any) => {
        if (!p.confirmed) throw new AppError('CONFLICT', 'x', { reason: 'large-copy', documents: 0, copyBytes: 3 * 1024 ** 3 });
        return { jobId: 'job-1' };
      },
    });
    await chooseDestination();
    await waitFor(() => expect(runButton().disabled).toBe(false));
    fireEvent.click(runButton());
    const confirm = await screen.findByTestId('export-confirm');
    expect(screen.getByTestId('export-confirm-copy').textContent).toContain('3');
    expect(confirm.textContent).not.toContain('not enabled for AI');
    fireEvent.click(screen.getByTestId('export-confirm-yes'));
    await screen.findByTestId('export-progress-panel');
    expect(callsTo('export:run')[1].confirmed).toBe(true);
  });

  it('sources are not included by default, and the paths option says what it writes', async () => {
    setup();
    const sources = (await screen.findByTestId('export-sources')) as HTMLSelectElement;
    expect(sources.value).toBe('none');
    fireEvent.change(sources, { target: { value: 'paths' } });
    expect(document.body.textContent).toContain('full paths of the original files');
  });

  it('lists the copies that failed', async () => {
    setup();
    await chooseDestination();
    await waitFor(() => expect(runButton().disabled).toBe(false));
    fireEvent.click(runButton());
    await screen.findByTestId('export-progress-panel');
    act(() => emitEvent('export:progress', done({ result: { dir: '/tmp/out/thesis', written: 1, updated: 0, unchanged: 0, keptEdited: [], copyErrors: ['sources/a.pdf'], orphaned: 0, copiedBytes: 0 } })));
    expect((await screen.findByTestId('res-copy-errors')).textContent).toBe('1');
    expect(screen.getByTestId('res-copy-errors-list').textContent).toContain('sources/a.pdf');
  });

  it('explains clusters that cannot be exported while the network model is missing', async () => {
    setup({ init: { clusters: [{ id: 'c1', label: 'x' }] }, previewError: { code: 'NOT_FOUND' } });
    expect((await screen.findByTestId('export-estimate-error')).textContent).toContain('network model is not built yet');
  });

  it('closing while it runs cancels the export', async () => {
    const { onClose } = setup();
    await chooseDestination();
    await waitFor(() => expect(runButton().disabled).toBe(false));
    fireEvent.click(runButton());
    await screen.findByTestId('export-progress-panel');
    fireEvent.keyDown(screen.getByTestId('export-dialog'), { key: 'Escape' });
    await waitFor(() => expect(callsTo('export:cancel')).toHaveLength(1));
    expect(onClose).toHaveBeenCalled();
  });

  it('has an accessible dialog with labelled controls and no raw HTML', async () => {
    setup();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByLabelText('Folder name')).toBeTruthy();
    expect(within(dialog).getByLabelText('Source files')).toBeTruthy();
    expect(dialog.querySelector('[dangerouslySetInnerHTML]')).toBeNull();
  });
});

const SELECTED = ['aaaaaaaaaaaaaaaa'];
describe('command palette entry', () => {
  function Probe() {
    const { exportInit } = useAiUi();
    return createElement('div', { 'data-testid': 'probe' }, exportInit ? JSON.stringify(exportInit) : 'closed');
  }
  function Selected({ ids }: { ids: string[] }) {
    const { publishSelection } = useAiUi();
    useEffect(() => publishSelection(ids), [ids, publishSelection]);
    return null;
  }

  it('opens the export dialog from the palette, starting from the library selection', async () => {
    const { handlers } = memoryBackend({ profiles: [profile] });
    setHandlers({ ...handlers, 'commands:list': () => ({ items: [] }) });
    const onClose = vi.fn();
    render(createElement(AppProvider, null, createElement(AiUiProvider, null, createElement(Selected, { ids: SELECTED }), createElement(Probe), createElement(Palette, { onClose }))));
    // The commands for Claude (and this one) show once there is some text.
    fireEvent.change(await screen.findByTestId('palette-input'), { target: { value: 'second brain' } });
    const items = await screen.findAllByTestId('palette-item');
    const entry = items.find((i) => i.getAttribute('data-command') === 'exportDialog')!;
    expect(entry.textContent).toBe('Export as a second brain…');
    fireEvent.click(entry);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe(JSON.stringify({ docIds: ['aaaaaaaaaaaaaaaa'] })));
    expect(onClose).toHaveBeenCalled();
  });
});
