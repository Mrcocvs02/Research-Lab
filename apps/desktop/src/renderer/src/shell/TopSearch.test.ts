// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryProfile } from '@rl/core';
import i18n from '../i18n';
import { AiUiProvider } from '../lib/aiUi';
import { getSearchText, setSearchText } from '../lib/librarySearch';
import { NavProvider, useNav } from '../lib/nav';
import { AppProvider } from '../state/app-context';
import { memoryBackend, setHandlers } from '../testing/mockRl';
import { TopSearch } from './TopSearch';

vi.mock('../lib/rl', async () => (await import('../testing/mockRl')).rlModule);

const profile: LibraryProfile = { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' };

/** Shows where the window is, so that the test can see a move to the Library. */
function Where() {
  const nav = useNav();
  return createElement('p', { 'data-testid': 'where' }, nav.view);
}
function Go() {
  const nav = useNav();
  return createElement('button', { type: 'button', 'data-testid': 'go-settings', onClick: () => nav.navigate({ view: 'settings' }) }, 'settings');
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  setSearchText('');
});
afterEach(() => cleanup());

const mount = (profiles: LibraryProfile[] = [profile]) => {
  setHandlers(memoryBackend({ profiles }).handlers);
  render(createElement(AppProvider, null, createElement(NavProvider, null, createElement(AiUiProvider, null, createElement(TopSearch), createElement(Where), createElement(Go)))));
};

describe('TopSearch (the search slot of the top bar)', () => {
  it('holds the real search box with the syntax and Claude buttons: three controls', async () => {
    mount();
    const input = (await screen.findByTestId('search-input')) as HTMLInputElement;
    await vi.waitFor(() => expect(input.disabled).toBe(false));
    const bar = input.closest('[role="search"]')!;
    expect(bar.querySelectorAll('input, button')).toHaveLength(3);
    expect(screen.getByTestId('search-syntax')).toBeTruthy();
    expect(screen.getByTestId('adv-search').getAttribute('aria-label')).toBe('Search with Claude');
  });

  it('writes the text the Library reads, and clears it with Escape', async () => {
    mount();
    const input = (await screen.findByTestId('search-input')) as HTMLInputElement;
    await vi.waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: 'attention' } });
    expect(getSearchText()).toBe('attention');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(getSearchText()).toBe('');
  });

  it('typing from another view keeps the text for the Library (the app then moves the window there)', async () => {
    mount();
    const input = (await screen.findByTestId('search-input')) as HTMLInputElement;
    await vi.waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.click(screen.getByTestId('go-settings'));
    expect(screen.getByTestId('where').textContent).toBe('settings');
    act(() => fireEvent.change(input, { target: { value: 'x' } }));
    // The test provider of the navigation does not move on `goTo`; what matters is that the text is kept for the Library.
    expect(getSearchText()).toBe('x');
  });

  it('shows the syntax in a popover', async () => {
    mount();
    const input = (await screen.findByTestId('search-input')) as HTMLInputElement;
    await vi.waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.click(screen.getByTestId('search-syntax'));
    const help = await screen.findByTestId('search-syntax-help');
    expect(help.textContent).toContain('author:');
    expect(help.textContent).toContain('year:2018-2022');
  });

  it('is off, with the reason, while there is no library', async () => {
    mount([]);
    const input = (await screen.findByTestId('search-input')) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.title).toBe('No library');
  });
});
