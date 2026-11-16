// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultLibraryConfig, type LibraryProfile } from '@rl/core';
import i18n from '../i18n';
import { AppProvider } from '../state/app-context';
import { memoryAi } from '../testing/memoryAi';
import { callsTo, memoryBackend, setHandlers } from '../testing/mockRl';
import { Settings } from './Settings';

vi.mock('../lib/rl', async () => (await import('../testing/mockRl')).rlModule);

const profile = (id: string, name: string): LibraryProfile => ({ id, name, rootPath: `/tmp/${id}`, dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' });

function setup(extra: Record<string, (p: any) => unknown> = {}) {
  const { handlers, state } = memoryBackend({ profiles: [profile('lib-a', 'Alpha'), profile('lib-b', 'Beta')] });
  let config = defaultLibraryConfig({ name: 'Alpha', language: 'en' });
  const secrets = new Map<string, string>();
  setHandlers({
    ...handlers,
    ...memoryAi().handlers,
    'library:getConfig': () => config,
    'library:setConfig': (p: any) => {
      config = { ...config, ...p.patch, ai: { ...config.ai, ...(p.patch.ai ?? {}) } };
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
    'secrets:has': (p: any) => ({ exists: secrets.has(`${p.scope.libraryId}/${p.name}`) }),
    'secrets:set': (p: any) => {
      secrets.set(`${p.scope.libraryId}/${p.name}`, p.value);
      return {};
    },
    'secrets:delete': (p: any) => {
      secrets.delete(`${p.scope.libraryId}/${p.name}`);
      return {};
    },
    ...extra,
  });
  render(createElement(AppProvider, null, createElement(Settings, { onNewLibrary: vi.fn() })));
  return { state };
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  cleanup();
});

describe('Settings', () => {
  it('validates the user profile inline with the core schema', async () => {
    setup();
    await screen.findByTestId('settings-profile-name');
    fireEvent.change(screen.getByLabelText('OpenAlex author id'), { target: { value: 'bad id' } });
    expect(screen.getByText(/format A followed by digits/)).toBeTruthy();
    expect((screen.getByTestId('settings-profile-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('OpenAlex author id'), { target: { value: 'A1234567890' } });
    fireEvent.change(screen.getByLabelText('Names as they appear among authors'), { target: { value: 'Doe, J.\nDoe, Jane' } });
    fireEvent.click(screen.getByTestId('settings-profile-save'));
    await waitFor(() => expect(callsTo('settings:set')).toHaveLength(1));
    expect(callsTo('settings:set')[0].user).toMatchObject({ openAlexId: 'A1234567890', authorVariants: ['Doe, J.', 'Doe, Jane'] });
  });

  it('changes the interface language immediately and persists it', async () => {
    setup();
    fireEvent.change(await screen.findByTestId('settings-ui-language'), { target: { value: 'it' } });
    await waitFor(() => expect(callsTo('settings:set')).toContainEqual({ uiLanguage: 'it' }));
    await waitFor(() => expect(screen.getByText('Impostazioni della libreria: Alpha')).toBeTruthy());
  });

  it('renames a library, activates another and removes one from the list only after confirmation', async () => {
    const { state } = setup();
    const items = await screen.findAllByTestId('library-item');
    expect(items).toHaveLength(2);
    fireEvent.click(screen.getAllByText('Rename')[0]!);
    fireEvent.change(within(screen.getByTestId('library-list')).getByLabelText('Library name'), { target: { value: 'Alpha renamed' } });
    fireEvent.click(screen.getByText('Save', { selector: 'form button' }));
    await waitFor(() => expect(callsTo('library:rename')).toEqual([{ libraryId: 'lib-a', name: 'Alpha renamed' }]));

    fireEvent.click(screen.getByText('Activate'));
    await waitFor(() => expect(callsTo('library:setActive')).toEqual([{ libraryId: 'lib-b' }]));

    fireEvent.click(screen.getAllByText('Remove from list')[0]!);
    expect(callsTo('library:forget')).toEqual([]);
    expect(screen.getByRole('alertdialog').textContent).toContain('No file or folder is deleted');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText('Remove from list'));
    await waitFor(() => expect(callsTo('library:forget')).toHaveLength(1));
    expect(state.profiles).toHaveLength(1);
  });

  it('edits the library config (name, MCP, export presets) and saves a patch that leaves the AI settings alone', async () => {
    setup();
    await screen.findByTestId('library-config');
    fireEvent.change(screen.getByTestId('config-name'), { target: { value: '' } });
    expect(screen.getByText(/Enter a name/)).toBeTruthy();
    expect((screen.getByTestId('config-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId('config-name'), { target: { value: 'Alpha 2' } });

    fireEvent.click(screen.getByLabelText('Enable the MCP server'));
    fireEvent.click(screen.getByTestId('add-preset'));
    expect(screen.getAllByTestId('export-preset')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('config-save'));
    await waitFor(() => expect(callsTo('library:setConfig')).toHaveLength(1));
    const sent = callsTo('library:setConfig')[0];
    expect(sent.libraryId).toBe('lib-a');
    expect(sent.patch).toMatchObject({
      name: 'Alpha 2',
      mcp: { enabled: true, writeEnabled: false },
    });
    expect(sent.patch.exportPresets).toHaveLength(1);
    expect(sent.patch).not.toHaveProperty('ai');
    expect(sent.patch).not.toHaveProperty('aiEnabledFolders');
  });

  it('stores API keys write-only: only "set / not set" is ever shown', async () => {
    setup();
    const status = await screen.findByTestId('secret-status-gemini-api-key');
    expect(status.textContent).toBe('Not set');
    const input = screen.getByLabelText('Gemini API key') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: 'sk-test-not-a-real-key' } });
    fireEvent.click(input.parentElement!.querySelector('button.primary')!);
    await waitFor(() => expect(screen.getByTestId('secret-status-gemini-api-key').textContent).toBe('Set'));
    expect(callsTo('secrets:set')).toEqual([{ scope: { kind: 'library', libraryId: 'lib-a' }, name: 'gemini-api-key', value: 'sk-test-not-a-real-key' }]);
    expect((screen.getByLabelText('Gemini API key') as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).not.toContain('sk-test-not-a-real-key');
    fireEvent.click(screen.getAllByText('Delete')[0]!);
    await waitFor(() => expect(screen.getByTestId('secret-status-gemini-api-key').textContent).toBe('Not set'));
  });
});
