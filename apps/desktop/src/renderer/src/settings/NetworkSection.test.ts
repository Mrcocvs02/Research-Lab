// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryProfile } from '@rl/core';
import i18n from '../i18n';
import { AppProvider } from '../state/app-context';
import { callsTo, memoryBackend, setHandlers } from '../testing/mockRl';
import { NetworkSection } from './NetworkSection';

vi.mock('../lib/rl', async () => (await import('../testing/mockRl')).rlModule);

const profile: LibraryProfile = { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' };

const saved = new Set<string>();
function setup(email: string, on = false) {
  const { handlers } = memoryBackend({ profiles: [profile], settings: { user: { name: '', authorVariants: [], email, orcid: '', openAlexId: '' }, network: { openAlexEmail: on } } });
  setHandlers({
    ...handlers,
    'secrets:has': (p: any) => ({ exists: saved.has(`${p.scope.kind}/${p.name}`) }),
    'secrets:set': (p: any) => (saved.add(`${p.scope.kind}/${p.name}`), {}),
    'secrets:delete': (p: any) => (saved.delete(`${p.scope.kind}/${p.name}`), {}),
  });
  render(createElement(AppProvider, null, createElement(NetworkSection)));
}

beforeEach(async () => {
  saved.clear();
  await i18n.changeLanguage('en');
});
afterEach(() => cleanup());

describe('NetworkSection', () => {
  it('is off by default, explains what it does, and turns on through settings:set', async () => {
    setup('someone@example.org');
    const box = (await screen.findByTestId('net-openalex-email')) as HTMLInputElement;
    await waitFor(() => expect(box.disabled).toBe(false));
    expect(box.checked).toBe(false);
    expect(screen.getByTestId('settings-network').textContent).toContain('only if you turn this on');
    fireEvent.click(box);
    await waitFor(() => expect(callsTo('settings:set')).toEqual([{ network: { openAlexEmail: true } }]));
    await waitFor(() => expect((screen.getByTestId('net-openalex-email') as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByTestId('net-openalex-email'));
    await waitFor(() => expect(callsTo('settings:set').at(-1)).toEqual({ network: { openAlexEmail: false } }));
  });

  it('is disabled with a hint when the profile has no email', async () => {
    setup('');
    const box = (await screen.findByTestId('net-openalex-email')) as HTMLInputElement;
    await waitFor(() => expect(screen.getByTestId('settings-network').textContent).toContain('Add an email to your profile'));
    expect(box.disabled).toBe(true);
    expect(callsTo('settings:set')).toEqual([]);
  });

  it('lets the user turn it off even after the email was removed', async () => {
    setup('', true);
    const box = (await screen.findByTestId('net-openalex-email')) as HTMLInputElement;
    await waitFor(() => expect(box.checked).toBe(true));
    expect(box.disabled).toBe(false);
  });

  it('saves, replaces and removes the OpenAlex key in the secure store, and never shows its value', async () => {
    setup('');
    const status = await screen.findByTestId('net-openalex-key-status');
    await waitFor(() => expect(status.textContent).toBe('Not saved'));
    const input = screen.getByTestId('net-openalex-key-input') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect((screen.getByTestId('net-openalex-key-remove') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('net-openalex-key-store') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: ' oa-test-key ' } });
    fireEvent.click(screen.getByTestId('net-openalex-key-store'));
    await waitFor(() => expect(status.textContent).toBe('Saved'));
    expect(callsTo('secrets:set')).toEqual([{ scope: { kind: 'app' }, name: 'openalex-api-key', value: 'oa-test-key' }]);
    expect(input.value).toBe('');
    expect(screen.getByTestId('settings-network').textContent).not.toContain('oa-test-key');
    expect((screen.getByTestId('net-openalex-key-remove') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('net-openalex-key-remove'));
    await waitFor(() => expect(status.textContent).toBe('Not saved'));
    expect(callsTo('secrets:delete')).toEqual([{ scope: { kind: 'app' }, name: 'openalex-api-key' }]);
  });

  it('shows the saved state at start', async () => {
    saved.add('app/openalex-api-key');
    setup('');
    await waitFor(() => expect(screen.getByTestId('net-openalex-key-status').textContent).toBe('Saved'));
  });
});
