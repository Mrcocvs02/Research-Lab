// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@rl/core';
import i18n from '../i18n';
import { AppProvider } from '../state/app-context';
import { callsTo, emitEvent, memoryBackend, setHandlers } from '../testing/mockRl';
import { Wizard } from './Wizard';

vi.mock('../lib/rl', async () => (await import('../testing/mockRl')).rlModule);

// A generic, made-up location: the mocked dialog returns it, nothing touches the disk.
const ROOT = { path: '/tmp/example-root', name: 'example-root' };
const NO_LEGACY = { found: false, documents: 0, taxonomyNodes: 0 };

const mount = (onFinished = vi.fn()) => {
  render(createElement(AppProvider, null, createElement(Wizard, { onFinished })));
  return onFinished;
};
const next = () => fireEvent.click(screen.getByTestId('wizard-next'));
const stepTitle = () => screen.getByTestId('wizard-step-title').textContent;
const isDisabled = (testId: string) => (screen.getByTestId(testId) as HTMLButtonElement).disabled;

async function untilStep(title: string) {
  await waitFor(() => expect(stepTitle()).toBe(title));
}

/** Advances through the given steps, waiting for each title. */
async function advanceThrough(titles: string[]) {
  for (const title of titles) {
    next();
    await untilStep(title);
  }
}

async function chooseFolder() {
  fireEvent.click(screen.getByTestId('wizard-choose-folder'));
  await screen.findByTestId('wizard-folder-chosen');
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  cleanup();
});

const SCAN_START = () => ({ libraryId: 'lib-test', state: 'running', phase: 'walking', seen: 0, processed: 0, indexed: 0 });

describe('Wizard', () => {
  it('walks the seven steps, enables no folder for Claude, keeps the PDF consent on, and ends in the first scan', async () => {
    const { handlers } = memoryBackend();
    setHandlers({ ...handlers, 'dialog:chooseFolder': () => ROOT, 'import:probeLegacy': () => NO_LEGACY, 'scan:start': SCAN_START });
    const onFinished = mount();
    await untilStep('Welcome and language');
    expect(screen.getByTestId('wizard-progress').textContent).toBe('Step 1 of 7');

    fireEvent.change(screen.getByTestId('wizard-ui-language'), { target: { value: 'it' } });
    await waitFor(() => expect(callsTo('settings:set')).toContainEqual({ uiLanguage: 'it' }));
    await untilStep('Benvenuto e lingua');
    fireEvent.change(screen.getByTestId('wizard-ui-language'), { target: { value: 'en' } });
    await untilStep('Welcome and language');
    next();

    await untilStep('Folder');
    expect(isDisabled('wizard-next')).toBe(true);
    await chooseFolder();
    expect((screen.getByTestId('wizard-data-dir') as HTMLInputElement).value).toBe('.lab');
    next();

    await untilStep('Details');
    expect((screen.getByTestId('wizard-lib-name') as HTMLInputElement).value).toBe('example-root');
    fireEvent.change(screen.getByTestId('wizard-doc-language'), { target: { value: 'it' } });
    fireEvent.change(screen.getByTestId('wizard-profile-name'), { target: { value: 'Jane Doe' } });
    next();

    await untilStep('Starting tags');
    expect((screen.getByLabelText(/Proposed by Claude/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Available after connecting Claude.')).toBeTruthy();
    expect(screen.getByTestId('wizard-skip')).toBeTruthy();
    next();

    // Claude: nothing is mandatory, nothing is sent until a folder is enabled.
    await untilStep('Claude');
    expect(screen.getByText(/Until you enable a folder, nothing is sent/)).toBeTruthy();
    expect(screen.getByTestId('wizard-ai-note').textContent).toContain('No folder enabled');
    expect(isDisabled('wizard-next')).toBe(false);
    next();

    await untilStep('Summary');
    expect(screen.getByTestId('wizard-write-to-pdf').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('wizard-create-note').textContent).toContain('inside the PDFs');
    fireEvent.click(screen.getByTestId('wizard-create'));

    // The seventh step: the first scan, seen and not waited for.
    await screen.findByTestId('wizard-scan');
    await waitFor(() => expect(callsTo('scan:start')).toEqual([{}]));
    expect(screen.getByTestId('wizard-step-title').textContent).toBe('First scan');
    expect(isDisabled('wizard-scan-open')).toBe(true);
    act(() => emitEvent('scan:progress', { libraryId: 'lib-test', state: 'running', phase: 'extracting', seen: 12, processed: 4, total: 10, indexed: 0 }));
    await waitFor(() => expect(screen.getByTestId('wizard-scan').querySelector('[data-phase="extracting"]')?.getAttribute('data-state')).toBe('now'));
    act(() => emitEvent('scan:progress', { libraryId: 'lib-test', state: 'done', seen: 12, processed: 10, total: 10, indexed: 12, summary: { added: 12, changed: 0, moved: 0, missing: 0, unchanged: 0, extracted: 9, failed: 3 } }));
    expect((await screen.findByTestId('wizard-scan-result')).textContent).toContain('Found 12 documents · 3 unreadable');
    expect(isDisabled('wizard-scan-open')).toBe(false);
    fireEvent.click(screen.getByTestId('wizard-scan-open'));
    expect(onFinished).toHaveBeenCalledWith('lib-test');

    expect(callsTo('settings:set')).toContainEqual({
      uiLanguage: 'en',
      user: expect.objectContaining({ name: 'Jane Doe', authorVariants: [] }),
    });
    expect(callsTo('library:create')).toEqual([{ name: 'example-root', rootPath: ROOT.path, language: 'it', dataDirName: '.lab', aiEnabledFolders: [], writeToPdf: true }]);
    expect(callsTo('library:setActive')).toEqual([{ libraryId: 'lib-test' }]);
    expect(callsTo('settings:set')).toContainEqual({ firstRunDone: true });
    expect(callsTo('import:startLegacy')).toEqual([]);
  });

  it('can be left running: Continue in the background opens the library at once', async () => {
    const { handlers } = memoryBackend({ settings: { firstRunDone: true } });
    setHandlers({ ...handlers, 'dialog:chooseFolder': () => ROOT, 'import:probeLegacy': () => NO_LEGACY, 'scan:start': SCAN_START });
    const onFinished = mount();
    await untilStep('Folder');
    await chooseFolder();
    await advanceThrough(['Details', 'Starting tags', 'Claude', 'Summary']);
    expect(screen.getByTestId('wizard-progress').textContent).toBe('Step 5 of 6');
    fireEvent.click(screen.getByTestId('wizard-create'));
    fireEvent.click(await screen.findByTestId('wizard-scan-background'));
    expect(onFinished).toHaveBeenCalledWith('lib-test');
  });

  it('skips the starting tags with Skip, and turns the PDF consent off from the summary', async () => {
    const { handlers } = memoryBackend({ settings: { firstRunDone: true } });
    setHandlers({ ...handlers, 'dialog:chooseFolder': () => ROOT, 'import:probeLegacy': () => NO_LEGACY, 'scan:start': SCAN_START });
    mount();
    await untilStep('Folder');
    await chooseFolder();
    await advanceThrough(['Details', 'Starting tags']);
    fireEvent.click(screen.getByTestId('wizard-skip'));
    await untilStep('Claude');
    await advanceThrough(['Summary']);
    fireEvent.click(screen.getByTestId('wizard-write-to-pdf'));
    expect(screen.getByTestId('wizard-write-to-pdf').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('wizard-create-note').textContent).toContain('app only');
  });

  it('skips the user steps when first run is done and rejects bad data folder names', async () => {
    const { handlers } = memoryBackend({ settings: { firstRunDone: true } });
    setHandlers({ ...handlers, 'dialog:chooseFolder': () => ROOT, 'import:probeLegacy': () => NO_LEGACY });
    mount();
    await untilStep('Folder');
    await chooseFolder();
    fireEvent.change(screen.getByTestId('wizard-data-dir'), { target: { value: '../escape' } });
    expect(screen.getByText(/plain folder name/)).toBeTruthy();
    expect(isDisabled('wizard-next')).toBe(true);
  });

  it('offers the legacy import with counts and follows progress events', async () => {
    const { handlers } = memoryBackend({ settings: { firstRunDone: true } });
    setHandlers({
      ...handlers,
      'dialog:chooseFolder': () => ROOT,
      'import:probeLegacy': () => ({ found: true, documents: 21, taxonomyNodes: 7 }),
      'import:startLegacy': () => ({ jobId: 'job-1' }),
    });
    const onFinished = mount();
    await untilStep('Folder');
    await chooseFolder();
    await advanceThrough(['Details', 'Existing index found']);
    expect(screen.getByTestId('legacy-preview').textContent).toContain('21 documents');
    expect(screen.getByTestId('legacy-preview').textContent).toContain('7 taxonomy entries');
    await advanceThrough(['Starting tags', 'Claude', 'Summary']);
    fireEvent.click(screen.getByTestId('wizard-create'));

    await screen.findByTestId('import-progress');
    expect(callsTo('import:startLegacy')).toEqual([{ libraryId: 'lib-test', sourcePath: ROOT.path }]);
    act(() => emitEvent('import:progress', { jobId: 'job-1', state: 'running', processed: 5, total: 20 }));
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('5');
    expect(bar.getAttribute('aria-valuemax')).toBe('20');
    act(() =>
      emitEvent('import:progress', { jobId: 'job-1', state: 'done', processed: 21, report: { documents: 21, taxonomyNodes: 7, skipped: 0, warnings: [], skippedFiles: [], selfNames: [] } }),
    );
    await screen.findByTestId('import-done');
    fireEvent.click(screen.getByTestId('import-open'));
    expect(onFinished).toHaveBeenCalledWith('lib-test');
  });

  it('shows NOT_IMPLEMENTED from the importer as a clean message and lets the user continue', async () => {
    const { handlers } = memoryBackend({ settings: { firstRunDone: true } });
    setHandlers({
      ...handlers,
      'dialog:chooseFolder': () => ROOT,
      'import:probeLegacy': () => ({ found: true, documents: 3, taxonomyNodes: 0 }),
      'import:startLegacy': () => {
        throw new AppError('NOT_IMPLEMENTED', 'The importer is not available yet');
      },
    });
    const onFinished = mount();
    await untilStep('Folder');
    await chooseFolder();
    await advanceThrough(['Details', 'Existing index found', 'Starting tags', 'Claude', 'Summary']);
    fireEvent.click(screen.getByTestId('wizard-create'));
    const failed = await screen.findByTestId('import-failed');
    expect(failed.textContent).toContain('This feature is not available yet.');
    fireEvent.click(screen.getByTestId('import-continue'));
    expect(onFinished).toHaveBeenCalledWith('lib-test');
  });

  it('enables the folders ticked in the tree for Claude without any confirmation box', async () => {
    const { handlers } = memoryBackend({ settings: { firstRunDone: true } });
    setHandlers({
      ...handlers,
      'dialog:chooseFolder': () => ROOT,
      'import:probeLegacy': () => NO_LEGACY,
      'scan:start': SCAN_START,
      'library:listFolders': () => ({ folders: [{ path: 'papers', name: 'papers', hasChildren: false }] }),
    });
    mount();
    await untilStep('Folder');
    await chooseFolder();
    await advanceThrough(['Details', 'Starting tags', 'Claude']);
    expect(screen.queryByTestId('wizard-ai-confirm')).toBeNull();
    fireEvent.click(await screen.findByLabelText('papers'));
    expect(isDisabled('wizard-next')).toBe(false);
    await advanceThrough(['Summary']);
    fireEvent.click(screen.getByTestId('wizard-create'));
    await waitFor(() => expect(callsTo('library:create')).toHaveLength(1));
    expect(callsTo('library:create')[0].aiEnabledFolders).toEqual(['papers']);
  });
});
