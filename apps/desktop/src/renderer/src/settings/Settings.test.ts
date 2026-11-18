// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultLibraryConfig, type LibraryProfile } from '@rl/core';
import i18n from '../i18n';
import { AppProvider } from '../state/app-context';
import { memoryAi } from '../testing/memoryAi';
import { callsTo, memoryBackend, rlModule, setHandlers } from '../testing/mockRl';
import { Settings } from './Settings';

vi.mock('../lib/rl', async () => (await import('../testing/mockRl')).rlModule);

const profile = (id: string, name: string): LibraryProfile => ({ id, name, rootPath: `/tmp/${id}`, dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' });

function setup(extra: Record<string, (p: any) => unknown> = {}) {
  const { handlers, state } = memoryBackend({ profiles: [profile('lib-a', 'Alpha'), profile('lib-b', 'Beta')] });
  let config = defaultLibraryConfig({ name: 'Alpha', language: 'en' });
  const secrets = new Map<string, string>();
  const key = (p: any) => `${p.scope.kind}/${p.scope.libraryId ?? ''}/${p.name}`;
  setHandlers({
    ...handlers,
    ...memoryAi().handlers,
    'library:getConfig': () => config,
    'library:setConfig': (p: any) => {
      config = { ...config, ...p.patch, ai: { ...config.ai, ...(p.patch.ai ?? {}) }, scan: { ...config.scan, ...(p.patch.scan ?? {}) } };
      return config;
    },
    'library:rename': (p: any) => {
      const found = state.profiles.find((x) => x.id === p.libraryId)!;
      found.name = p.name;
      return found;
    },
    'library:forget': (p: any) => {
      state.profiles = state.profiles.filter((x) => x.id !== p.libraryId);
      state.active = state.profiles[0]?.id ?? null;
      return { activeLibraryId: state.active };
    },
    'secrets:has': (p: any) => ({ exists: secrets.has(key(p)) }),
    'secrets:set': (p: any) => {
      secrets.set(key(p), p.value);
      return {};
    },
    'secrets:delete': (p: any) => {
      secrets.delete(key(p));
      return {};
    },
    ...extra,
  });
  render(createElement(AppProvider, null, createElement(Settings, { onNewLibrary: vi.fn() })));
  return { state };
}

const open = async (section: string) => {
  fireEvent.click(await screen.findByTestId(`settings-nav-${section}`));
  return screen.findByTestId(`settings-section-${section}`);
};

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  cleanup();
});

describe('Settings page', () => {
  it('has the seven sections, General first, with Developer / Advanced after a separator', async () => {
    setup();
    const nav = await screen.findByRole('navigation', { name: 'Settings' });
    const ids = within(nav)
      .getAllByRole('button')
      .map((b) => b.getAttribute('data-testid'))
      .filter((id) => id?.startsWith('settings-nav-'));
    expect(ids).toEqual(['general', 'profile', 'library', 'claude', 'backup', 'shortcuts', 'advanced'].map((s) => `settings-nav-${s}`));
    expect(within(nav).getByRole('separator')).toBeTruthy();
    expect(screen.getByTestId('settings-nav-general').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('settings-nav-advanced').textContent).toBe('Developer / Advanced');
    expect(callsTo('ai:usageAll')).toEqual([]); // nothing heavy runs just by opening the page
  });

  it('shows a warning on Claude when it is not connected and on Backup when the last backup is old', async () => {
    setup({
      'ai:account': () => ({ authMode: 'auto', effective: 'none', apiKey: { stored: false, envVar: false }, claudeCode: { path: null, source: 'none', version: null, loggedIn: false, account: null, supportsAuthCommands: true } }),
      'backup:settings': () => ({ destination: '/tmp/b', auto: 'off', keep: 5, lastBackupAt: '2020-01-01T00:00:00.000Z', lastAutoError: null }),
    });
    expect(await screen.findByTestId('settings-warn-claude')).toBeTruthy();
    expect(await screen.findByTestId('settings-warn-backup')).toBeTruthy();
  });
});

describe('General and Profile', () => {
  it('changes the interface language at once and saves it', async () => {
    setup();
    fireEvent.change(await screen.findByTestId('language-select'), { target: { value: 'it' } });
    await waitFor(() => expect(callsTo('settings:set')).toContainEqual({ uiLanguage: 'it' }));
    await waitFor(() => expect(screen.getByTestId('settings-nav-profile').textContent).toBe('Profilo'));
  });

  it('saves the theme at once and "Show the tips again" clears the guide state', async () => {
    setup();
    await screen.findByTestId('settings-theme');
    fireEvent.click(within(screen.getByTestId('settings-theme')).getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(callsTo('settings:set')).toContainEqual({ appearance: { theme: 'dark' } }));
    fireEvent.click(screen.getByTestId('settings-tips-reset'));
    await waitFor(() => expect(callsTo('settings:set')).toContainEqual({ guide: { welcomeSeen: false, dismissedTips: [] } }));
  });

  it('validates a profile field with the core schema and saves only a valid one (on blur)', async () => {
    setup();
    await open('profile');
    const id = await screen.findByLabelText('OpenAlex author id');
    fireEvent.change(id, { target: { value: 'bad id' } });
    expect(screen.getByText(/format A followed by digits/)).toBeTruthy();
    fireEvent.blur(id);
    expect(callsTo('settings:set')).toEqual([]);
    fireEvent.change(id, { target: { value: 'A1234567890' } });
    fireEvent.blur(id);
    await waitFor(() => expect(callsTo('settings:set')).toEqual([{ user: { openAlexId: 'A1234567890' } }]));
    const variants = screen.getByLabelText('Names as they appear among authors');
    fireEvent.change(variants, { target: { value: 'Doe, J.\nDoe, Jane' } });
    fireEvent.blur(variants);
    await waitFor(() => expect(callsTo('settings:set')).toContainEqual({ user: { authorVariants: ['Doe, J.', 'Doe, Jane'] } }));
  });

  it('saves a profile text by itself 600 ms after the last key press', async () => {
    setup();
    await open('profile');
    const name = await screen.findByTestId('settings-profile-name');
    fireEvent.change(name, { target: { value: 'Jane' } });
    expect(callsTo('settings:set')).toEqual([]);
    await waitFor(() => expect(callsTo('settings:set')).toEqual([{ user: { name: 'Jane' } }]), { timeout: 2000 });
  });

  it('keeps the OpenAlex email switch off until the profile has an email', async () => {
    setup();
    await open('profile');
    const sw = await screen.findByTestId('net-openalex-email');
    expect((sw as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Library', () => {
  it('renames a library, activates another and removes one from the list only after confirmation', async () => {
    const { state } = setup();
    await open('library');
    expect(await screen.findAllByTestId('library-item')).toHaveLength(2);
    fireEvent.click(screen.getAllByTestId('library-more')[0]!);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    fireEvent.change(screen.getByTestId('library-rename-input'), { target: { value: 'Alpha renamed' } });
    fireEvent.click(screen.getByText('Save', { selector: 'form button' }));
    await waitFor(() => expect(callsTo('library:rename')).toEqual([{ libraryId: 'lib-a', name: 'Alpha renamed' }]));

    fireEvent.click(screen.getByTestId('library-activate'));
    await waitFor(() => expect(callsTo('library:setActive')).toEqual([{ libraryId: 'lib-b' }]));

    fireEvent.click(screen.getAllByTestId('library-more')[0]!);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove from list' }));
    expect(callsTo('library:forget')).toEqual([]);
    const dialog = screen.getByTestId('library-forget-dialog');
    expect(dialog.textContent).toContain('No file or folder is deleted');
    fireEvent.click(within(dialog).getByTestId('library-forget-yes'));
    await waitFor(() => expect(callsTo('library:forget')).toHaveLength(1));
    expect(state.profiles).toHaveLength(1);
  });

  it('saves the name and the language of the documents by themselves, and refuses an empty name', async () => {
    setup();
    await open('library');
    const name = await screen.findByTestId('config-name');
    fireEvent.change(name, { target: { value: '' } });
    expect(screen.getByText(/Enter a name/)).toBeTruthy();
    fireEvent.blur(name);
    expect(callsTo('library:setConfig')).toEqual([]);
    fireEvent.change(name, { target: { value: 'Alpha 2' } });
    fireEvent.blur(name);
    await waitFor(() => expect(callsTo('library:setConfig')).toEqual([{ libraryId: 'lib-a', patch: { name: 'Alpha 2' } }]));
    fireEvent.change(screen.getByTestId('config-language'), { target: { value: 'it' } });
    await waitFor(() => expect(callsTo('library:setConfig')).toContainEqual({ libraryId: 'lib-a', patch: { language: 'it' } }));
  });

  it('starts a scan from the last-scan row', async () => {
    setup({ 'scan:start': () => ({}) });
    await open('library');
    fireEvent.click(await screen.findByTestId('settings-scan-now'));
    await waitFor(() => expect(callsTo('scan:start')).toEqual([{}]));
  });
});

describe('Saved keys (Advanced)', () => {
  it('stores keys write-only: only "saved / not saved" is ever shown', async () => {
    setup();
    await open('advanced');
    const status = await screen.findByTestId('secret-status-gemini-api-key');
    expect(status.textContent).toBe('Not saved');
    fireEvent.click(screen.getByTestId('secret-add-gemini-api-key'));
    const input = screen.getByTestId('secret-input-gemini-api-key') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: 'sk-test-not-a-real-key' } });
    fireEvent.click(screen.getByTestId('secret-save-gemini-api-key'));
    await waitFor(() => expect(screen.getByTestId('secret-status-gemini-api-key').textContent).toBe('Saved'));
    expect(callsTo('secrets:set')).toEqual([{ scope: { kind: 'library', libraryId: 'lib-a' }, name: 'gemini-api-key', value: 'sk-test-not-a-real-key' }]);
    expect(document.body.textContent).not.toContain('sk-test-not-a-real-key');
    fireEvent.click(screen.getByTestId('secret-remove-gemini-api-key'));
    await waitFor(() => expect(screen.getByTestId('secret-status-gemini-api-key').textContent).toBe('Not saved'));
  });

  it('keeps the OpenAlex key in the app scope', async () => {
    setup();
    await open('advanced');
    fireEvent.click(await screen.findByTestId('secret-add-openalex-api-key'));
    fireEvent.change(screen.getByTestId('secret-input-openalex-api-key'), { target: { value: 'oa-test' } });
    fireEvent.click(screen.getByTestId('secret-save-openalex-api-key'));
    await waitFor(() => expect(callsTo('secrets:set')).toEqual([{ scope: { kind: 'app' }, name: 'openalex-api-key', value: 'oa-test' }]));
  });

  it('lists what differs from the default with a Restore for each', async () => {
    setup({ 'library:getConfig': () => ({ ...defaultLibraryConfig({ name: 'Alpha', language: 'en' }), scan: { extensions: ['pdf'], nameOnlyExtensions: [], pruneDeletedDays: 30 } }), 'library:setConfig': () => ({}) });
    await open('advanced');
    const diff = await screen.findByTestId('settings-diff-ext');
    fireEvent.click(within(diff).getByText('Restore'));
    await waitFor(() => expect(callsTo('library:setConfig')[0].patch.scan.extensions).toContain('md'));
  });
});

describe('Search', () => {
  it('finds a setting by a synonym and opens its section with the focus on the control', async () => {
    setup();
    fireEvent.change(await screen.findByTestId('settings-search'), { target: { value: 'budget' } });
    const hit = await screen.findByTestId('settings-result');
    expect(hit.getAttribute('data-entry')).toBe('monthlyCap');
    expect(hit.textContent).toContain('Claude › Model and spending');
    fireEvent.click(hit);
    await screen.findByTestId("ai-spend");
    await waitFor(() => expect(document.activeElement?.getAttribute('data-testid')).toBe('ai-monthly-cap'), { timeout: 4000 });
  });

  it('opens the Advanced group that holds the setting, with Enter', async () => {
    setup();
    const box = await screen.findByTestId('settings-search');
    fireEvent.change(box, { target: { value: 'rebuild the index' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('settings-fold-scan').hasAttribute('open')).toBe(true));
    await screen.findByTestId('index-rebuild');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('index-rebuild')), { timeout: 4000 });
  });

  it('says so when nothing matches', async () => {
    setup();
    fireEvent.change(await screen.findByTestId('settings-search'), { target: { value: 'zzzz' } });
    expect(await screen.findByText('No setting found')).toBeTruthy();
  });
});

describe('listeners', () => {
  it('leaves no event listener behind after 20 openings of the page and its sections', async () => {
    let active = 0;
    let peak = 0;
    const real = rlModule.rl.on;
    const spy = vi.spyOn(rlModule.rl, 'on').mockImplementation(((event: string, cb: (p: unknown) => void) => {
      active++;
      peak = Math.max(peak, active);
      const off = real(event, cb);
      let done = false;
      return () => {
        if (!done) {
          done = true;
          active--;
        }
        off();
      };
    }) as never);
    for (let i = 0; i < 20; i++) {
      const { handlers } = memoryBackend({ profiles: [profile('lib-a', 'Alpha')] });
      setHandlers({ ...handlers, ...memoryAi().handlers, 'library:getConfig': () => defaultLibraryConfig({ name: 'Alpha', language: 'en' }) });
      const view = render(createElement(AppProvider, null, createElement(Settings, { onNewLibrary: vi.fn() })));
      for (const s of ['claude', 'backup', 'shortcuts', 'advanced']) await open(s);
      view.unmount();
      cleanup();
    }
    expect(active).toBe(0);
    expect(peak).toBeLessThan(10);
    spy.mockRestore();
  }, 60_000);
});
