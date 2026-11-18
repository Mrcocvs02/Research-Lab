import { loadPdfjs, pdfDocumentParams } from '../../lib/pdfjs';
import './pdfjs-viewer.css';
import { dominantPage, type Rect } from './geometry';
import { locateInTextLayer } from './repair';
import { readFindMatch, readRange, type SelectionRead } from './selection';
import { contextAround, cutCanvas, pickText, type CropImage, type TextItem } from './crop';

export type { SelectionPiece, SelectionRead } from './selection';

/**
 * The only module that touches pdf.js. It is imported by the reader view, which is itself a lazy chunk, so pdf.js is
 * fetched only when a document is opened; the two pdf.js libraries are dynamic imports inside `createViewer`.
 * Everything the React side needs is the small `Viewer` interface below (tests replace this module with a fake).
 */

export type ViewerErrorKind = 'encrypted' | 'invalid' | 'missing' | 'failed';
export class ViewerError extends Error {
  readonly kind: ViewerErrorKind;
  constructor(kind: ViewerErrorKind) {
    super(kind);
    this.name = 'ViewerError';
    this.kind = kind;
  }
}

/** Where a quote was found on a page: its rectangles (fractions of the page), or why it was not placed. */
export type Located = { status: 'found'; rects: Rect[]; text: string } | { status: 'ambiguous' } | { status: 'none' };

export interface FindState {
  state: 'idle' | 'found' | 'notfound' | 'pending' | 'wrapped';
  current: number;
  total: number;
}

export interface ViewerHandlers {
  onPages(count: number): void;
  onPage(page: number): void;
  onZoom(percent: number, fit: boolean): void;
  /** The overlay element of a page that was just drawn (the host of its annotations); it is recreated when the page is redrawn. */
  onLayer(page: number, element: HTMLElement): void;
  onFind(state: FindState): void;
  /** A link to a web page was clicked by the user. */
  onExternalLink(url: string): void;
}

export interface Viewer {
  open(url: string, page?: number): Promise<{ pages: number }>;
  goTo(page: number, y?: number): void;
  zoomBy(direction: 1 | -1): void;
  fitWidth(): void;
  /** A fixed zoom (a fraction, 1 = 100 %) or the whole page in the window. */
  zoomTo(value: number | 'page-fit'): void;
  find(query: string, opts?: { again?: boolean; backwards?: boolean }): void;
  clearFind(): void;
  /** The selected text of the document, split by page; `skipped` counts pages of the selection whose text is not drawn yet. */
  readSelection(): SelectionRead;
  /** The current find match (the one pdf.js marks in the text layer), measured exactly like a selection. */
  readFindMatch(): SelectionRead;
  /** Measures a quoted text on the drawn text layer of a page (waits for the layer); the occurrence nearest to `savedCenter` (fraction of the page height) wins. */
  locateText(page: number, quote: string, savedCenter: number, line: number): Promise<Located>;
  /** The page and position (fractions) under a mouse event, or `null` outside a page. */
  pointAt(event: { target: EventTarget | null; clientX: number; clientY: number }): { page: number; x: number; y: number } | null;
  /** Cuts a rectangle (fractions) out of the canvas of a page as WebP; `pending`: the page is not drawn yet; `null`: it could not be encoded. */
  renderCrop(page: number, rect: Rect): Promise<CropImage | 'pending' | null>;
  /** The text of the text layer inside a rectangle and in the band around it (for the explanation of a crop). */
  textNear(page: number, rect: Rect): { inside: string; around: string };
  /** The text of a page's text layer around a selection (the paragraph that goes with the explanation). */
  paragraphAround(page: number, selection: string): string;
  /** The size of a page on screen, in pixels, or `null` when it is not drawn. */
  pageSize(page: number): { width: number; height: number } | null;
  destroy(): void;
}

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const LAYER_CLASS = 'rl-annot-layer';

function toViewerError(e: unknown): ViewerError {
  if (e instanceof ViewerError) return e;
  const err = e as { name?: string; status?: number } | null;
  switch (err?.name) {
    case 'PasswordException':
      return new ViewerError('encrypted');
    case 'InvalidPDFException':
    case 'FormatError':
      return new ViewerError('invalid');
    case 'MissingPDFException':
      return new ViewerError('missing');
    case 'ResponseException':
    case 'UnexpectedResponseException':
      return new ViewerError(err?.status === 404 || err?.status === 403 ? 'missing' : 'failed');
    default:
      return new ViewerError('failed');
  }
}

const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

export async function createViewer(container: HTMLDivElement, viewerEl: HTMLDivElement, handlers: ViewerHandlers): Promise<Viewer> {
  const pdfjs = await loadPdfjs();
  // pdf_viewer reads the core library from this global when it loads.
  (globalThis as { pdfjsLib?: unknown }).pdfjsLib = pdfjs;
  const lib = await import('pdfjs-dist/web/pdf_viewer.mjs');

  const eventBus = new lib.EventBus();
  /** External links never navigate the window: they are marked here and opened (on the user's click) by the main process. */
  class SafeLinkService extends lib.PDFLinkService {
    override addLinkAttributes(link: HTMLAnchorElement, url: string): void {
      if (isWebUrl(url)) {
        link.href = url;
        link.dataset['rlExternal'] = '1';
        link.rel = 'noopener noreferrer nofollow';
      } else {
        link.removeAttribute('href');
      }
    }
  }
  const linkService = new SafeLinkService({ eventBus });
  const findController = new lib.PDFFindController({ linkService, eventBus });
  const viewer = new lib.PDFViewer({
    container,
    viewer: viewerEl,
    eventBus,
    linkService,
    findController,
    textLayerMode: 1, // text layer for selection and find
    annotationMode: 1, // links only: no forms, no scripting
    removePageBorders: true,
    maxCanvasPixels: 16 * 1024 * 1024,
  });
  linkService.setViewer(viewer);

  const layers = new Map<number, HTMLElement>();
  let fit = true;
  let pendingPage = 1;
  let task: ReturnType<typeof pdfjs.getDocument> | null = null;
  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']> | null = null;
  let destroyed = false;

  const ensureLayer = (pageNumber: number, pageDiv: HTMLElement): HTMLElement => {
    const existing = layers.get(pageNumber);
    if (existing && existing.parentElement === pageDiv) return existing;
    const el = document.createElement('div');
    el.className = LAYER_CLASS;
    pageDiv.append(el);
    layers.set(pageNumber, el);
    return el;
  };

  eventBus.on('pagesinit', () => {
    viewer.currentScaleValue = 'page-width';
    if (pendingPage > 1) viewer.currentPageNumber = Math.min(pendingPage, viewer.pagesCount);
    handlers.onPages(viewer.pagesCount);
    showPage(viewer.currentPageNumber);
  });
  let shown = 0;
  const showPage = (n: number) => {
    if (n !== shown) handlers.onPage((shown = n));
  };
  eventBus.on('pagechanging', (e: { pageNumber: number }) => showPage(e.pageNumber));
  // The field names the page with the most area in the window, not the first one that touches it (N17).
  let frame = 0;
  const onScroll = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const cur = viewer.currentPageNumber;
      const box = container.getBoundingClientRect();
      const near: Array<[number, number, number]> = [];
      for (let n = Math.max(1, cur - 1); n <= Math.min(viewer.pagesCount, cur + 2); n++) {
        const r = pageDivOf(n)?.getBoundingClientRect();
        if (r) near.push([n, r.top, r.bottom]);
      }
      const n = dominantPage(near, { top: box.top, bottom: box.bottom });
      if (n !== null) showPage(n);
    });
  };
  container.addEventListener('scroll', onScroll, { passive: true });
  eventBus.on('scalechanging', (e: { scale: number; presetValue?: string }) => {
    fit = e.presetValue === 'page-width';
    handlers.onZoom(Math.round(e.scale * 100), fit);
  });
  eventBus.on('pagerendered', (e: { pageNumber: number; source: { div: HTMLElement } }) => {
    handlers.onLayer(e.pageNumber, ensureLayer(e.pageNumber, e.source.div));
  });
  const findState = (state: number, counts: { current: number; total: number } | undefined): FindState => ({
    state: state === lib.FindState.FOUND ? 'found' : state === lib.FindState.NOT_FOUND ? 'notfound' : state === lib.FindState.WRAPPED ? 'wrapped' : 'pending',
    current: counts?.current ?? 0,
    total: counts?.total ?? 0,
  });
  eventBus.on('updatefindcontrolstate', (e: { state: number; matchesCount?: { current: number; total: number } }) => handlers.onFind(findState(e.state, e.matchesCount)));
  eventBus.on('updatefindmatchescount', (e: { matchesCount: { current: number; total: number } }) => handlers.onFind({ ...findState(lib.FindState.FOUND, e.matchesCount), state: 'found' }));

  // A web link is opened by the main process, only for a click of the user; anything else a PDF puts in a link is dropped.
  const onLinkClick = (e: MouseEvent) => {
    const a = (e.target as Element | null)?.closest?.('a');
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (a.dataset['rlExternal'] === '1') {
      e.preventDefault();
      if (e.isTrusted && isWebUrl(href)) handlers.onExternalLink(href);
    } else if (!href.startsWith('#')) {
      e.preventDefault();
    }
  };
  container.addEventListener('click', onLinkClick, true);

  // Fit-to-width follows the size of the pane.
  const resizer =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          if (fit && viewer.pagesCount > 0) viewer.currentScaleValue = 'page-width';
        })
      : null;
  resizer?.observe(container);

  const frameOf = (page: number, pageDiv: HTMLElement) => ensureLayer(page, pageDiv).getBoundingClientRect();
  const pageDivOf = (page: number): HTMLElement | null => container.querySelector<HTMLElement>(`.page[data-page-number="${page}"]`);

  return {
    async open(url, page = 1) {
      pendingPage = page;
      const params = pdfDocumentParams(url);
      task = pdfjs.getDocument(params);
      const t = task;
      try {
        doc = await new Promise((resolve, reject) => {
          t.onPassword = () => reject(new ViewerError('encrypted'));
          t.promise.then(resolve, reject);
        });
      } catch (e) {
        void t.destroy().catch(() => {});
        throw toViewerError(e);
      }
      if (destroyed || !doc) throw new ViewerError('failed');
      viewer.setDocument(doc);
      linkService.setDocument(doc, null);
      return { pages: doc.numPages };
    },
    goTo(page, y) {
      if (viewer.pagesCount === 0) {
        pendingPage = page;
        return;
      }
      viewer.currentPageNumber = Math.min(Math.max(1, page), viewer.pagesCount);
      if (y !== undefined) {
        requestAnimationFrame(() => {
          const div = pageDivOf(page);
          if (div) container.scrollTop = div.offsetTop + y * div.clientHeight - 80;
        });
      }
    },
    zoomBy(direction) {
      const cur = viewer.currentScale;
      const next = direction > 0 ? ZOOM_STEPS.find((s) => s > cur + 0.01) : [...ZOOM_STEPS].reverse().find((s) => s < cur - 0.01);
      if (next !== undefined) viewer.currentScale = next;
    },
    fitWidth() {
      viewer.currentScaleValue = 'page-width';
    },
    zoomTo(value) {
      if (value === 'page-fit') viewer.currentScaleValue = 'page-fit';
      else viewer.currentScale = value;
    },
    find(query, opts = {}) {
      eventBus.dispatch('find', { source: null, type: opts.again ? 'again' : '', query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: opts.backwards === true, matchDiacritics: true });
    },
    clearFind() {
      eventBus.dispatch('findbarclose', { source: null });
    },
    readSelection() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return { pieces: [], skipped: 0 };
      const range = sel.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) return { pieces: [], skipped: 0 };
      return readRange(container, range, frameOf);
    },
    readFindMatch() {
      return readFindMatch(container, frameOf);
    },
    async locateText(page, quote, savedCenter, line) {
      // The text layer is drawn after the page: wait until it has text and has stopped growing (about 4 s at most).
      let textLayer: Element | null = null;
      let seen = -1;
      for (let i = 0; i < 40; i++) {
        const el = pageDivOf(page)?.querySelector('.textLayer') ?? null;
        const count = el?.querySelectorAll('span').length ?? 0;
        if (el && count > 0 && count === seen) {
          textLayer = el;
          break;
        }
        seen = count;
        await new Promise((r) => setTimeout(r, 100));
      }
      const div = pageDivOf(page);
      if (!textLayer || !div || destroyed) return { status: 'none' };
      return locateInTextLayer(textLayer, page, frameOf(page, div), quote, savedCenter, line);
    },
    pointAt(event) {
      const pageDiv = (event.target as Element | null)?.closest?.<HTMLElement>('.page');
      if (!pageDiv) return null;
      const page = Number(pageDiv.dataset['pageNumber']);
      const frame = (pageDiv.querySelector(`.${LAYER_CLASS}`) ?? pageDiv).getBoundingClientRect();
      if (!Number.isInteger(page) || frame.width <= 0 || frame.height <= 0) return null;
      return { page, x: (event.clientX - frame.left) / frame.width, y: (event.clientY - frame.top) / frame.height };
    },
    async renderCrop(page, rect) {
      const canvas = pageDivOf(page)?.querySelector<HTMLCanvasElement>('canvas') ?? null;
      if (!canvas || canvas.width === 0) return 'pending';
      return cutCanvas(canvas, rect);
    },
    textNear(page, rect) {
      const div = pageDivOf(page);
      if (!div) return { inside: '', around: '' };
      const frame = frameOf(page, div);
      const items: TextItem[] = [];
      if (frame.width > 0 && frame.height > 0)
        for (const span of div.querySelectorAll<HTMLElement>('.textLayer span')) {
          const r = span.getBoundingClientRect();
          items.push({ text: span.textContent ?? '', cx: (r.left + r.width / 2 - frame.left) / frame.width, cy: (r.top + r.height / 2 - frame.top) / frame.height });
        }
      return pickText(items, rect);
    },
    paragraphAround(page, selection) {
      return contextAround(pageDivOf(page)?.querySelector('.textLayer')?.textContent ?? '', selection);
    },
    pageSize(page) {
      const r = pageDivOf(page)?.getBoundingClientRect();
      return r && r.width > 0 && r.height > 0 ? { width: r.width, height: r.height } : null;
    },
    destroy() {
      destroyed = true;
      container.removeEventListener('click', onLinkClick, true);
      container.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
      resizer?.disconnect();
      layers.clear();
      try {
        viewer.setDocument(null as never);
        viewer.cleanup();
      } catch {
        // already torn down
      }
      void task?.destroy().catch(() => {});
    },
  };
}
