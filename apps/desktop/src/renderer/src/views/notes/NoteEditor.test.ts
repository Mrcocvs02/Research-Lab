// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, type LibraryProfile } from '@rl/core';
import i18n from '../../i18n';
import { FlushError, flushAll, hasDirtyEditors, installWindowGuard, resetEditorsForTests } from '../../lib/dirtyEditors';
import { LibraryEventsProvider } from '../../lib/events';
import { NotifyProvider } from '../../lib/notify';
import { ReaderProvider, useReader } from '../../lib/reader';
import { AppProvider, useApp } from '../../state/app-context';
import { callsTo, memoryBackend, setHandlers } from '../../testing/mockRl';
import { NoteEditor } from './NoteEditor';

vi.mock('../../lib/rl', async () => (await import('../../testing/mockRl')).rlModule);

const DOC = 'd000000000000000';
const profiles: LibraryProfile[] = [
  { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'lib-b', name: 'Beta', rootPath: '/tmp/b', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' },
];

/** A `notes:save` the test releases by hand, so a save can be "in flight" while the user keeps typing. */
function controlledSaves() {
  const waiting: Array<{ body: string; release(): void; fail(e: unknown): void }> = [];
  let n = 0;
  const handler = (p: { body: string }) =>
    new Promise((resolve, reject) => {
      waiting.push({
        body: p.body,
        release: () => resolve({ note: { docId: DOC, body: p.body, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: `2026-01-01T00:00:0${++n}.000Z` } }),
        fail: reject,
      });
    });
  return { waiting, handler };
}

const failing = () => {
  throw new AppError('IO_ERROR', 'disk');
};

function setup(over: Record<string, (p: any) => unknown> = {}) {
  const { handlers } = memoryBackend({ profiles });
  setHandlers({ ...handlers, 'notes:get': () => ({ note: null }), ...over });
}
const wrap = (child: ReactElement) => createElement(AppProvider, null, createElement(LibraryEventsProvider, null, createElement(NotifyProvider, null, createElement(ReaderProvider, null, child))));
const editor = () => createElement(NoteEditor, { docId: DOC, testId: 'n' });
const box = async () => (await screen.findByTestId('n-input')) as HTMLTextAreaElement;
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

beforeEach(async () => {
  await i18n.changeLanguage('en');
  resetEditorsForTests();
});
afterEach(() => cleanup());

describe('NoteEditor: chained saves', () => {
  it('a save waits for the one in flight and then saves the latest text, with the fresh updatedAt', async () => {
    const c = controlledSaves();
    setup({ 'notes:save': c.handler });
    render(wrap(editor()));
    const input = await box();
    fireEvent.change(input, { target: { value: 'one' } });
    fireEvent.blur(input); // save 1 goes out
    await waitFor(() => expect(c.waiting).toHaveLength(1));
    fireEvent.change(input, { target: { value: 'one two' } }); // typed while it is in flight
    fireEvent.blur(input);
    await tick();
    expect(c.waiting).toHaveLength(1); // the second does not overtake the first
    await act(async () => c.waiting[0]!.release());
    await waitFor(() => expect(c.waiting).toHaveLength(2));
    expect(c.waiting[1]!.body).toBe('one two');
    expect(callsTo('notes:save')[1].expectedUpdatedAt).toBe('2026-01-01T00:00:01.000Z');
    await act(async () => c.waiting[1]!.release());
    await waitFor(() => expect(screen.getByTestId('n-state').textContent).toBe('Saved'));
  });

  it('text typed during a blur save is not lost when the editor goes away', async () => {
    const c = controlledSaves();
    setup({ 'notes:save': c.handler });
    const view = render(wrap(editor()));
    const input = await box();
    fireEvent.change(input, { target: { value: 'first' } });
    fireEvent.blur(input);
    await waitFor(() => expect(c.waiting).toHaveLength(1));
    fireEvent.change(input, { target: { value: 'first and more' } });
    view.unmount();
    // Still registered while the save is open.
    expect(hasDirtyEditors()).toBe(true);
    await act(async () => c.waiting[0]!.release());
    await waitFor(() => expect(c.waiting).toHaveLength(2));
    expect(c.waiting[1]!.body).toBe('first and more');
    await act(async () => c.waiting[1]!.release());
    await waitFor(() => expect(hasDirtyEditors()).toBe(false));
  });

  it('text whose save fails after the editor went away comes back when the note opens again (D-201)', async () => {
    let fail = true;
    const saves: string[] = [];
    setup({
      'notes:save': (p: { body: string }) => {
        if (fail) throw new AppError('IO_ERROR', 'disk');
        saves.push(p.body);
        return { note: { docId: DOC, body: p.body, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:05.000Z' } };
      },
    });
    const first = render(wrap(editor()));
    fireEvent.change(await box(), { target: { value: 'typed, never saved' } });
    first.unmount(); // the unmount save fails: the text must not be thrown away
    await waitFor(() => expect(hasDirtyEditors()).toBe(false));
    cleanup();

    fail = false;
    render(wrap(editor()));
    await waitFor(async () => expect((await box()).value).toBe('typed, never saved'));
    expect(screen.getByTestId('n-restored')).toBeTruthy();
    fireEvent.blur(await box());
    await waitFor(() => expect(saves).toEqual(['typed, never saved']));
    await waitFor(() => expect(screen.queryByTestId('n-restored')).toBeNull());
  });
});

describe('flushAll', () => {
  it('waits for the save in flight and the text typed after it', async () => {
    const c = controlledSaves();
    setup({ 'notes:save': c.handler });
    render(wrap(editor()));
    const input = await box();
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.blur(input);
    await waitFor(() => expect(c.waiting).toHaveLength(1));
    fireEvent.change(input, { target: { value: 'ab' } });
    let done = false;
    const p = flushAll().then(() => (done = true));
    await tick();
    expect(done).toBe(false);
    await act(async () => c.waiting[0]!.release());
    await waitFor(() => expect(c.waiting).toHaveLength(2));
    expect(done).toBe(false);
    await act(async () => c.waiting[1]!.release());
    await p;
    expect(hasDirtyEditors()).toBe(false);
  });

  it('is immediate when nothing is dirty', async () => {
    setup();
    render(wrap(editor()));
    await box();
    await flushAll();
    expect(callsTo('notes:save')).toHaveLength(0);
  });

  it('rejects when a text cannot be saved, keeps it on screen and shows the error', async () => {
    setup({ 'notes:save': failing });
    render(wrap(editor()));
    const input = await box();
    fireEvent.change(input, { target: { value: 'precious' } });
    await expect(flushAll()).rejects.toBeInstanceOf(FlushError);
    expect(input.value).toBe('precious');
    expect((await screen.findByTestId('n-save-error')).textContent).toMatch(/could not be saved/);
    expect(hasDirtyEditors()).toBe(true);
  });
});

describe('Library switch, reader close and window close wait for unsaved notes (D-197)', () => {
  function SwitchProbe() {
    const app = useApp();
    const [err, setErr] = useState('');
    return createElement(
      'div',
      null,
      createElement('button', { 'data-testid': 'switch', onClick: () => void app.setActiveLibrary('lib-b').catch((e: unknown) => setErr(e instanceof FlushError ? 'flush' : 'other')) }),
      createElement('p', { 'data-testid': 'err' }, err),
      createElement('p', { 'data-testid': 'active' }, app.activeLibraryId ?? ''),
    );
  }

  it('saves the note into the library it belongs to BEFORE switching', async () => {
    const order: string[] = [];
    const { handlers } = memoryBackend({ profiles });
    setHandlers({
      ...handlers,
      'notes:get': () => ({ note: null }),
      'notes:save': (p: any) => (order.push(`save:${p.body}`), { note: { docId: DOC, body: p.body, createdAt: 'x', updatedAt: '2026-01-01T00:00:01.000Z' } }),
      'library:setActive': (p: any) => (order.push('switch'), handlers['library:setActive']!(p)),
    });
    render(wrap(createElement('div', null, editor(), createElement(SwitchProbe))));
    fireEvent.change(await box(), { target: { value: 'typed' } });
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('lib-a'));
    fireEvent.click(screen.getByTestId('switch'));
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('lib-b'));
    expect(order).toEqual(['save:typed', 'switch']);
  });

  it('does not switch when the note cannot be saved', async () => {
    setup({ 'notes:save': failing });
    render(wrap(createElement('div', null, editor(), createElement(SwitchProbe))));
    const input = await box();
    fireEvent.change(input, { target: { value: 'typed' } });
    await waitFor(() => expect(screen.getByTestId('active').textContent).toBe('lib-a'));
    fireEvent.click(screen.getByTestId('switch'));
    await waitFor(() => expect(screen.getByTestId('err').textContent).toBe('flush'));
    expect(callsTo('library:setActive')).toHaveLength(0);
    expect(screen.getByTestId('active').textContent).toBe('lib-a');
    expect(input.value).toBe('typed');
  });

  function ReaderProbe() {
    const { target, openReader, closeReader } = useReader();
    return createElement(
      'div',
      null,
      createElement('button', { 'data-testid': 'open', onClick: () => openReader(DOC) }),
      createElement('button', { 'data-testid': 'close', onClick: () => closeReader() }),
      createElement('p', { 'data-testid': 'target' }, target?.docId ?? 'closed'),
    );
  }

  it('closes the reader only after the note is saved, and keeps it open when it cannot be', async () => {
    const c = controlledSaves();
    setup({ 'notes:save': c.handler });
    render(wrap(createElement('div', null, editor(), createElement(ReaderProbe))));
    fireEvent.click(screen.getByTestId('open'));
    expect(screen.getByTestId('target').textContent).toBe(DOC);
    fireEvent.change(await box(), { target: { value: 'draft' } });
    fireEvent.click(screen.getByTestId('close'));
    await waitFor(() => expect(c.waiting).toHaveLength(1));
    expect(screen.getByTestId('target').textContent).toBe(DOC); // still open while the save runs
    await act(async () => c.waiting[0]!.fail(new AppError('IO_ERROR', 'disk')));
    await tick();
    expect(screen.getByTestId('target').textContent).toBe(DOC); // failed: stays open, text kept
    expect((await box()).value).toBe('draft');
    fireEvent.click(screen.getByTestId('close'));
    await waitFor(() => expect(c.waiting).toHaveLength(2));
    await act(async () => c.waiting[1]!.release());
    await waitFor(() => expect(screen.getByTestId('target').textContent).toBe('closed'));
  });

  it('a clean state closes the reader at once', async () => {
    setup();
    render(wrap(createElement('div', null, createElement(ReaderProbe))));
    fireEvent.click(screen.getByTestId('open'));
    fireEvent.click(screen.getByTestId('close'));
    await waitFor(() => expect(screen.getByTestId('target').textContent).toBe('closed'));
  });

  describe('window close', () => {
    const fakeWindow = () => {
      const target = new EventTarget();
      const close = vi.fn();
      return Object.assign(target, { close }) as unknown as Window & { close: ReturnType<typeof vi.fn> };
    };
    const beforeUnload = (w: Window) => {
      const e = new Event('beforeunload', { cancelable: true });
      w.dispatchEvent(e);
      return e;
    };

    it('never blocks a clean window', async () => {
      setup();
      const w = fakeWindow();
      installWindowGuard(w);
      render(wrap(editor()));
      await box();
      expect(beforeUnload(w).defaultPrevented).toBe(false);
      expect(w.close).not.toHaveBeenCalled();
    });

    it('cancels once while dirty, saves, and closes again; the second close is not blocked', async () => {
      const c = controlledSaves();
      setup({ 'notes:save': c.handler });
      const w = fakeWindow();
      installWindowGuard(w);
      render(wrap(editor()));
      fireEvent.change(await box(), { target: { value: 'last words' } });
      expect(beforeUnload(w).defaultPrevented).toBe(true);
      await waitFor(() => expect(c.waiting).toHaveLength(1));
      expect(w.close).not.toHaveBeenCalled();
      await act(async () => c.waiting[0]!.release());
      await waitFor(() => expect(w.close).toHaveBeenCalledTimes(1));
      expect(beforeUnload(w).defaultPrevented).toBe(false); // `close()` triggers it again: allowed now
    });

    it('stays open with the error shown when the save fails', async () => {
      setup({ 'notes:save': failing });
      const w = fakeWindow();
      installWindowGuard(w);
      render(wrap(editor()));
      fireEvent.change(await box(), { target: { value: 'x' } });
      expect(beforeUnload(w).defaultPrevented).toBe(true);
      await screen.findByTestId('n-save-error');
      expect(w.close).not.toHaveBeenCalled();
    });
  });
});
