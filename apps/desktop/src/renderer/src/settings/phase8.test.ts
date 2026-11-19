// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, SHORTCUT_IDS, effectiveShortcuts, type BackupInfo, type LibraryProfile } from '@rl/core';
import i18n from '../i18n';
import { KeymapProvider } from '../lib/keymap';
import { AppProvider } from '../state/app-context';
import { callsTo, emitEvent, memoryBackend, setHandlers } from '../testing/mockRl';
import { GUIDE_TASKS, GuideDialog } from '../views/guide/GuideDialog';
import { WelcomeCard } from '../views/guide/WelcomeCard';
import { BackupSection } from './BackupSection';
import { MaintenanceSection } from './MaintenanceSection';
import { ShortcutsSection, overridesOf } from './ShortcutsSection';
import { daysSince, jobErrorText } from './backupText';

vi.mock('../lib/rl', async () => (await import('../testing/mockRl')).rlModule);

const profile: LibraryProfile = { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' };
const NOW = Date.parse('2026-11-17T10:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const info = (over: Partial<BackupInfo> = {}): BackupInfo => ({
  file: '/tmp/backups/alpha-20261101-100000.rlbackup',
  name: 'alpha-20261101-100000.rlbackup',
  bytes: 2048,
  createdAt: daysAgo(16),
  appVersion: '1.0.0',
  libraryName: 'Alpha',
  language: 'en',
  documents: 12,
  files: 40,
  includesLocal: true,
  includesSettings: true,
  origin: 'manual',
  newerFormat: false,
  ...over,
});

const baseSettings = (over: Record<string, unknown> = {}) => ({ destination: '/tmp/backups', auto: 'off', keep: 5, lastBackupAt: daysAgo(2), lastAutoError: null, ...over });
const job = (over: Record<string, unknown> = {}) => ({ jobId: 'j1', kind: 'create', state: 'running', phase: 'write', done: 0, total: 0, result: null, error: null, ...over });
const result = (over: Record<string, unknown> = {}) => ({ file: '/tmp/backups/x.rlbackup', bytes: 4096, files: 40, problemCount: 0, problems: [], restoredLibraryId: null, settingsRestored: false, secretsToEnter: [], ...over });

function setup(ui: ReturnType<typeof createElement>, extra: Record<string, (p: any) => unknown> = {}, settings: Record<string, unknown> = {}) {
  const { handlers, state } = memoryBackend({ profiles: [profile], settings: settings as never });
  setHandlers({ ...handlers, ...extra });
  render(createElement(AppProvider, null, createElement(KeymapProvider, null, ui)));
  return { state };
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('backup section', () => {
  it('shows the destination, a stale notice after 30 days, the last automatic error and the internal-copy difference', async () => {
    setup(createElement(BackupSection), {
      'backup:settings': () => baseSettings({ lastBackupAt: daysAgo(45), lastAutoError: 'no-destination' }),
      'backup:list': () => ({ items: [info()] }),
      'backup:preview': () => ({ dataFiles: 10, dataBytes: 5000, localFiles: 2, localBytes: 100, freeBytes: 10_000_000 }),
    });
    expect((await screen.findByTestId('backup-destination')).textContent).toBe('/tmp/backups');
    expect(screen.getByTestId('backup-stale').textContent).toContain('45 days');
    expect(screen.getByTestId('backup-auto-error').textContent).toContain('No destination folder is chosen');
    expect(screen.getByTestId('backup-internal-note').textContent).toContain('safety copy');
    await waitFor(() => expect(screen.getByTestId('backup-preview').textContent).toContain('12 files'));
    expect(daysSince('not a date')).toBeNull();
  });

  it('does not warn about a recent backup', async () => {
    setup(createElement(BackupSection), { 'backup:settings': () => baseSettings(), 'backup:list': () => ({ items: [] }) });
    await screen.findByTestId('backup-destination');
    expect(screen.queryByTestId('backup-stale')).toBeNull();
  });

  it('creates a backup with progress, shows the result, and can cancel', async () => {
    let status = job();
    setup(createElement(BackupSection), {
      'backup:settings': () => baseSettings(),
      'backup:list': () => ({ items: [] }),
      'backup:preview': () => ({ dataFiles: 1, dataBytes: 1, localFiles: 0, localBytes: 0, freeBytes: null }),
      'backup:create': () => ({ jobId: 'j1' }),
      'backup:status': () => status,
      'backup:cancel': () => ({ cancelled: true }),
    });
    fireEvent.click(await screen.findByTestId('backup-now'));
    await waitFor(() => expect(callsTo('backup:create')).toEqual([{ includeLocal: true }]));
    await screen.findByTestId('backup-cancel');
    act(() => emitEvent('backup:progress', job({ done: 512, total: 1024 })));
    await waitFor(() => expect(screen.getByTestId('backup-progress-count').textContent).toBe('512 B / 1 KB'));
    fireEvent.click(screen.getByTestId('backup-cancel'));
    expect(callsTo('backup:cancel')).toEqual([{ jobId: 'j1' }]);
    status = job({ state: 'done', phase: 'done', result: result() });
    act(() => emitEvent('backup:progress', status));
    expect((await screen.findByTestId('backup-result')).textContent).toContain('Backup written: 40 files, 4 KB');
    expect(screen.getByTestId('backup-reveal')).toBeTruthy();
  });

  it('explains the refusals of backup:create', async () => {
    setup(createElement(BackupSection), {
      'backup:settings': () => baseSettings(),
      'backup:list': () => ({ items: [] }),
      'backup:create': () => {
        throw new AppError('CONFLICT', 'x', { reason: 'not-enough-space', needed: 10 * 1024 * 1024, free: 1024 * 1024 });
      },
    });
    fireEvent.click(await screen.findByTestId('backup-now'));
    expect((await screen.findByTestId('backup-error')).textContent).toBe('Not enough free space in the destination: 10 MB needed, 1 MB free.');
  });

  it('keeps the button off without a destination, and chooses one through the main dialog', async () => {
    let dest: string | null = null;
    setup(createElement(BackupSection), {
      'backup:settings': () => baseSettings({ destination: dest, lastBackupAt: null }),
      'backup:list': () => ({ items: [] }),
      'backup:chooseDestination': () => {
        dest = '/tmp/chosen';
        return baseSettings({ destination: dest });
      },
    });
    await screen.findByTestId('backup-no-destination');
    expect(screen.queryByTestId('backup-now')).toBeNull();
    fireEvent.click(screen.getByTestId('backup-choose'));
    expect((await screen.findByTestId('backup-destination')).textContent).toBe('/tmp/chosen');
    await waitFor(() => expect((screen.getByTestId('backup-now') as HTMLButtonElement).disabled).toBe(false));
  });

  it('explains a destination inside a library', async () => {
    setup(createElement(BackupSection), {
      'backup:settings': () => baseSettings({ destination: null }),
      'backup:list': () => ({ items: [] }),
      'backup:chooseDestination': () => {
        throw new AppError('CONFLICT', 'x', { reason: 'inside-library' });
      },
    });
    fireEvent.click(await screen.findByTestId('backup-choose'));
    expect((await screen.findByTestId('backup-refused')).textContent).toContain('inside a library folder');
    expect(screen.queryByTestId('backup-now')).toBeNull();
    expect(screen.getByTestId('backup-choose').textContent).toBe('Choose another folder…');
  });

  it('saves the schedule through backup:configure', async () => {
    setup(createElement(BackupSection), {
      'backup:settings': () => baseSettings(),
      'backup:list': () => ({ items: [] }),
      'backup:configure': (p: any) => baseSettings(p),
    });
    fireEvent.click(within(await screen.findByTestId('backup-auto')).getByRole('radio', { name: 'Weekly' }));
    await waitFor(() => expect(callsTo('backup:configure')).toEqual([{ auto: 'weekly' }]));
    await waitFor(() => expect(within(screen.getByTestId('backup-auto')).getByRole('radio', { name: 'Weekly' }).getAttribute('aria-checked')).toBe('true'));
  });

  it('removes a backup only after confirmation', async () => {
    let items = [info()];
    setup(createElement(BackupSection), {
      'backup:settings': () => baseSettings(),
      'backup:list': () => ({ items }),
      'backup:remove': () => {
        items = [];
        return { ok: true };
      },
    });
    fireEvent.click(await screen.findByTestId('backup-more'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    expect(callsTo('backup:remove')).toEqual([]);
    expect(screen.getByTestId('backup-remove-confirm').textContent).toContain('cannot be undone');
    fireEvent.click(screen.getByTestId('backup-remove-yes'));
    await waitFor(() => expect(callsTo('backup:remove')).toEqual([{ file: info().file }]));
    await screen.findByTestId('backup-empty');
  });

  it('verifies a backup and lists the problems', async () => {
    setup(createElement(BackupSection), {
      'backup:settings': () => baseSettings(),
      'backup:list': () => ({ items: [info()] }),
      'backup:verify': () => ({ jobId: 'j2' }),
      'backup:status': () => job({ jobId: 'j2', kind: 'verify', state: 'done', phase: 'done', result: result({ problemCount: 1, problems: [{ path: 'library/a.md', reason: 'hash' }] }) }),
    });
    fireEvent.click(await screen.findByTestId('backup-verify'));
    const res = await screen.findByTestId('backup-verify-result');
    expect(res.getAttribute('data-ok')).toBe('false');
    expect(screen.getByTestId('backup-problems').textContent).toContain('library/a.md does not match its checksum');
  });

  it('opens a backup file picked with the file dialog and disables the actions of a newer format', async () => {
    setup(createElement(BackupSection), {
      'backup:settings': () => baseSettings(),
      'backup:list': () => ({ items: [] }),
      'dialog:chooseFile': () => ({ path: '/tmp/other.rlbackup', name: 'other.rlbackup' }),
      'backup:inspect': () => info({ file: '/tmp/other.rlbackup', name: 'other.rlbackup', newerFormat: true }),
    });
    fireEvent.click(await screen.findByTestId('backup-open-file'));
    const row = await screen.findByTestId('backup-item');
    expect(callsTo('dialog:chooseFile')[0]).toMatchObject({ purpose: 'backup-file' });
    expect(callsTo('backup:inspect')).toEqual([{ file: '/tmp/other.rlbackup' }]);
    expect((within(row).getByTestId('backup-restore') as HTMLButtonElement).disabled).toBe(true);
    // A file that is not in the destination list cannot be removed from here.
    fireEvent.click(within(row).getByTestId('backup-more'));
    expect((await screen.findByRole('menuitem', { name: 'Remove' })).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('restore dialog', () => {
  const open = async (extra: Record<string, (p: any) => unknown> = {}, item = info()) => {
    const { state } = setup(createElement(BackupSection), {
      'backup:settings': () => baseSettings(),
      'backup:list': () => ({ items: [item] }),
      'dialog:chooseFolder': () => ({ path: '/tmp/new-root', name: 'new-root' }),
      ...extra,
    });
    fireEvent.click(await screen.findByTestId('backup-restore'));
    await screen.findByTestId('restore-dialog');
    return state;
  };

  it('needs a folder, sends the choices, and lists the secrets to enter again', async () => {
    await open({
      'backup:restore': () => ({ jobId: 'r1' }),
      'backup:status': () => job({ jobId: 'r1', kind: 'restore', state: 'done', phase: 'done', result: result({ restoredLibraryId: 'lib-new', settingsRestored: true, secretsToEnter: ['anthropic-api-key', 'mcp-token'] }) }),
    });
    expect((screen.getByTestId('restore-start') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('restore-choose-root'));
    expect((await screen.findByTestId('restore-root')).textContent).toBe('/tmp/new-root');
    expect(callsTo('dialog:chooseFolder')[0]).toMatchObject({ purpose: 'library-root' });
    fireEvent.click(screen.getByTestId('restore-settings'));
    fireEvent.click(screen.getByTestId('restore-start'));
    await waitFor(() => expect(callsTo('backup:restore')).toEqual([{ file: info().file, rootPath: '/tmp/new-root', name: expect.stringContaining('Alpha (restored on'), restoreLocal: true, restoreSettings: true }]));
    const secrets = await screen.findByTestId('restore-secrets');
    expect(within(secrets).getAllByRole('listitem').map((l) => l.getAttribute('data-secret'))).toEqual(['anthropic-api-key', 'mcp-token']);
    expect(secrets.textContent).toContain('Anthropic API key');
    expect(screen.getByTestId('restore-result').getAttribute('data-library-id')).toBe('lib-new');
    expect(screen.getByTestId('restore-result').textContent).toContain('saved settings were applied');
  });

  it.each([
    ['not-empty', 'already exists in the chosen folder'],
    ['already-registered', 'A library already uses this folder'],
    ['integrity', 'damaged or incomplete'],
    ['newer-format', 'newer version of the app'],
    ['inside-library', 'inside a library folder'],
  ])('explains the conflict %s when the restore is refused', async (reason, text) => {
    await open({
      'backup:restore': () => {
        throw new AppError('CONFLICT', 'x', { reason });
      },
    });
    fireEvent.click(screen.getByTestId('restore-choose-root'));
    await screen.findByTestId('restore-root');
    fireEvent.click(screen.getByTestId('restore-start'));
    expect((await screen.findByTestId('restore-error')).textContent).toContain(text);
  });

  it('explains a conflict that arrives as the error of the job', async () => {
    await open({
      'backup:restore': () => ({ jobId: 'r2' }),
      'backup:status': () => job({ jobId: 'r2', kind: 'restore', state: 'failed', phase: 'verify', error: { code: 'CONFLICT', message: 'integrity: check failed', reason: 'integrity' } }),
    });
    fireEvent.click(screen.getByTestId('restore-choose-root'));
    await screen.findByTestId('restore-root');
    fireEvent.click(screen.getByTestId('restore-start'));
    expect((await screen.findByTestId('restore-failed')).textContent).toContain('damaged or incomplete');
  });

  it('cancels a running restore and says nothing was left behind', async () => {
    let status = job({ jobId: 'r3', kind: 'restore' });
    await open({
      'backup:restore': () => ({ jobId: 'r3' }),
      'backup:status': () => status,
      'backup:cancel': () => ({ cancelled: true }),
    });
    fireEvent.click(screen.getByTestId('restore-choose-root'));
    await screen.findByTestId('restore-root');
    fireEvent.click(screen.getByTestId('restore-start'));
    fireEvent.click(await screen.findByTestId('restore-cancel'));
    expect(callsTo('backup:cancel')).toEqual([{ jobId: 'r3' }]);
    status = job({ jobId: 'r3', kind: 'restore', state: 'cancelled' });
    act(() => emitEvent('backup:progress', status));
    expect((await screen.findByTestId('restore-cancelled')).textContent).toContain('No library and no data folder');
  });

  it('does not offer local data or settings the backup does not hold', async () => {
    await open({}, info({ includesLocal: false, includesSettings: false }));
    expect((screen.getByTestId('restore-local') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('restore-settings') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('maintenance section', () => {
  const report = { documents: 12, dataBytes: 2048, local: { index: 1024, cache: 4096, thumbs: 0, graph: 0, chats: 100 }, logsBytes: 10, process: { rssMb: 210.4, heapMb: 40, uptimeSec: 5, startupMs: 480 }, workers: 1 };

  it('shows sizes, cleans only the chosen regenerable data and reports what was freed', async () => {
    setup(createElement(MaintenanceSection), { 'maintenance:report': () => report, 'maintenance:clean': () => ({ freedBytes: 4096 }) });
    expect((await screen.findByTestId('maintenance-cache')).textContent).toBe('4 KB');
    expect(screen.getByTestId('maintenance-memory').textContent).toContain('210 MB');
    fireEvent.click(screen.getByTestId('maintenance-target-logs'));
    fireEvent.click(screen.getByTestId('maintenance-clean'));
    await waitFor(() => expect(callsTo('maintenance:clean')).toEqual([{ targets: ['cache', 'thumbs', 'graph'] }]));
    expect((await screen.findByTestId('maintenance-note')).textContent).toBe('Done: 4 KB freed.');
  });

  it('says the app is busy on CONFLICT', async () => {
    setup(createElement(MaintenanceSection), {
      'maintenance:report': () => report,
      'maintenance:clean': () => {
        throw new AppError('CONFLICT', 'busy', { reason: 'busy' });
      },
    });
    fireEvent.click(await screen.findByTestId('maintenance-clean'));
    expect((await screen.findByTestId('maintenance-error')).textContent).toContain('busy with a scan');
  });

  it('opens the logs and shows the diagnostics text it copied', async () => {
    setup(createElement(MaintenanceSection), {
      'maintenance:report': () => report,
      'maintenance:openLogs': () => ({ ok: true }),
      'maintenance:copyDiagnostics': () => ({ text: 'app 1.0.0\nlanguage en' }),
    });
    fireEvent.click(await screen.findByTestId('maintenance-logs'));
    await waitFor(() => expect(callsTo('maintenance:openLogs')).toHaveLength(1));
    fireEvent.click(screen.getByTestId('maintenance-diagnostics'));
    expect(((await screen.findByTestId('maintenance-diagnostics-text')) as HTMLTextAreaElement).value).toBe('app 1.0.0\nlanguage en');
  });
});

describe('shortcuts editor', () => {
  const rows = () => screen.getAllByTestId('shortcut-row');
  const row = (id: string) => rows().find((r) => r.getAttribute('data-command') === id)!;
  const act1 = async (id: string, item: string | RegExp) => {
    fireEvent.click(within(row(id)).getByTestId('shortcut-more'));
    fireEvent.click(await screen.findByRole('menuitem', { name: item }));
  };

  it('records a new accelerator and saves only the overrides', async () => {
    setup(createElement(ShortcutsSection));
    await screen.findByTestId('shortcuts-section');
    await act1('palette.open', 'Change');
    const rec = await screen.findByTestId('shortcut-recorder');
    fireEvent.keyDown(rec, { key: 'p', ctrlKey: true });
    expect(within(row('palette.open')).getByTestId('shortcut-key').textContent).toBe('Ctrl+P');
    await waitFor(() => expect(callsTo('settings:set')).toEqual([{ shortcuts: [{ id: 'palette.open', accelerator: 'Ctrl+P' }] }]));
  });

  it('refuses a fixed key and a key without Ctrl or Alt, and Escape cancels', async () => {
    setup(createElement(ShortcutsSection));
    await act1('chat.toggle', 'Change');
    let rec = await screen.findByTestId('shortcut-recorder');
    fireEvent.keyDown(rec, { key: 'c', ctrlKey: true });
    expect(screen.getByTestId('shortcut-problem').textContent).toContain('fixed key');
    fireEvent.keyDown(rec, { key: 'q' });
    expect(screen.getByTestId('shortcut-problem').textContent).toContain('Ctrl or Alt');
    fireEvent.keyDown(rec, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('shortcut-recorder')).toBeNull());
    expect(within(row('chat.toggle')).getByTestId('shortcut-key').textContent).toBe('Ctrl+J');
    expect(callsTo('settings:set')).toEqual([]);
    await act1('chat.toggle', 'Change');
    rec = await screen.findByTestId('shortcut-recorder');
    fireEvent.keyDown(rec, { key: 'Control', ctrlKey: true });
    expect(screen.queryByTestId('shortcut-problem')).toBeNull();
  });

  it('shows a conflict and refuses to save until it is solved', async () => {
    setup(createElement(ShortcutsSection));
    await act1('chat.toggle', 'Change');
    fireEvent.keyDown(await screen.findByTestId('shortcut-recorder'), { key: 'k', ctrlKey: true });
    expect(screen.getAllByText(/both use Ctrl\+K/).length).toBeGreaterThan(0);
    expect(row('chat.toggle').getAttribute('data-conflict')).toBe('true');
    expect(callsTo('settings:set')).toEqual([]);
    await act1('chat.toggle', /Restore the default/);
    expect(screen.queryByTestId('shortcuts-conflicts')).toBeNull();
  });

  it('turns a command off, and resets all to the defaults (an empty list)', async () => {
    setup(createElement(ShortcutsSection), {}, { shortcuts: [{ id: 'history.undo', accelerator: null }] });
    await screen.findByTestId('shortcuts-section');
    expect(within(row('history.undo')).getByTestId('shortcut-key').textContent).toBe('Off');
    fireEvent.click(screen.getByTestId('shortcuts-reset'));
    expect(within(row('history.undo')).getByTestId('shortcut-key').textContent).toBe('Ctrl+Z');
    await waitFor(() => expect(callsTo('settings:set')).toEqual([{ shortcuts: [] }]));
  });

  it('lets a command be turned off and saved', async () => {
    setup(createElement(ShortcutsSection));
    await screen.findByTestId('shortcuts-section');
    await act1('nav.review', 'Turn off');
    await waitFor(() => expect(callsTo('settings:set')).toEqual([{ shortcuts: [{ id: 'nav.review', accelerator: null }] }]));
  });

});

describe('fixes of the phase 8 review', () => {
  const t = i18n.t.bind(i18n);
  const startRestore = async () => {
    fireEvent.click(await screen.findByTestId('backup-restore'));
    await screen.findByTestId('restore-dialog');
    fireEvent.click(screen.getByTestId('restore-choose-root'));
    await screen.findByTestId('restore-root');
    fireEvent.click(screen.getByTestId('restore-start'));
  };
  const withBackups = (state: ReturnType<typeof setup>['state']) => {
    state.backup.items = [info()];
    state.backup.lastBackupAt = daysAgo(2);
  };
  const withFolder = { 'dialog:chooseFolder': () => ({ path: '/tmp/new-root', name: 'new-root' }) };

  it('jobErrorText uses the reason first, then the exact "<reason>: " prefix, never a substring', () => {
    expect(jobErrorText({ code: 'CONFLICT', message: 'anything', reason: 'integrity' }, t)).toContain('damaged or incomplete');
    expect(jobErrorText({ code: 'CONFLICT', message: 'not-empty: the folder has files' }, t)).toContain('already exists in the chosen folder');
    // "busy" and "running" appear inside the message but not as its prefix: the generic text is used.
    expect(jobErrorText({ code: 'IO_ERROR', message: 'the disk was busy while running' }, t)).not.toContain('scan');
    expect(jobErrorText({ code: 'IO_ERROR', message: 'the disk was busy while running' }, t)).not.toContain('already running');
    expect(jobErrorText({ code: 'CONFLICT', message: 'x', reason: 'something-new' }, t)).toBe(t('errors.CONFLICT'));
    expect(jobErrorText(null, t)).toBe('The operation failed.');
  });

  it('explains the new reasons of a refused start, and not-enough-space on restore with needed and free', async () => {
    const { state } = setup(createElement(BackupSection), withFolder);
    withBackups(state);
    for (const [reason, text] of [
      ['file-not-listed', 'not in the backup folder'],
      ['invalid-path', 'path cannot be used'],
      ['running', 'already running'],
    ] as const) {
      state.backup.startRefusal = { code: 'INVALID_REQUEST', reason };
      fireEvent.click(await screen.findByTestId('backup-verify'));
      await waitFor(() => expect(screen.getByTestId('backup-error').textContent).toContain(text));
    }
    state.backup.startRefusal = { reason: 'not-enough-space', needed: 10 * 1024 * 1024, free: 1024 * 1024 };
    await startRestore();
    expect((await screen.findByTestId('restore-error')).textContent).toBe('Not enough free space in the destination: 10 MB needed, 1 MB free.');
  });

  it('shows the reason carried by the error of a failed job', async () => {
    const { state } = setup(createElement(BackupSection), withFolder);
    withBackups(state);
    state.backup.jobError = { code: 'CONFLICT', message: 'not-enough-space: more room needed', reason: 'not-enough-space' };
    await startRestore();
    expect((await screen.findByTestId('restore-failed')).textContent).toContain('Not enough free space');
  });

  it('lists the settings reset by a restore, and refreshes the app when the dialog closes', async () => {
    const { state } = setup(createElement(BackupSection), withFolder);
    withBackups(state);
    state.backup.resultExtra = { resetOnRestore: ['mcp', 'mcp-write', 'confirm-before-send'] };
    await startRestore();
    const note = await screen.findByTestId('restore-reset');
    expect(within(note).getAllByRole('listitem').map((l) => l.getAttribute('data-reset'))).toEqual(['mcp', 'mcp-write', 'confirm-before-send']);
    expect(note.textContent).toContain('MCP server is off');
    expect(note.textContent).toContain('Turn them on again');
    const before = callsTo('settings:get').length;
    fireEvent.click(screen.getByTestId('restore-close'));
    await waitFor(() => expect(callsTo('settings:get').length).toBeGreaterThan(before));
  });

  it('refreshes the app on close whenever the result holds a restored library, even if the job did not end as done', async () => {
    const { state } = setup(createElement(BackupSection), {
      ...withFolder,
      'backup:status': () => job({ jobId: 'r9', kind: 'restore', state: 'cancelled', phase: 'finish', result: result({ restoredLibraryId: 'lib-new' }) }),
      'backup:restore': () => ({ jobId: 'r9' }),
    });
    withBackups(state);
    await startRestore();
    await screen.findByTestId('restore-cancelled');
    const before = callsTo('settings:get').length;
    fireEvent.click(screen.getByTestId('restore-close'));
    await waitFor(() => expect(callsTo('settings:get').length).toBeGreaterThan(before));
  });

  it('warns about files that vanished during the backup, and not otherwise', async () => {
    const { state } = setup(createElement(BackupSection));
    state.backup.resultExtra = { skipped: 3 };
    fireEvent.click(await screen.findByTestId('backup-now'));
    expect((await screen.findByTestId('backup-skipped')).textContent).toContain('3 files disappeared');
    fireEvent.click(screen.getByTestId('backup-job-close'));
    state.backup.resultExtra = { skipped: 0 };
    fireEvent.click(screen.getByTestId('backup-now'));
    await screen.findByTestId('backup-result');
    expect(screen.queryByTestId('backup-skipped')).toBeNull();
  });

  it('says that a synced destination holds the backup files and which chats are included', async () => {
    setup(createElement(BackupSection));
    expect((await screen.findByText(/If the destination is in a synced folder/)).textContent).toContain('Automatic backups never include chat history');
  });

  it('shows the size of the internal safety copy and that it is not cleaned', async () => {
    const { state } = setup(createElement(MaintenanceSection));
    state.report.local.backups = 5 * 1024;
    expect((await screen.findByTestId('maintenance-backups')).textContent).toBe('5 KB');
    expect(screen.getByTestId('maintenance-backups-note').textContent).toContain('not touched by cleaning');
  });

  it('names the commands of a shortcut-conflict refusal from main', async () => {
    setup(createElement(ShortcutsSection), {
      'settings:set': () => {
        throw new AppError('INVALID_REQUEST', 'x', { reason: 'shortcut-conflict', conflicts: [['palette.open', 'chat.toggle']] });
      },
    });
    const off = (await screen.findAllByTestId('shortcut-row')).find((r) => r.getAttribute('data-command') === 'nav.review')!;
    fireEvent.click(within(off).getByTestId('shortcut-more'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Turn off' }));
    const err = await screen.findByTestId('shortcuts-error');
    expect(err.textContent).toContain(t('shortcuts.commands.palette.open'));
    expect(err.textContent).toContain(t('shortcuts.commands.chat.toggle'));
  });

  it('the mock of settings:set runs the same conflict check as main', async () => {
    const { handlers } = memoryBackend();
    await expect(Promise.resolve().then(() => handlers['settings:set']!({ shortcuts: [{ id: 'chat.toggle', accelerator: 'Ctrl+K' }] }))).rejects.toMatchObject({ code: 'INVALID_REQUEST', details: { reason: 'shortcut-conflict' } });
  });
});

describe('guide', () => {
  it('lists the tasks and a shortcut table generated from the commands, with the overrides applied', async () => {
    setup(createElement(GuideDialog, { kind: 'guide', onClose: vi.fn() }), {}, { shortcuts: [{ id: 'palette.open', accelerator: 'Ctrl+P' }] });
    await screen.findByTestId('guide-dialog');
    expect(screen.getAllByTestId('guide-task')).toHaveLength(GUIDE_TASKS.length);
    await waitFor(() => {
      const keys = screen.getAllByTestId('shortcut-list-key').map((k) => k.textContent);
      expect(keys).toContain('Ctrl+P');
      expect(keys).not.toContain('Ctrl+K');
    });
    // One row per command with a key (derived from the commands, so a new command does not break the count).
    expect(screen.getAllByTestId('shortcut-list-key').length).toBe(SHORTCUT_IDS.filter((id) => effectiveShortcuts([{ id: 'palette.open', accelerator: 'Ctrl+P' }])[id]).length);
  });

  it('shows only the shortcut list for the shortcuts dialog, in Italian too', async () => {
    setup(createElement(GuideDialog, { kind: 'shortcuts', onClose: vi.fn() }), {}, { uiLanguage: 'it' });
    const dialog = await screen.findByTestId('shortcuts-dialog');
    expect(screen.queryAllByTestId('guide-task')).toHaveLength(0);
    await waitFor(() => expect(dialog.textContent).toContain('Scorciatoie da tastiera'));
    expect(dialog.textContent).toContain('Apri la tavolozza dei comandi');
  });
});

describe('welcome card', () => {
  it('lists three first steps, ticks the ones already done, and is closed for good with one button', async () => {
    const { state } = setup(createElement(WelcomeCard), {}, { guide: { welcomeSeen: false, dismissedTips: ['read'] } });
    await screen.findByTestId('welcome-card');
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.getAttribute('data-done'))).toEqual(['true', 'false', 'false']);
    expect(screen.queryByTestId('welcome-tip-hide')).toBeNull();
    fireEvent.click(screen.getByTestId('welcome-dismiss'));
    await waitFor(() => expect(callsTo('settings:set')).toContainEqual({ guide: { welcomeSeen: true } }));
    expect(state.settings.guide.welcomeSeen).toBe(true);
  });
});

describe('overridesOf', () => {
  it('keeps only what differs from the defaults, a disabled command included', () => {
    expect(overridesOf(effectiveShortcuts([]))).toEqual([]);
    const eff = effectiveShortcuts([
      { id: 'palette.open', accelerator: 'Ctrl+P' },
      { id: 'chat.toggle', accelerator: 'Ctrl+J' },
      { id: 'nav.review', accelerator: null },
    ]);
    expect(overridesOf(eff)).toEqual([
      { id: 'palette.open', accelerator: 'Ctrl+P' },
      { id: 'nav.review', accelerator: null },
    ]);
  });
});
