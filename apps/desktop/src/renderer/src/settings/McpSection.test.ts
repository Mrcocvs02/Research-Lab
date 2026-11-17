// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, defaultLibraryConfig, type LibraryProfile, type McpStatus } from '@rl/core';
import i18n from '../i18n';
import { AppProvider } from '../state/app-context';
import { callsTo, emitEvent, memoryBackend, setHandlers } from '../testing/mockRl';
import { McpSection } from './McpSection';

vi.mock('../lib/rl', async () => (await import('../testing/mockRl')).rlModule);

const profile: LibraryProfile = { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' };
const TOOLS = ['search_library', 'get_document', 'similar_documents'] as const;
const TOKEN = 'rl_secret_token_value_0123456789';

const off: McpStatus = { enabled: false, writeEnabled: false, running: false, port: null, url: null, error: null, tools: [], calls: 0, lastCallAt: null };
const running: McpStatus = { ...off, enabled: true, running: true, port: 45678, url: 'http://127.0.0.1:45678/mcp', tools: [...TOOLS] };

interface Opts {
  status?: McpStatus;
  aiFolders?: string[];
  log?: Array<{ at: string; tool: string; ok: boolean; ms: number; code: string | null; docIds: string[] }>;
}

function setup(o: Opts = {}) {
  const state = { status: o.status ?? off, log: o.log ?? [], fail: {} as Record<string, AppError> };
  const guard = <T>(channel: string, fn: () => T) => () => {
    if (state.fail[channel]) throw state.fail[channel];
    return fn();
  };
  const { handlers } = memoryBackend({ profiles: [profile] });
  const config = { ...defaultLibraryConfig({ name: 'Alpha', language: 'en' }), aiEnabledFolders: o.aiFolders ?? ['alpha'] };
  const patch = (p: Partial<McpStatus>) => (state.status = { ...state.status, ...p });
  setHandlers({
    ...handlers,
    'library:getConfig': () => config,
    'mcp:status': () => state.status,
    'mcp:setEnabled': (p: any) => guard('mcp:setEnabled', () => patch(p.enabled ? { enabled: true, running: true, port: 45678, url: 'http://127.0.0.1:45678/mcp', tools: [...TOOLS] } : { enabled: false, writeEnabled: false, running: false, url: null, tools: [] }))(),
    'mcp:setWriteEnabled': (p: any) => patch({ writeEnabled: p.writeEnabled, tools: p.writeEnabled ? [...TOOLS, 'write_ai_field'] : [...TOOLS] }),
    'mcp:setPort': (p: any) => patch({ port: p.port ?? 51000, url: `http://127.0.0.1:${p.port ?? 51000}/mcp`, error: null, running: true }),
    'mcp:copyConfig': (p: any) => guard('mcp:copyConfig', () => ({ preview: p.format === 'cli' ? 'claude mcp add --transport http lab http://127.0.0.1:45678/mcp --header "Authorization: Bearer rl_****"' : '{"mcpServers":{"lab":{"headers":{"Authorization":"Bearer rl_****"}}}}' }))(),
    'mcp:rotateToken': () => state.status,
    'mcp:log': (p: any) => ({ items: state.log.slice(p.offset, p.offset + p.limit), total: state.log.length }),
  });
  render(createElement(AppProvider, null, createElement(McpSection)));
  return state;
}

const call = (n: number, over: Partial<NonNullable<Opts['log']>[number]> = {}) => ({ at: `2026-11-${String(10 + (n % 10)).padStart(2, '0')}T10:00:00.000Z`, tool: `tool_${n}`, ok: true, ms: 12, code: null, docIds: ['aaaaaaaaaaaaaaaa'], ...over });

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => cleanup());

describe('McpSection', () => {
  it('starts off, says what Claude Code can see, and makes nothing at startup beyond status and log', async () => {
    setup();
    expect(await screen.findByTestId('mcp-state')).toBeTruthy();
    expect(screen.getByTestId('mcp-state').textContent).toBe('Off');
    expect((screen.getByTestId('mcp-enable') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId('mcp-sees').textContent).toContain('only the documents in the 1 folder enabled for AI');
    expect((screen.getByTestId('mcp-copy-cli') as HTMLButtonElement).disabled).toBe(true);
    expect(callsTo('mcp:setEnabled')).toHaveLength(0);
  });

  it('says that nothing is visible while no folder is AI-enabled, and when the whole library is', async () => {
    setup({ aiFolders: [] });
    expect((await screen.findByTestId('mcp-sees')).textContent).toContain('no folder is enabled for AI');
    cleanup();
    setup({ aiFolders: [''] });
    await waitFor(() => expect(screen.getByTestId('mcp-sees').textContent).toContain('whole library'));
  });

  it('enables the server and shows running, address and tools', async () => {
    setup();
    fireEvent.click(await screen.findByTestId('mcp-enable'));
    await waitFor(() => expect(screen.getByTestId('mcp-state').textContent).toBe('Running'));
    expect(callsTo('mcp:setEnabled')).toEqual([{ enabled: true }]);
    expect(screen.getByTestId('mcp-url').textContent).toBe('http://127.0.0.1:45678/mcp');
    expect(screen.getByTestId('mcp-tools').textContent).toContain('search_library, get_document');
    expect(screen.getByTestId('mcp-tools').textContent).not.toContain('write_ai_field');
    expect((screen.getByTestId('mcp-copy-cli') as HTMLButtonElement).disabled).toBe(false);
  });

  it('explains PORT_IN_USE and what to do, and applies another port', async () => {
    setup({ status: { ...off, enabled: true, port: 45678, error: { code: 'PORT_IN_USE', message: 'in use' } } });
    const problem = await screen.findByTestId('mcp-problem');
    expect(problem.getAttribute('data-code')).toBe('PORT_IN_USE');
    expect(problem.textContent).toContain('Another program is using port 45678');
    expect(screen.getByTestId('mcp-state').textContent).toBe('Not running');
    const port = screen.getByTestId('mcp-port') as HTMLInputElement;
    expect(port.value).toBe('45678');
    expect((screen.getByTestId('mcp-port-apply') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(port, { target: { value: '80' } });
    expect(screen.getByText(/whole number between 1024 and 65535/)).toBeTruthy();
    expect((screen.getByTestId('mcp-port-apply') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(port, { target: { value: '50123' } });
    fireEvent.click(screen.getByTestId('mcp-port-apply'));
    await waitFor(() => expect(callsTo('mcp:setPort')).toEqual([{ port: 50123 }]));
    await waitFor(() => expect(screen.getByTestId('mcp-state').textContent).toBe('Running'));
    expect(screen.queryByTestId('mcp-problem')).toBeNull();
  });

  it('uses an automatic port when the field is emptied', async () => {
    setup({ status: running });
    const port = (await screen.findByTestId('mcp-port')) as HTMLInputElement;
    fireEvent.change(port, { target: { value: '' } });
    expect(screen.getByTestId('mcp-port-apply').textContent).toBe('Use an automatic port');
    fireEvent.click(screen.getByTestId('mcp-port-apply'));
    await waitFor(() => expect(callsTo('mcp:setPort')).toEqual([{ port: null }]));
  });

  it('explains SECRET_UNAVAILABLE with what to do', async () => {
    setup({ status: { ...off, enabled: true, error: { code: 'SECRET_UNAVAILABLE', message: 'no store' } } });
    const problem = await screen.findByTestId('mcp-problem');
    expect(problem.textContent).toContain('secure store is not available');
    expect(problem.textContent).toContain('keyring');
  });

  it('warns about writing, asks to confirm before allowing proposals, and turns it off at once', async () => {
    setup({ status: running });
    const box = (await screen.findByTestId('mcp-write')) as HTMLInputElement;
    expect(screen.getByTestId('mcp-write-warning').textContent).toContain('can only PROPOSE AI fields');
    expect(screen.getByTestId('mcp-write-warning').textContent).toContain('your review');
    fireEvent.click(box);
    const confirm = await screen.findByTestId('mcp-write-confirm');
    expect(callsTo('mcp:setWriteEnabled')).toHaveLength(0);
    fireEvent.click(within(confirm).getByText('Cancel'));
    expect(screen.queryByTestId('mcp-write-confirm')).toBeNull();
    expect(callsTo('mcp:setWriteEnabled')).toHaveLength(0);

    fireEvent.click(box);
    fireEvent.click(await screen.findByTestId('mcp-write-yes'));
    await waitFor(() => expect(callsTo('mcp:setWriteEnabled')).toEqual([{ writeEnabled: true }]));
    await waitFor(() => expect(screen.getByTestId('mcp-tools').textContent).toContain('write_ai_field'));
    fireEvent.click(box);
    await waitFor(() => expect(callsTo('mcp:setWriteEnabled')).toEqual([{ writeEnabled: true }, { writeEnabled: false }]));
  });

  it('copies the configuration (cli and json): only the masked preview is shown, never a token', async () => {
    setup({ status: running });
    fireEvent.click(await screen.findByTestId('mcp-copy-cli'));
    const copied = await screen.findByTestId('mcp-copied');
    expect(callsTo('mcp:copyConfig')).toEqual([{ format: 'cli' }]);
    expect(copied.textContent).toContain('Copied to the clipboard');
    expect(screen.getByTestId('mcp-preview').textContent).toContain('rl_****');
    fireEvent.click(screen.getByTestId('mcp-copy-json'));
    await waitFor(() => expect(screen.getByTestId('mcp-preview').textContent).toContain('mcpServers'));
    expect(callsTo('mcp:copyConfig')[1]).toEqual({ format: 'json' });
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it('says the server must run when copying is refused', async () => {
    const state = setup({ status: running });
    state.fail['mcp:copyConfig'] = new AppError('CONFLICT', 'x', { reason: 'not-running' });
    fireEvent.click(await screen.findByTestId('mcp-copy-cli'));
    expect((await screen.findByTestId('mcp-copy-error')).textContent).toContain('must be running');
    expect(screen.queryByTestId('mcp-copied')).toBeNull();
  });

  it('rotates the token only after confirmation and tells to copy the new configuration', async () => {
    setup({ status: running });
    fireEvent.click(await screen.findByTestId('mcp-rotate'));
    const confirm = await screen.findByTestId('mcp-rotate-confirm');
    expect(confirm.textContent).toContain('stops working at once');
    expect(callsTo('mcp:rotateToken')).toHaveLength(0);
    fireEvent.click(within(confirm).getByText('Cancel'));
    expect(callsTo('mcp:rotateToken')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('mcp-rotate'));
    fireEvent.click(await screen.findByTestId('mcp-rotate-yes'));
    await waitFor(() => expect(callsTo('mcp:rotateToken')).toHaveLength(1));
    expect((await screen.findByTestId('mcp-rotated')).textContent).toContain('Copy the new configuration');
  });

  it('follows mcp:changed live: status and call count, and reloads the log', async () => {
    const state = setup({ status: running, log: [call(1)] });
    await waitFor(() => expect(screen.getAllByTestId('mcp-log-row')).toHaveLength(1));
    expect(screen.getByTestId('mcp-calls').textContent).toBe('0 calls so far');
    state.log = [call(2, { ok: false, code: 'FOLDER_NOT_AI_ENABLED' }), call(1)];
    act(() => emitEvent('mcp:changed', { ...running, calls: 2, lastCallAt: '2026-11-11T10:00:00.000Z' }));
    await waitFor(() => expect(screen.getAllByTestId('mcp-log-row')).toHaveLength(2));
    expect(screen.getByTestId('mcp-calls').textContent).toContain('2 calls so far, the last on');
    expect(screen.getAllByTestId('mcp-log-row')[0]!.textContent).toContain('Failed (FOLDER_NOT_AI_ENABLED)');
    act(() => emitEvent('mcp:changed', { ...off, enabled: true, error: { code: 'PORT_IN_USE', message: 'x' } }));
    await waitFor(() => expect(screen.getByTestId('mcp-problem')).toBeTruthy());
    expect((screen.getByTestId('mcp-copy-cli') as HTMLButtonElement).disabled).toBe(true);
  });

  it('pages the call log without showing any content', async () => {
    const log = Array.from({ length: 30 }, (_, i) => call(i));
    setup({ status: { ...running, calls: 30 }, log });
    await waitFor(() => expect(screen.getAllByTestId('mcp-log-row')).toHaveLength(25));
    expect(callsTo('mcp:log')[0]).toEqual({ limit: 25, offset: 0 });
    fireEvent.click(screen.getByTestId('mcp-log-more'));
    await waitFor(() => expect(screen.getAllByTestId('mcp-log-row')).toHaveLength(30));
    expect(callsTo('mcp:log')[1]).toEqual({ limit: 25, offset: 25 });
    expect(screen.queryByTestId('mcp-log-more')).toBeNull();
    const headers = within(screen.getByTestId('mcp-log')).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['When', 'Tool', 'Outcome', 'ms', 'Documents']);
  });

  it('shows a localized error when a call fails', async () => {
    const state = setup({ status: running });
    state.fail['mcp:setEnabled'] = new AppError('IO_ERROR', 'x');
    fireEvent.click(await screen.findByTestId('mcp-enable'));
    expect((await screen.findByTestId('mcp-error')).textContent).toContain('could not be read or written');
  });

  it('is in Italian too', async () => {
    setup({ status: running });
    expect((await screen.findByTestId('mcp-state')).textContent).toBe('Running');
    await act(async () => {
      await i18n.changeLanguage('it');
    });
    await waitFor(() => expect(screen.getByTestId('mcp-state').textContent).toBe('In esecuzione'));
  });
});
