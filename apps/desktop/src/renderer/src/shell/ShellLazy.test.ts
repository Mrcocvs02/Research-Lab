// @vitest-environment happy-dom
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryProfile } from '@rl/core';
import i18n from '../i18n';
import { AiUiProvider } from '../lib/aiUi';
import { NotifyProvider } from '../lib/notify';
import { LibraryEventsProvider } from '../lib/events';
import { ReaderProvider } from '../lib/reader';
import { AppProvider } from '../state/app-context';
import { memoryAi } from '../testing/memoryAi';
import { callsTo, memoryBackend, setHandlers } from '../testing/mockRl';
import { Shell } from './Shell';

vi.mock('../lib/rl', async () => (await import('../testing/mockRl')).rlModule);

const profile: LibraryProfile = { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' };
const AI_CHANNELS = ['ai:status', 'ai:usage', 'ai:log', 'chat:list', 'chat:get', 'chat:send', 'commands:list', 'export:preview', 'export:run', 'mcp:status', 'mcp:log'];

function setup() {
  const ai = memoryAi();
  const { handlers } = memoryBackend({ profiles: [profile] });
  setHandlers({ ...handlers, ...ai.handlers, 'scan:status': () => ({ libraryId: 'lib-a', state: 'idle', seen: 0, processed: 0, indexed: 0 }) });
  render(
    createElement(
      AppProvider,
      null,
      createElement(LibraryEventsProvider, null, createElement(NotifyProvider, null, createElement(ReaderProvider, null, createElement(AiUiProvider, null, createElement(Shell, { section: 'library', onSection() {}, onNewLibrary() {}, children: createElement('p', null, 'main') }))))),
    ),
  );
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

describe('AI interface loads on demand', () => {
  it('starts with no AI code and no AI request; the chat loads when the panel opens (button, then Ctrl+J)', async () => {
    setup();
    await screen.findByTestId('status-library');
    expect(screen.queryByTestId('chat-content')).toBeNull();
    expect(screen.queryByTestId('palette-open')).toBeNull();
    expect(AI_CHANNELS.flatMap((c) => callsTo(c))).toHaveLength(0);

    fireEvent.click(screen.getByTestId('chat-toggle'));
    expect(await screen.findByTestId('chat-content')).toBeTruthy();
    expect(callsTo('ai:status').length).toBeGreaterThan(0);

    // Collapsing keeps the conversation mounted; the shortcut brings it back.
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId('chat-toggle').getAttribute('aria-expanded')).toBe('false'));
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId('chat-toggle').getAttribute('aria-expanded')).toBe('true'));
  });

  it('opens the command palette with Ctrl+K and from its button, and loads it only then', async () => {
    setup();
    await screen.findByTestId('status-library');
    expect(screen.queryByTestId('command-palette')).toBeNull();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(await screen.findByTestId('command-palette')).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId('palette-input'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('command-palette')).toBeNull());
    fireEvent.click(screen.getByTestId('chat-toggle'));
    fireEvent.click(await screen.findByTestId('palette-open'));
    expect(await screen.findByTestId('command-palette')).toBeTruthy();
  });

  it('keeps the AI chunks out of the first screen: only dynamic imports reach them', () => {
    const root = path.resolve(import.meta.dirname, '..');
    const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
    const staticImport = /^\s*import\s[^;]*from\s+'[^']*(views\/chat\/|views\/export\/|\.\/AiSection|\.\/McpSection|settings\/AiSection|settings\/McpSection|\/AiLog)/m;
    for (const file of ['App.tsx', 'main.tsx', 'shell/Shell.tsx', 'settings/Settings.tsx', 'lib/aiUi.tsx', 'views/library/LibraryView.tsx', 'views/reader/ReaderView.tsx', 'views/projects/ProjectsView.tsx', 'views/projects/ProjectDetailView.tsx', 'views/network/MapPanel.tsx']) {
      expect(staticImport.test(read(file)), file).toBe(false);
    }
    expect(read('shell/Shell.tsx')).toMatch(/import\('\.\.\/views\/chat\/ChatPanel'\)/);
    expect(read('shell/Shell.tsx')).toMatch(/import\('\.\.\/views\/chat\/Palette'\)/);
    expect(read('settings/Settings.tsx')).toMatch(/import\('\.\/AiSection'\)/);
    expect(read('settings/Settings.tsx')).toMatch(/import\('\.\/McpSection'\)/);
    expect(read('shell/Shell.tsx')).toMatch(/import\('\.\.\/views\/export\/ExportDialog'\)/);
    // The first-screen glue must not pull the schemas (zod) of the core in.
    expect(read('lib/aiUi.tsx')).not.toMatch(/from '@rl\/core'/);
  });
});
