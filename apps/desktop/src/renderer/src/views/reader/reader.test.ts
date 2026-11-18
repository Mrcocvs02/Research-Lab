// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, type LibraryProfile } from '@rl/core';
import i18n from '../../i18n';
import { LibraryEventsProvider } from '../../lib/events';
import { NotifyProvider } from '../../lib/notify';
import { ReaderProvider, useReader } from '../../lib/reader';
import { AppProvider } from '../../state/app-context';
import { makeDocs, memoryLibrary } from '../../testing/memoryLibrary';
import { callsTo, memoryBackend, setHandlers } from '../../testing/mockRl';
import { LibraryView } from '../library/LibraryView';
import { annotationAt, colorOf, mergeRects, normaliseRect } from './geometry';
import { ReaderView } from './ReaderView';

vi.mock('../../lib/rl', async () => (await import('../../testing/mockRl')).rlModule);

// pdf.js never loads in these tests: the engine is replaced by a fake with the same small interface.
const fake = vi.hoisted(() => {
  const state: { handlers: any; openError: unknown } = { handlers: null, openError: null };
  const viewer = {
    open: vi.fn(async (_url: string, _page?: number) => {
      if (state.openError) throw state.openError;
      return { pages: 5 };
    }),
    goTo: vi.fn(),
    zoomBy: vi.fn(),
    fitWidth: vi.fn(),
    find: vi.fn(),
    clearFind: vi.fn(),
    readSelection: vi.fn((): any => ({ pieces: [], skipped: 0 })),
    readFindMatch: vi.fn((): any => ({ pieces: [], skipped: 0 })),
    pointAt: vi.fn((): any => null),
    locateText: vi.fn(async (): Promise<any> => ({ status: 'none' })),
    destroy: vi.fn(),
  };
  const createViewer = vi.fn(async (_c: unknown, _v: unknown, handlers: unknown) => {
    state.handlers = handlers;
    return viewer;
  });
  class ViewerError extends Error {
    kind: string;
    constructor(kind: string) {
      super(kind);
      this.kind = kind;
    }
  }
  return { state, viewer, createViewer, ViewerError };
});
vi.mock('./engine', () => ({ createViewer: fake.createViewer, ViewerError: fake.ViewerError }));

const profile: LibraryProfile = { id: 'lib-a', name: 'Alpha', rootPath: '/tmp/a', dataDirName: '.lab', createdAt: '2026-01-01T00:00:00.000Z' };
const DOC = 'd000000000000000';

function wrap(child: ReactElement) {
  return createElement(AppProvider, null, createElement(LibraryEventsProvider, null, createElement(NotifyProvider, null, createElement(ReaderProvider, null, child))));
}

function setup(init: Parameters<typeof memoryLibrary>[0] = {}, override: Record<string, (p: any) => unknown> = {}, prep: (lib: ReturnType<typeof memoryLibrary>) => void = () => {}) {
  const lib = memoryLibrary({ docs: makeDocs(3), ...init });
  prep(lib);
  const { handlers } = memoryBackend({ profiles: [profile] });
  setHandlers({ ...handlers, ...lib.handlers, ...override });
  const onClose = vi.fn();
  render(wrap(createElement(ReaderView, { target: { docId: DOC, nonce: 1 }, onClose })));
  return { lib, onClose };
}

async function ready() {
  await waitFor(() => expect(fake.viewer.open).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByTestId('reader-loading')).toBeNull());
}

/** What the real viewer does when a page is drawn: an overlay element appears for it. */
function drawLayer(page: number): HTMLElement {
  const el = document.createElement('div');
  document.body.append(el);
  act(() => fake.state.handlers.onLayer(page, el));
  return el;
}

const SEL = [{ page: 2, text: 'selected words', rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.02 }] }];
async function select(pieces = SEL, skipped = 0) {
  fake.viewer.readSelection.mockReturnValue({ pieces, skipped });
  act(() => void document.dispatchEvent(new Event('selectionchange')));
  await screen.findByTestId('annotation-bar', undefined, { timeout: 2000 });
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  fake.state.openError = null;
  fake.state.handlers = null;
  for (const f of Object.values(fake.viewer)) f.mockClear();
  fake.viewer.readSelection.mockReturnValue({ pieces: [], skipped: 0 });
  fake.viewer.readFindMatch.mockReturnValue({ pieces: [], skipped: 0 });
  fake.viewer.pointAt.mockReturnValue(null);
  fake.createViewer.mockClear();
  try {
    window.localStorage.clear();
  } catch {
    // no storage
  }
});
afterEach(() => cleanup());

describe('geometry', () => {
  it('normalises client rectangles to the page and drops the ones that are not a line of text', () => {
    const frame = { left: 100, top: 50, width: 400, height: 800 };
    const r = normaliseRect({ left: 140, top: 130, width: 120, height: 16 }, frame)!;
    expect([r.x, r.y, r.w, r.h].map((n) => Math.round(n * 1e6) / 1e6)).toEqual([0.1, 0.1, 0.3, 0.02]);
    expect(normaliseRect({ left: 100, top: 50, width: 400, height: 800 }, frame)).toBeNull(); // the whole page
    expect(normaliseRect({ left: 140, top: 130, width: 0, height: 16 }, frame)).toBeNull();
    expect(normaliseRect({ left: 0, top: 0, width: 10, height: 10 }, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });

  it('merges the pieces of a line and keeps lines apart', () => {
    const merged = mergeRects([
      { x: 0.1, y: 0.1, w: 0.1, h: 0.02 },
      { x: 0.2, y: 0.1, w: 0.1, h: 0.02 },
      { x: 0.1, y: 0.2, w: 0.2, h: 0.02 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.w).toBeCloseTo(0.2);
    expect(mergeRects(Array.from({ length: 300 }, (_, i) => ({ x: 0, y: i / 400, w: 0.1, h: 0.001 })), 200)).toHaveLength(200);
  });

  it('finds the smallest annotation under a point and ignores unknown colours', () => {
    const base = { kind: 'highlight' as const, text: '', createdAt: '', updatedAt: '' };
    const big = { ...base, id: 'big', page: 1, rects: [{ x: 0, y: 0, w: 1, h: 1 }], color: 'yellow' };
    const small = { ...base, id: 'small', page: 1, rects: [{ x: 0.4, y: 0.4, w: 0.1, h: 0.1 }], color: 'blue' };
    expect(annotationAt([big, small], 1, 0.45, 0.45)?.id).toBe('small');
    expect(annotationAt([big, small], 2, 0.45, 0.45)).toBeUndefined();
    expect(colorOf('red; background:url(x)')).toBe('yellow');
    expect(colorOf('pink')).toBe('pink');
  });
});

describe('lazy loading', () => {
  it('keeps pdf.js and the reader out of the first screen', () => {
    const root = path.resolve(import.meta.dirname, '..', '..');
    const app = readFileSync(path.join(root, 'App.tsx'), 'utf8');
    expect(app).not.toMatch(/^import .*views\/reader/m);
    expect(app).toMatch(/lazy(?:Retry|View)\(\(\) => import\('\.\/views\/reader\/ReaderView'\)/);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name) && !name.endsWith('.test.ts') && /from 'pdfjs-dist|import\('pdfjs-dist|pdfjs-dist\/[^']*'/.test(readFileSync(full, 'utf8'))) offenders.push(path.relative(root, full).replaceAll('\\', '/'));
      }
    };
    walk(root);
    // The shared set-up (also used by the thumbnail drawer) and the reader engine: both only reached through dynamic imports.
    expect(offenders).toEqual(['lib/pdfjs.ts', 'views/reader/engine.ts']);
    // The thumbnail drawer (and so pdf.js) is fetched by a dynamic import only, when something must be drawn.
    const store = readFileSync(path.join(root, 'lib', 'thumbs.ts'), 'utf8');
    expect(store).not.toMatch(/^import .*thumbDraw/m);
    expect(store).toMatch(/import\('\.\/thumbDraw'\)/);
  });
});

describe('ReaderView: opening and errors', () => {
  it('asks for the document URL and hands it to the viewer', async () => {
    setup();
    await ready();
    expect(callsTo('reader:open')).toEqual([{ docId: DOC }]);
    expect(fake.viewer.open).toHaveBeenCalledWith(`rl-doc://doc/${DOC}?v=aaaaaaaa`, undefined);
    expect(screen.getByTestId('reader-title').textContent).toContain('Paper 0000');
    act(() => fake.state.handlers.onPages(5));
    expect(screen.getByTestId('reader-pages').textContent).toBe('of 5');
  });

  it('shows a clear, localised error for a file that is not a PDF, is missing, encrypted or damaged', async () => {
    const cases: Array<[string, () => void, RegExp]> = [
      ['not-pdf', () => void 0, /Only PDF files/],
      ['missing', () => void 0, /not found/],
    ];
    for (const [reason, , text] of cases) {
      const lib = memoryLibrary({ docs: makeDocs(1) });
      lib.state.readerRefusal.set(DOC, reason);
      setHandlers({ ...memoryBackend({ profiles: [profile] }).handlers, ...lib.handlers });
      render(wrap(createElement(ReaderView, { target: { docId: DOC, nonce: 1 }, onClose: vi.fn() })));
      expect((await screen.findByTestId('reader-error')).textContent).toMatch(text);
      expect(fake.createViewer).not.toHaveBeenCalled();
      cleanup();
    }
    for (const [kind, text] of [
      ['encrypted', /password/],
      ['invalid', /not a valid PDF/],
      ['failed', /could not be opened/],
    ] as const) {
      fake.state.openError = new fake.ViewerError(kind);
      setup({ docs: makeDocs(1) });
      expect((await screen.findByTestId('reader-error')).textContent).toMatch(text);
      expect(screen.getByTestId('reader-error').getAttribute('data-kind')).toBe(kind);
      cleanup();
    }
  });

  it('opens an external link through the main process only when the viewer reports a click', async () => {
    setup();
    await ready();
    expect(callsTo('reader:openLink')).toEqual([]);
    act(() => fake.state.handlers.onExternalLink('https://example.org/x'));
    await waitFor(() => expect(callsTo('reader:openLink')).toEqual([{ url: 'https://example.org/x' }]));
  });

  it('navigates by buttons, the page box and the keyboard, zooms, and finds', async () => {
    const { onClose } = setup();
    await ready();
    act(() => fake.state.handlers.onPages(5));
    act(() => fake.state.handlers.onPage(2));
    fireEvent.click(screen.getByTestId('reader-next'));
    expect(fake.viewer.goTo).toHaveBeenLastCalledWith(3, undefined);
    fireEvent.click(screen.getByTestId('reader-prev'));
    expect(fake.viewer.goTo).toHaveBeenLastCalledWith(1, undefined);
    fireEvent.change(screen.getByTestId('reader-page-input'), { target: { value: '4' } });
    fireEvent.keyDown(screen.getByTestId('reader-page-input'), { key: 'Enter' });
    expect(fake.viewer.goTo).toHaveBeenLastCalledWith(4, undefined);
    fireEvent.keyDown(screen.getByTestId('reader-pages-area'), { key: 'n' });
    expect(fake.viewer.goTo).toHaveBeenLastCalledWith(3, undefined);
    fireEvent.click(screen.getByTestId('reader-zoom-in'));
    expect(fake.viewer.zoomBy).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(screen.getByTestId('reader-pages-area'), { key: '-', ctrlKey: true });
    expect(fake.viewer.zoomBy).toHaveBeenLastCalledWith(-1);
    fireEvent.click(screen.getByTestId('reader-fit'));
    expect(fake.viewer.fitWidth).toHaveBeenCalled();

    fireEvent.keyDown(screen.getByTestId('reader-pages-area'), { key: 'f', ctrlKey: true });
    const input = await screen.findByTestId('reader-find-input');
    fireEvent.change(input, { target: { value: 'needle' } });
    await waitFor(() => expect(fake.viewer.find).toHaveBeenCalledWith('needle'), { timeout: 2000 });
    act(() => fake.state.handlers.onFind({ state: 'found', current: 1, total: 4 }));
    expect(screen.getByTestId('reader-find-count').textContent).toBe('1 of 4');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(fake.viewer.find).toHaveBeenLastCalledWith('needle', { again: true, backwards: true });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('reader-find')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId('reader-pages-area'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

const mkAnn = (id: string, page: number) => ({ id, kind: 'highlight' as const, page, rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.02 }], text: `text ${id}`, color: 'yellow', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });

describe('ReaderView: annotations', () => {
  it('creates a highlight from a selection with colour and comment, and draws it on the page', async () => {
    setup();
    await ready();
    const layer = drawLayer(2);
    await select();
    fireEvent.click(screen.getByTestId('ann-color-green'));
    fireEvent.change(screen.getByTestId('ann-comment'), { target: { value: 'check this' } });
    fireEvent.click(screen.getByTestId('ann-highlight'));
    await waitFor(() => expect(callsTo('annotations:save')).toHaveLength(1));
    expect(callsTo('annotations:save')[0]).toEqual({
      docId: DOC,
      annotation: { kind: 'highlight', page: 2, rects: SEL[0]!.rects, text: 'selected words', color: 'green', geom: 2, comment: 'check this' },
    });
    await waitFor(() => expect(layer.querySelectorAll('[data-testid="annotation-mark"]')).toHaveLength(1));
    const mark = layer.querySelector<HTMLElement>('[data-testid="annotation-mark"]')!;
    expect(mark.className).toContain('ann-green');
    expect(mark.style.left).toBe('10%');
    expect(screen.queryByTestId('annotation-bar')).toBeNull();
    expect(screen.getAllByTestId('annotation-item')).toHaveLength(1);
    // The flag the write reported is shown.
    expect(screen.getByTestId('reader-underlined')).toHaveProperty('checked', true);
    expect(screen.getByTestId('reader-underlined-origin').getAttribute('data-origin')).toBe('annotations');
  });

  it('creates an underline, and one annotation per page for a selection across pages', async () => {
    setup();
    await ready();
    await select([...SEL, { page: 3, text: 'more words', rects: [{ x: 0.1, y: 0.1, w: 0.5, h: 0.02 }] }]);
    fireEvent.click(screen.getByTestId('ann-underline'));
    await waitFor(() => expect(callsTo('annotations:save')).toHaveLength(2));
    expect(callsTo('annotations:save').map((c) => [c.annotation.kind, c.annotation.page])).toEqual([['underline', 2], ['underline', 3]]);
  });

  it('edits the colour and comment of an annotation that was clicked, and deletes it', async () => {
    setup({}, {}, (lib) => lib.state.annotations.set(DOC, [{ id: 'a1', kind: 'highlight', page: 2, rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.02 }], text: 'old text', color: 'yellow', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }]));
    await ready();
    await screen.findAllByTestId('annotation-item');
    fake.viewer.pointAt.mockReturnValue({ page: 2, x: 0.2, y: 0.21 });
    fireEvent.click(screen.getByTestId('reader-pages-area'));
    const bar = await screen.findByTestId('annotation-bar');
    expect(bar.getAttribute('data-mode')).toBe('edit');
    fireEvent.click(screen.getByTestId('ann-color-pink'));
    await waitFor(() => expect(callsTo('annotations:save')).toHaveLength(1));
    expect(callsTo('annotations:save')[0].annotation).toMatchObject({ id: 'a1', color: 'pink', kind: 'highlight', text: 'old text' });
    fireEvent.change(screen.getByTestId('ann-comment'), { target: { value: 'because' } });
    fireEvent.click(screen.getByTestId('ann-save-comment'));
    await waitFor(() => expect(callsTo('annotations:save')).toHaveLength(2));
    expect(callsTo('annotations:save')[1].annotation).toMatchObject({ id: 'a1', comment: 'because', color: 'pink' });
    fireEvent.click(screen.getByTestId('ann-delete'));
    await waitFor(() => expect(callsTo('annotations:remove')).toEqual([{ docId: DOC, id: 'a1' }]));
    await waitFor(() => expect(screen.queryByTestId('annotation-bar')).toBeNull());
    expect(screen.getByTestId('annotation-empty')).toBeTruthy();
    expect(screen.getByTestId('reader-underlined')).toHaveProperty('checked', false);
  });

  it('lists annotations by page and jumps to one', async () => {
    const mk = (id: string, page: number) => ({ id, kind: 'underline' as const, page, rects: [{ x: 0.1, y: 0.5, w: 0.3, h: 0.02 }], text: `text ${id}`, color: 'blue', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    setup({}, {}, (lib) => lib.state.annotations.set(DOC, [mk('b', 4), mk('a', 1)]));
    await ready();
    const items = await screen.findAllByTestId('annotation-item');
    expect(items.map((i) => i.getAttribute('data-annotation-id'))).toEqual(['a', 'b']);
    fireEvent.click(items[1]!);
    expect(fake.viewer.goTo).toHaveBeenLastCalledWith(4, 0.5);
    expect((await screen.findByTestId('annotation-bar')).getAttribute('data-mode')).toBe('edit');
  });

  it('warns when the file changed since the annotations were made', async () => {
    setup({}, {}, (lib) => {
      lib.state.stale.add(DOC);
      lib.state.annotations.set(DOC, [mkAnn('a1', 2)]);
    });
    await ready();
    expect((await screen.findByTestId('reader-stale')).textContent).toMatch(/changed after/);
  });

  it('marks each misplaced annotation, and re-confirming one saves it again and clears only that one', async () => {
    setup({}, {}, (lib) => {
      lib.state.stale.add(DOC);
      lib.state.annotations.set(DOC, [mkAnn('a1', 2), mkAnn('a2', 3)]);
    });
    await ready();
    const layer = drawLayer(2);
    await waitFor(() => expect(screen.getAllByTestId('annotation-stale')).toHaveLength(2));
    await waitFor(() => expect(layer.querySelector('[data-testid="annotation-mark"]')?.getAttribute('data-stale')).toBe('true'));
    expect(layer.querySelector('[data-testid="annotation-mark"]')?.getAttribute('title')).toMatch(/misplaced/);
    fireEvent.click(screen.getAllByTestId('annotation-item')[0]!);
    const bar = await screen.findByTestId('annotation-bar');
    expect(bar.querySelector('[data-testid="ann-stale"]')).not.toBeNull();
    fireEvent.click(screen.getByTestId('ann-reconfirm'));
    await waitFor(() => expect(callsTo('annotations:save')).toHaveLength(1));
    expect(callsTo('annotations:save')[0].annotation).toMatchObject({ id: 'a1', kind: 'highlight', page: 2, text: 'text a1' });
    await waitFor(() => expect(screen.getAllByTestId('annotation-stale')).toHaveLength(1));
    expect(screen.getByTestId('reader-stale')).toBeTruthy(); // a2 is still in doubt
    expect(screen.queryByTestId('ann-reconfirm')).toBeNull(); // a1 is fine now
    fireEvent.click(screen.getAllByTestId('annotation-item')[1]!);
    fireEvent.click(await screen.findByTestId('ann-reconfirm'));
    await waitFor(() => expect(screen.queryByTestId('reader-stale')).toBeNull());
    expect(screen.queryAllByTestId('annotation-stale')).toHaveLength(0);
  });

  it('saves a comment that was typed when the bar is closed with Escape or the close button', async () => {
    setup({}, {}, (lib) => lib.state.annotations.set(DOC, [mkAnn('a1', 2)]));
    await ready();
    await screen.findAllByTestId('annotation-item');
    fake.viewer.pointAt.mockReturnValue({ page: 2, x: 0.2, y: 0.21 });
    fireEvent.click(screen.getByTestId('reader-pages-area'));
    const input = await screen.findByTestId('ann-comment');
    fireEvent.change(input, { target: { value: 'typed, never blurred' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(callsTo('annotations:save')).toHaveLength(1));
    expect(callsTo('annotations:save')[0].annotation).toMatchObject({ id: 'a1', comment: 'typed, never blurred' });
    await waitFor(() => expect(screen.queryByTestId('annotation-bar')).toBeNull());

    // The close button does the same; an unchanged comment sends nothing.
    fireEvent.click(screen.getByTestId('reader-pages-area'));
    const again = await screen.findByTestId('ann-comment');
    await waitFor(() => expect((again as HTMLInputElement).value).toBe('typed, never blurred'));
    fireEvent.click(screen.getByTestId('ann-close'));
    await waitFor(() => expect(screen.queryByTestId('annotation-bar')).toBeNull());
    expect(callsTo('annotations:save')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('reader-pages-area'));
    fireEvent.change(await screen.findByTestId('ann-comment'), { target: { value: 'edited again' } });
    fireEvent.click(screen.getByTestId('ann-close'));
    await waitFor(() => expect(callsTo('annotations:save')).toHaveLength(2));
    expect(callsTo('annotations:save')[1].annotation.comment).toBe('edited again');
  });

  it('does not send the same comment twice when the box blurs and the bar closes', async () => {
    setup({}, {}, (lib) => lib.state.annotations.set(DOC, [mkAnn('a1', 2)]));
    await ready();
    await screen.findAllByTestId('annotation-item');
    fake.viewer.pointAt.mockReturnValue({ page: 2, x: 0.2, y: 0.21 });
    fireEvent.click(screen.getByTestId('reader-pages-area'));
    const input = await screen.findByTestId('ann-comment');
    fireEvent.change(input, { target: { value: 'once' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByTestId('ann-close'));
    await waitFor(() => expect(screen.queryByTestId('annotation-bar')).toBeNull());
    expect(callsTo('annotations:save')).toHaveLength(1);
  });

  it('stops at the first page that fails, keeps the bar with the pages not saved, and a retry saves only those', async () => {
    let calls = 0;
    let real: ((p: any) => unknown) | undefined;
    const { lib } = setup(
      {},
      {
        'annotations:save': (p: any) => {
          calls++;
          if (calls === 2) throw new AppError('IO_ERROR', 'disk');
          return real!(p);
        },
      },
    );
    real = lib.handlers['annotations:save'] as (p: any) => unknown;
    const pieces = [2, 3, 4].map((page) => ({ page, text: `words on ${page}`, rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.02 }] }));
    await ready();
    await select(pieces);
    fireEvent.click(screen.getByTestId('ann-highlight'));
    await waitFor(() => expect(callsTo('annotations:save')).toHaveLength(2));
    await waitFor(() => expect((screen.getByTestId('ann-highlight') as HTMLButtonElement).disabled).toBe(false));
    expect(callsTo('annotations:save')).toHaveLength(2); // page 4 was not tried
    expect(screen.getByTestId('annotation-bar').getAttribute('data-mode')).toBe('new');
    expect(screen.getByTestId('ann-text').textContent).toBe('words on 3 … words on 4'); // page 2 is saved
    expect(screen.getByTestId('toasts').textContent).toMatch(/Stopped at page 3/);
    expect(lib.state.annotations.get(DOC)).toHaveLength(1);
    fireEvent.click(screen.getByTestId('ann-highlight'));
    await waitFor(() => expect(screen.queryByTestId('annotation-bar')).toBeNull());
    expect(callsTo('annotations:save').map((c) => c.annotation.page)).toEqual([2, 3, 3, 4]);
    expect(lib.state.annotations.get(DOC)).toHaveLength(3);
  });

  it('tells the user when pages of the selection were not drawn yet and were left out', async () => {
    setup();
    await ready();
    await select(SEL, 2);
    expect(screen.getByTestId('ann-skipped').textContent).toMatch(/2 pages of the selection were not loaded/);
    fireEvent.click(screen.getByTestId('ann-close'));
    await select(SEL, 1);
    expect(screen.getByTestId('ann-skipped').textContent).toMatch(/1 page of the selection was not loaded/);
    fireEvent.click(screen.getByTestId('ann-close'));
    await select(SEL, 0);
    expect(screen.queryByTestId('ann-skipped')).toBeNull();
  });

  describe('from a find match (keyboard path)', () => {
    const MATCH = { pieces: [{ page: 3, text: 'the match', rects: [{ x: 0.2, y: 0.3, w: 0.1, h: 0.02 }] }], skipped: 0 };
    const openFindWithMatch = async () => {
      await ready();
      fireEvent.keyDown(screen.getByTestId('reader-pages-area'), { key: 'f', ctrlKey: true });
      const input = await screen.findByTestId('reader-find-input');
      fireEvent.change(input, { target: { value: 'match' } });
      act(() => fake.state.handlers.onFind({ state: 'found', current: 1, total: 2 }));
      return input;
    };

    it('creates a highlight or underline from the current match with the buttons', async () => {
      setup();
      fake.viewer.readFindMatch.mockReturnValue(MATCH);
      await openFindWithMatch();
      fireEvent.click(screen.getByTestId('reader-find-highlight'));
      await waitFor(() => expect(callsTo('annotations:save')).toHaveLength(1));
      expect(callsTo('annotations:save')[0]).toEqual({ docId: DOC, annotation: { kind: 'highlight', page: 3, rects: MATCH.pieces[0]!.rects, text: 'the match', color: 'yellow', geom: 2 } });
      fireEvent.click(screen.getByTestId('reader-find-underline'));
      await waitFor(() => expect(callsTo('annotations:save')).toHaveLength(2));
      expect(callsTo('annotations:save')[1].annotation.kind).toBe('underline');
    });

    it('has a shortcut for each, working from the find box', async () => {
      setup();
      fake.viewer.readFindMatch.mockReturnValue(MATCH);
      const input = await openFindWithMatch();
      fireEvent.keyDown(input, { key: 'H', ctrlKey: true, shiftKey: true });
      await waitFor(() => expect(callsTo('annotations:save')).toHaveLength(1));
      expect(callsTo('annotations:save')[0].annotation.kind).toBe('highlight');
      fireEvent.keyDown(input, { key: 'U', ctrlKey: true, shiftKey: true });
      await waitFor(() => expect(callsTo('annotations:save')).toHaveLength(2));
      expect(callsTo('annotations:save')[1].annotation.kind).toBe('underline');
    });

    it('says so when there is no current match and saves nothing', async () => {
      setup();
      const input = await openFindWithMatch();
      fireEvent.keyDown(input, { key: 'H', ctrlKey: true, shiftKey: true });
      await waitFor(() => expect(screen.getByTestId('toasts').textContent).toMatch(/no current match/));
      expect(callsTo('annotations:save')).toHaveLength(0);
    });

    it('the shortcut does nothing while the find box is closed', async () => {
      setup();
      fake.viewer.readFindMatch.mockReturnValue(MATCH);
      await ready();
      fireEvent.keyDown(screen.getByTestId('reader-pages-area'), { key: 'H', ctrlKey: true, shiftKey: true });
      expect(callsTo('annotations:save')).toHaveLength(0);
    });
  });
});

describe('ReaderView: study state and underlined flag', () => {
  it('changes the study state and the underlined flag through documents:update', async () => {
    setup({ docs: makeDocs(1).map((d) => ({ ...d, underlined: true, underlinedOrigin: 'manual' as const })) });
    await ready();
    await waitFor(() => expect(screen.getByTestId('reader-study-to-read')).toHaveProperty('checked', true));
    expect(screen.getByTestId('reader-underlined-origin').getAttribute('data-origin')).toBe('manual');
    fireEvent.click(screen.getByTestId('reader-study-reading'));
    await waitFor(() => expect(screen.getByTestId('reader-study-reading')).toHaveProperty('checked', true));
    expect(callsTo('documents:update')[0]).toMatchObject({ docId: DOC, patch: { studyState: 'reading' } });
    fireEvent.click(screen.getByTestId('reader-underlined'));
    await waitFor(() => expect(callsTo('documents:update')[1]).toMatchObject({ patch: { underlined: false } }));
  });
});

describe('Notes in the reader', () => {
  const openPageNote = async () => {
    await ready();
    fireEvent.click(screen.getByTestId('reader-tab-pageNote'));
    return screen.findByTestId('note-page-input');
  };

  it('saves the note of the current page on demand and when the box loses the focus', async () => {
    const { lib } = setup();
    const box = await openPageNote();
    fireEvent.change(box, { target: { value: '# Idea' } });
    fireEvent.click(screen.getByTestId('note-page-save'));
    await waitFor(() => expect(callsTo('notes:save')).toHaveLength(1));
    expect(callsTo('notes:save')[0]).toEqual({ docId: DOC, page: 1, body: '# Idea', expectedUpdatedAt: null });
    await waitFor(() => expect(screen.getByTestId('note-page-state').textContent).toBe('Saved'));
    expect(lib.state.notes.get(`${DOC}|1`)?.body).toBe('# Idea');
    fireEvent.change(box, { target: { value: '# Idea 2' } });
    fireEvent.blur(box);
    await waitFor(() => expect(callsTo('notes:save')).toHaveLength(2));
    expect(callsTo('notes:save')[1].expectedUpdatedAt).not.toBeNull();
  });

  it('saves unsaved typing when the editor goes away', async () => {
    const { lib } = setup();
    const box = await openPageNote();
    fireEvent.change(box, { target: { value: 'half a thought' } });
    cleanup();
    await waitFor(() => expect(lib.state.notes.get(`${DOC}|1`)?.body).toBe('half a thought'));
  });

  it('removes the note when the text is blank', async () => {
    const { lib } = setup();
    lib.state.notes.set(`${DOC}|1`, { body: 'old', createdAt: '2026-01-01T00:00:01.000Z', updatedAt: '2026-01-01T00:00:01.000Z' });
    const box = await openPageNote();
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe('old'));
    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('note-page-save'));
    await waitFor(() => expect(lib.state.notes.has(`${DOC}|1`)).toBe(false));
  });

  it('keeps the text on a conflict and offers the other version or the user’s own', async () => {
    const { lib } = setup();
    lib.state.notes.set(`${DOC}|1`, { body: 'v1', createdAt: '2026-01-01T00:00:01.000Z', updatedAt: '2026-01-01T00:00:01.000Z' });
    const box = (await openPageNote()) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toBe('v1'));
    // Another window changes the note while this one is open.
    lib.state.notes.set(`${DOC}|1`, { body: 'theirs', createdAt: '2026-01-01T00:00:01.000Z', updatedAt: '2026-01-01T00:00:09.000Z' });
    fireEvent.change(box, { target: { value: 'mine' } });
    fireEvent.click(screen.getByTestId('note-page-save'));
    await screen.findByTestId('note-page-conflict');
    expect(box.value).toBe('mine');
    expect(lib.state.notes.get(`${DOC}|1`)?.body).toBe('theirs');

    fireEvent.click(screen.getByTestId('note-page-reload-theirs'));
    await waitFor(() => expect(box.value).toBe('theirs'));
    expect(screen.queryByTestId('note-page-conflict')).toBeNull();

    // Again, and this time keep mine: the save re-reads updatedAt and succeeds.
    lib.state.notes.set(`${DOC}|1`, { body: 'theirs 2', createdAt: '2026-01-01T00:00:01.000Z', updatedAt: '2026-01-01T00:00:19.000Z' });
    fireEvent.change(box, { target: { value: 'mine 2' } });
    fireEvent.click(screen.getByTestId('note-page-save'));
    await screen.findByTestId('note-page-conflict');
    fireEvent.click(screen.getByTestId('note-page-keep-mine'));
    await waitFor(() => expect(lib.state.notes.get(`${DOC}|1`)?.body).toBe('mine 2'));
    expect(callsTo('notes:save').at(-1).expectedUpdatedAt).toBe('2026-01-01T00:00:19.000Z');
    expect(screen.queryByTestId('note-page-conflict')).toBeNull();
  });

  it('edits the file note and lists every note, each going to its page', async () => {
    setup({}, {}, (lib) => {
      lib.state.notes.set(`${DOC}|0`, { body: 'whole file', createdAt: '2026-01-01T00:00:01.000Z', updatedAt: '2026-01-01T00:00:01.000Z' });
      lib.state.notes.set(`${DOC}|3`, { body: 'on page three', createdAt: '2026-01-01T00:00:02.000Z', updatedAt: '2026-01-01T00:00:02.000Z' });
    });
    await ready();
    fireEvent.click(screen.getByTestId('reader-tab-notes'));
    const items = await screen.findAllByTestId('notes-list-item');
    expect(items.map((i) => i.getAttribute('data-page'))).toEqual(['', '3']);
    fireEvent.click(items[1]!);
    expect(fake.viewer.goTo).toHaveBeenLastCalledWith(3, undefined);
    act(() => fake.state.handlers.onPage(3)); // the real viewer reports the page it scrolled to
    await waitFor(() => expect((screen.getByTestId('note-page-input') as HTMLTextAreaElement).value).toBe('on page three'));
    fireEvent.click(screen.getByTestId('reader-tab-fileNote'));
    await waitFor(() => expect((screen.getByTestId('note-file-input') as HTMLTextAreaElement).value).toBe('whole file'));
  });

  it('shows the Markdown preview without interpreting HTML', async () => {
    setup();
    const box = await openPageNote();
    fireEvent.change(box, { target: { value: '**bold** <img src=x onerror=alert(1)>' } });
    fireEvent.click(screen.getByTestId('note-page-layout-preview'));
    const preview = await screen.findByTestId('note-page-preview');
    await waitFor(() => expect(preview.querySelector('strong')?.textContent).toBe('bold'));
    expect(preview.querySelector('img')).toBeNull();
  });

  it('reports a failing save instead of losing the text', async () => {
    setup({}, { 'notes:save': () => { throw new AppError('IO_ERROR', 'disk'); } });
    const box = (await openPageNote()) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'keep me' } });
    fireEvent.click(screen.getByTestId('note-page-save'));
    await waitFor(() => expect(screen.getByTestId('note-page-state').textContent).toBe('Unsaved changes'));
    expect(box.value).toBe('keep me');
  });
});

describe('Opening the reader from the library and the search', () => {
  function Probe() {
    const { target } = useReader();
    return createElement('p', { 'data-testid': 'probe' }, target ? `${target.docId}|${target.page ?? ''}|${target.panel ?? ''}` : 'closed');
  }
  const library = (lib: ReturnType<typeof memoryLibrary>) => {
    const { handlers } = memoryBackend({ profiles: [profile] });
    setHandlers({ ...handlers, ...lib.handlers });
    render(wrap(createElement('div', null, createElement(LibraryView), createElement(Probe))));
  };

  it('has a Read action on PDF rows only', async () => {
    const docs = makeDocs(2);
    docs[1]!.path = 'alpha/notes.txt';
    library(memoryLibrary({ docs }));
    const rows = await screen.findAllByTestId('search-result');
    expect(rows[0]!.querySelector('[data-testid="row-read"]')).not.toBeNull();
    expect(rows[1]!.querySelector('[data-testid="row-read"]')).toBeNull();
    fireEvent.click(rows[0]!.querySelector('[data-testid="row-read"]')!);
    expect(screen.getByTestId('probe').textContent).toBe(`${docs[0]!.docId}||`);
  });

  it('labels a hit found in the notes or highlights and opens the reader at its page', async () => {
    const lib = memoryLibrary({ docs: makeDocs(2) });
    lib.state.hitExtra.set(makeDocs(2)[0]!.docId, { field: 'note', page: 3, snippet: 'a \u0001marked\u0002 word' });
    lib.state.hitExtra.set(makeDocs(2)[1]!.docId, { field: 'annotation', page: 5, snippet: 'in a \u0001mark\u0002' });
    library(lib);
    await screen.findAllByTestId('search-result');
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'paper' } });
    await waitFor(() => expect(screen.getAllByTestId('hit-field')).toHaveLength(2));
    const labels = screen.getAllByTestId('hit-field');
    expect(labels.map((l) => [l.getAttribute('data-field'), l.textContent])).toEqual([
      ['note', 'in your notes'],
      ['annotation', 'in highlights'],
    ]);
    fireEvent.click(labels[0]!);
    expect(screen.getByTestId('probe').textContent).toBe(`${makeDocs(2)[0]!.docId}|3|pageNote`);
    fireEvent.click(labels[1]!);
    expect(screen.getByTestId('probe').textContent).toBe(`${makeDocs(2)[1]!.docId}|5|annotations`);
  });
});

describe('The document card', () => {
  it('has a Read button, the file note and the underlined origin', async () => {
    const docs = makeDocs(2).map((d, i) => ({ ...d, underlined: i === 0, underlinedOrigin: 'annotations' as const }));
    const lib = memoryLibrary({ docs });
    const { handlers } = memoryBackend({ profiles: [profile] });
    setHandlers({ ...handlers, ...lib.handlers });
    function Probe() {
      const { target } = useReader();
      return createElement('p', { 'data-testid': 'probe' }, target ? target.docId : 'closed');
    }
    render(wrap(createElement('div', null, createElement(LibraryView), createElement(Probe))));
    const rows = await screen.findAllByTestId('search-result');
    fireEvent.click(rows[0]!);
    fireEvent.click(await screen.findByTestId('selection-details'));
    await screen.findByTestId('doc-panel');
    expect((await screen.findByTestId('underlined-origin')).getAttribute('data-origin')).toBe('annotations');
    const box = await screen.findByTestId('card-note-input');
    fireEvent.change(box, { target: { value: 'file note from the card' } });
    fireEvent.click(screen.getByTestId('card-note-save'));
    await waitFor(() => expect(lib.state.notes.get(`${docs[0]!.docId}|0`)?.body).toBe('file note from the card'));
    expect(callsTo('notes:save')[0]).toEqual({ docId: docs[0]!.docId, body: 'file note from the card', expectedUpdatedAt: null });
    fireEvent.click(screen.getByTestId('open-reader'));
    expect(screen.getByTestId('probe').textContent).toBe(docs[0]!.docId);
  });
});
