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

describe('Wizard', () => {
  it('walks every step, defaults AI folders to none, and creates the library with relative data only', async () => {
    const { handlers } = memoryBackend();
    setHandlers({ ...handlers, 'dialog:chooseFolder': () => ROOT, 'import:probeLegacy': () => NO_LEGACY });
    const onFinished = mount();
    await untilStep('Welcome');

    fireEvent.change(screen.getByTestId('wizard-ui-language'), { target: { value: 'it' } });
    await waitFor(() => expect(callsTo('settings:set')).toContainEqual({ uiLanguage: 'it' }));
    await untilStep('Benvenuto');
    fireEvent.change(screen.getByTestId('wizard-ui-language'), { target: { value: 'en' } });
    await untilStep('Welcome');
    next();

    await untilStep('About you');
    fireEvent.change(screen.getByTestId('wizard-profile-name'), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByTestId('wizard-profile-variants'), { target: { value: 'Doe, J.\nDoe, Jane\nDoe, J.' } });
    next();

    await untilStep('Library folder');
    expect(isDisabled('wizard-next')).toBe(true);
    await chooseFolder();
    next();

    await untilStep('Library details');
    expect((screen.getByTestId('wizard-lib-name') as HTMLInputElement).value).toBe('example-root');
    fireEvent.change(screen.getByTestId('wizard-doc-language'), { target: { value: 'it' } });
    expect((screen.getByTestId('wizard-data-dir') as HTMLInputElement).value).toBe('.lab');
    next();

    await untilStep('Starting taxonomy');
    expect((screen.getByLabelText(/Proposed by Claude/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Available after connecting Claude.')).toBeTruthy();
    next();

    await untilStep('Folders enabled for Claude');
    expect(screen.getByText(/No folder enabled/)).toBeTruthy();
    expect(isDisabled('wizard-next')).toBe(true);
    fireEvent.click(screen.getByTestId('wizard-ai-confirm'));
    next();

    await untilStep('Summary');
    fireEvent.click(screen.getByTestId('wizard-create'));
    await waitFor(() => expect(onFinished).toHaveBeenCalledWith('lib-test'));

    expect(callsTo('settings:set')).toContainEqual({
      uiLanguage: 'en',
      user: expect.objectContaining({ name: 'Jane Doe', authorVariants: ['Doe, J.', 'Doe, Jane'] }),
    });
    expect(callsTo('library:create')).toEqual([{ name: 'example-root', rootPath: ROOT.path, language: 'it', dataDirName: '.lab', aiEnabledFolders: [] }]);
    expect(callsTo('library:setActive')).toEqual([{ libraryId: 'lib-test' }]);
    expect(callsTo('settings:set')).toContainEqual({ firstRunDone: true });
    expect(callsTo('import:startLegacy')).toEqual([]);
  });

  it('shows inline validation for the profile and blocks Next', async () => {
    setHandlers(memoryBackend().handlers);
    mount();
    await untilStep('Welcome');
    next();
    await untilStep('About you');
    fireEvent.change(screen.getByLabelText('ORCID'), { target: { value: 'nope' } });
    expect(screen.getByText('Use the format 0000-0000-0000-0000.')).toBeTruthy();
    expect(isDisabled('wizard-next')).toBe(true);
    fireEvent.change(screen.getByLabelText('ORCID'), { target: { value: '0000-0002-1825-0097' } });
    expect(isDisabled('wizard-next')).toBe(false);
  });

  it('skips the user steps when first run is done and rejects bad data folder names', async () => {
    const { handlers } = memoryBackend({ settings: { firstRunDone: true } });
    setHandlers({ ...handlers, 'dialog:chooseFolder': () => ROOT, 'import:probeLegacy': () => NO_LEGACY });
    mount();
    await untilStep('Library folder');
    await chooseFolder();
    next();
    await untilStep('Library details');
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
    await untilStep('Library folder');
    await chooseFolder();
    await advanceThrough(['Library details', 'Existing index found']);
    expect(screen.getByTestId('legacy-preview').textContent).toContain('21 documents');
    expect(screen.getByTestId('legacy-preview').textContent).toContain('7 taxonomy entries');
    await advanceThrough(['Starting taxonomy', 'Folders enabled for Claude']);
    fireEvent.click(screen.getByTestId('wizard-ai-confirm'));
    await advanceThrough(['Summary']);
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
    await untilStep('Library folder');
    await chooseFolder();
    await advanceThrough(['Library details', 'Existing index found', 'Starting taxonomy', 'Folders enabled for Claude']);
    fireEvent.click(screen.getByTestId('wizard-ai-confirm'));
    await advanceThrough(['Summary']);
    fireEvent.click(screen.getByTestId('wizard-create'));
    const failed = await screen.findByTestId('import-failed');
    expect(failed.textContent).toContain('This feature is not available yet.');
    fireEvent.click(screen.getByTestId('import-continue'));
    expect(onFinished).toHaveBeenCalledWith('lib-test');
  });

  it('asks for the confirmation again after the folder selection changes', async () => {
    const { handlers } = memoryBackend({ settings: { firstRunDone: true } });
    setHandlers({
      ...handlers,
      'dialog:chooseFolder': () => ROOT,
      'import:probeLegacy': () => NO_LEGACY,
      'library:listFolders': () => ({ folders: [{ path: 'papers', name: 'papers', hasChildren: false }] }),
    });
    mount();
    await untilStep('Library folder');
    await chooseFolder();
    await advanceThrough(['Library details', 'Starting taxonomy', 'Folders enabled for Claude']);
    fireEvent.click(screen.getByTestId('wizard-ai-confirm'));
    expect(isDisabled('wizard-next')).toBe(false);
    fireEvent.click(await screen.findByLabelText('papers'));
    expect((screen.getByTestId('wizard-ai-confirm') as HTMLInputElement).checked).toBe(false);
    expect(isDisabled('wizard-next')).toBe(true);
    fireEvent.click(screen.getByTestId('wizard-ai-confirm'));
    await advanceThrough(['Summary']);
    fireEvent.click(screen.getByTestId('wizard-create'));
    await waitFor(() => expect(callsTo('library:create')).toHaveLength(1));
    expect(callsTo('library:create')[0].aiEnabledFolders).toEqual(['papers']);
  });
});
