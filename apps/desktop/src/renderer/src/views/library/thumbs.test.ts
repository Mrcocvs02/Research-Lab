// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryProfile } from '@rl/core';
import i18n from '../../i18n';
import { LibraryEventsProvider } from '../../lib/events';
import { HistoryProvider } from '../../lib/history';
import { NotifyProvider } from '../../lib/notify';
import { resetThumbs } from '../../lib/thumbs';
import { AppProvider } from '../../state/app-context';
import { makeDocs, memoryLibrary } from '../../testing/memoryLibrary';
import { callsTo, emitEvent, memoryBackend, setHandlers } from '../../testing/mockRl';
import { LibraryView } from './LibraryView';

vi.mock('../../lib/rl', async () => (await import('../../testing/mockRl')).rlModule);

// The drawing code (pdf.js and the canvas) is replaced: this checks the wiring of the grid.
const drawer = vi.hoisted(() => ({ draw: vi.fn(async (_url: string) => new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80, 0, 0, 0, 0])), release: vi.fn() }));
vi.mock('../../lib/thumbDraw', () => ({ drawFirstPage: drawer.draw, releaseDrawer: drawer.release }));

const profile: LibraryProfile = { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' };

function setup(docs = makeDocs(5)) {
  const lib = memoryLibrary({ docs });
  const { handlers } = memoryBackend({ profiles: [profile] });
  setHandlers({ ...handlers, ...lib.handlers });
  render(createElement(AppProvider, null, createElement(LibraryEventsProvider, null, createElement(NotifyProvider, null, createElement(HistoryProvider, null, createElement(LibraryView))))));
  return lib;
}
const rows = () => screen.queryAllByTestId('search-result');
const imgs = () => [...document.querySelectorAll<HTMLImageElement>('[data-testid="doc-thumb"] img')];

beforeEach(async () => {
  await i18n.changeLanguage('en');
  drawer.draw.mockClear();
  drawer.release.mockClear();
  resetThumbs();
  try {
    window.localStorage.clear();
  } catch {
    // no storage
  }
});
afterEach(() => {
  cleanup();
  resetThumbs();
});

describe('grid thumbnails', () => {
  it('the list view asks for nothing and draws nothing', async () => {
    setup();
    await screen.findAllByTestId('search-result');
    await new Promise((r) => setTimeout(r, 300));
    expect(callsTo('thumbs:list')).toHaveLength(0);
    expect(drawer.draw).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="doc-thumb"]')).toBeNull();
  });

  it('the grid draws the PDFs one by one, shows the image as decoration, and keeps the icon for the rest', async () => {
    const docs = makeDocs(4);
    docs[1]!.path = 'alpha/notes.docx';
    setup(docs);
    await screen.findAllByTestId('search-result');
    fireEvent.click(screen.getByTestId('view-grid'));
    await waitFor(() => expect(imgs()).toHaveLength(3), { timeout: 4000 });
    for (const img of imgs()) {
      expect(img.getAttribute('src')).toMatch(/^rl-thumb:\/\/thumb\/d\d{15}\?v=aaaaaaaa$/);
      expect(img.getAttribute('alt')).toBe('');
      expect(img.getAttribute('loading')).toBe('lazy');
    }
    expect(callsTo('thumbs:put')).toHaveLength(3);
    expect(callsTo('thumbs:put')[0]).toMatchObject({ hash: 'a'.repeat(64) });
    const byDoc = (title: string) => rows().find((r) => r.textContent?.includes(title))!;
    expect(byDoc('Paper 0001').querySelector('img')).toBeNull();
    expect(byDoc('Paper 0001').querySelector('.type-icon')?.getAttribute('data-ext')).toBe('docx');
    expect(byDoc('Paper 0000').querySelector('[data-testid="result-title"]')?.textContent).toBe('Paper 0000');
  });

  it('a thumbnail that is already cached is shown without drawing', async () => {
    const lib = setup(makeDocs(2));
    lib.state.thumbs.set('d000000000000000', 'rl-thumb://thumb/d000000000000000?v=aaaaaaaa');
    await screen.findAllByTestId('search-result');
    fireEvent.click(screen.getByTestId('view-grid'));
    await waitFor(() => expect(imgs().map((i) => i.getAttribute('src'))).toContain('rl-thumb://thumb/d000000000000000?v=aaaaaaaa'));
    await waitFor(() => expect(imgs()).toHaveLength(2));
    expect(drawer.draw).toHaveBeenCalledTimes(1); // only the other one
  });

  it('leaving the grid stops the drawing', async () => {
    setup(makeDocs(5));
    await screen.findAllByTestId('search-result');
    let release!: () => void;
    drawer.draw.mockImplementationOnce(() => new Promise((r) => (release = () => r(new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80, 0, 0, 0, 0])))));
    fireEvent.click(screen.getByTestId('view-grid'));
    await waitFor(() => expect(drawer.draw).toHaveBeenCalledTimes(1), { timeout: 4000 });
    fireEvent.click(screen.getByTestId('view-list'));
    await act(async () => release());
    await new Promise((r) => setTimeout(r, 200));
    expect(drawer.draw).toHaveBeenCalledTimes(1);
    expect(callsTo('thumbs:put')).toHaveLength(0);
  });

  it('a library event on the documents asks again for the urls on screen', async () => {
    setup(makeDocs(2));
    await screen.findAllByTestId('search-result');
    fireEvent.click(screen.getByTestId('view-grid'));
    await waitFor(() => expect(imgs()).toHaveLength(2), { timeout: 4000 });
    const before = callsTo('thumbs:list').length;
    await act(async () => emitEvent('library:changed', { kind: 'documents' }));
    await waitFor(() => expect(callsTo('thumbs:list').length).toBeGreaterThan(before), { timeout: 3000 });
    expect(imgs()).toHaveLength(2);
  });

  it('an image that cannot be loaded falls back to the type icon', async () => {
    const lib = setup(makeDocs(1));
    lib.state.thumbs.set('d000000000000000', 'rl-thumb://thumb/d000000000000000?v=aaaaaaaa');
    await screen.findAllByTestId('search-result');
    fireEvent.click(screen.getByTestId('view-grid'));
    const img = await waitFor(() => {
      const i = imgs()[0];
      expect(i).toBeTruthy();
      return i!;
    });
    fireEvent.error(img);
    await waitFor(() => expect(imgs()).toHaveLength(0));
    expect(document.querySelector('[data-testid="doc-thumb"] .type-icon')).not.toBeNull();
  });
});
