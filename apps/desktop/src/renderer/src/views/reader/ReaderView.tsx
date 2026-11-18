import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { STUDY_LIMITS, type Annotation, type StudyState } from '@rl/core';
import { ErrorNote } from '../../components/ui';
import { useAiUi } from '../../lib/aiUi';
import { errorMessage } from '../../lib/errors';
import { useShortcutMatcher } from '../../lib/keymap';
import { useNotify } from '../../lib/notify';
import type { ReaderPanel, ReaderTarget } from '../../lib/reader';
import { rl } from '../../lib/rl';
import { RlError } from '../../lib/rl-error';
import { useLocalFlag } from '../../lib/useLocalFlag';
import { NoteEditor } from '../notes/NoteEditor';
import { NotesList } from '../notes/NotesList';
import { safeText } from '../library/safeText';
import { AnnotationBar, AnnotationLayers, AnnotationList } from './AnnotationParts';
import { createViewer, ViewerError, type FindState, type SelectionPiece, type Viewer } from './engine';
import { annotationAt, colorOf, type AnnotationColor } from './geometry';
import { useRepair } from './repair';
import { useAnnotations } from './useAnnotations';
import { useReaderDoc } from './useReaderDoc';
import './reader.css';

const STUDY: StudyState[] = ['to-read', 'reading', 'read'];
const TABS: ReaderPanel[] = ['annotations', 'pageNote', 'fileNote', 'notes'];

type Failure = { kind: 'notPdf' | 'missing' | 'encrypted' | 'invalid' | 'failed' } | { kind: 'error'; error: unknown };

const isEditable = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

interface Props {
  target: ReaderTarget;
  onClose(): void;
}

/**
 * The in-app PDF reader (phase 3). pdf.js draws only the pages that are on screen (with a text layer for selection and
 * find); the annotations of the user are drawn over them from data kept apart from the file, and the file is never written.
 * Keys (when the focus is not in a text box): n/j and p/k next and previous page, Ctrl+Home and Ctrl+End first and last,
 * Ctrl+F find, Ctrl+G go to page, Ctrl+plus, Ctrl+minus, Ctrl+0 zoom, Escape closes the bar or find box and then the reader.
 */
export function ReaderView({ target, onClose }: Props) {
  const { t } = useTranslation();
  const { reportError, fail, info: notifyInfo } = useNotify();
  const docId = target.docId;
  const ids = { page: useId(), find: useId() };

  const [failure, setFailure] = useState<Failure | null>(null);
  const [info, setInfo] = useState<{ url: string; title: string | null } | null>(null);
  const [ready, setReady] = useState(false);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(target.page ?? 1);
  const [pageInput, setPageInput] = useState(String(target.page ?? 1));
  const [zoom, setZoom] = useState({ percent: 100, fit: true });
  const [layers, setLayers] = useState<ReadonlyMap<number, HTMLElement>>(new Map());
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [findState, setFindState] = useState<FindState>({ state: 'idle', current: 0, total: 0 });
  const [tab, setTab] = useState<ReaderPanel>(target.panel ?? 'annotations');
  const [sideOpen, setSideOpen] = useLocalFlag('rl.readerSide', true);
  const [pending, setPending] = useState<SelectionPiece[] | null>(null);
  /** Pages inside the selection that were not drawn yet and so were left out (shown with the bar). */
  const [skipped, setSkipped] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The chat uses the open document and page as its context.
  const { publishReader } = useAiUi();
  useEffect(() => {
    publishReader({ docId, page });
  }, [docId, page, publishReader]);
  useEffect(() => () => publishReader(null), [publishReader]);
  const [color, setColor] = useState<AnnotationColor>('yellow');
  const [comment, setComment] = useState('');
  const [editComment, setEditComment] = useState('');
  const [busy, setBusy] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewerElRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);

  const { doc, setStudyState, setUnderlined, applyUnderlined } = useReaderDoc(docId, reportError);
  const ann = useAnnotations(docId, applyUnderlined, reportError);
  const [repositionId, setRepositionId] = useState<string | null>(null);
  const repair = useRepair({ ready, loaded: ann.loaded, annotations: ann.annotations, layers, viewerRef, save: ann.save, info: notifyInfo, docId });
  const selected = ann.annotations.find((a) => a.id === selectedId) ?? null;
  const annotationsRef = useRef<readonly Annotation[]>([]);
  annotationsRef.current = ann.annotations;

  // Open: ask the main process for the document URL, then give it to pdf.js (the chunk of pdf.js loads here).
  useEffect(() => {
    let alive = true;
    rl.invoke('reader:open', { docId }).then(
      (r) => alive && setInfo({ url: r.url, title: r.title }),
      (e: unknown) => {
        if (!alive) return;
        const err = RlError.from(e);
        const reason = err.details?.reason;
        if (err.code === 'PERMISSION_DENIED' && reason === 'not-pdf') setFailure({ kind: 'notPdf' });
        else if ((err.code === 'PERMISSION_DENIED' && reason === 'missing') || err.code === 'NOT_FOUND') setFailure({ kind: 'missing' });
        else setFailure({ kind: 'error', error: e });
      },
    );
    return () => {
      alive = false;
    };
  }, [docId]);

  const initialPage = useRef(target.page);
  useEffect(() => {
    if (!info || !containerRef.current || !viewerElRef.current) return;
    let cancelled = false;
    let viewer: Viewer | null = null;
    createViewer(containerRef.current, viewerElRef.current, {
      onPages: setPages,
      onPage: (n) => {
        setPage(n);
        setPageInput(String(n));
      },
      onZoom: (percent, fit) => setZoom({ percent, fit }),
      onLayer: (n, el) =>
        setLayers((cur) => {
          const next = new Map([...cur].filter(([k, v]) => k === n || v.isConnected));
          next.set(n, el);
          return next;
        }),
      onFind: setFindState,
      onExternalLink: (url) => void rl.invoke('reader:openLink', { url }).catch(reportError),
    }).then(
      async (v) => {
        if (cancelled) return v.destroy();
        viewer = v;
        viewerRef.current = v;
        try {
          const r = await v.open(info.url, initialPage.current);
          if (cancelled) return;
          setPages(r.pages);
          setReady(true);
          containerRef.current?.focus();
        } catch (e) {
          if (!cancelled) setFailure({ kind: e instanceof ViewerError ? e.kind : 'failed' });
        }
      },
      () => !cancelled && setFailure({ kind: 'failed' }),
    );
    return () => {
      cancelled = true;
      viewerRef.current = null;
      viewer?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  // Another request for the same document (a search hit, a link): go to its page and tab.
  const firstNonce = useRef(target.nonce);
  useEffect(() => {
    if (target.nonce === firstNonce.current) return;
    if (target.page !== undefined) viewerRef.current?.goTo(target.page);
    if (target.panel) setTab(target.panel);
  }, [target.nonce, target.page, target.panel]);

  // The focus goes back to where it was when the reader closes.
  useEffect(() => {
    const before = document.activeElement;
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);

  // A text selection in the pages offers the annotation bar (read after the selection settles).
  useEffect(() => {
    if (!ready) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSelection = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const read = viewerRef.current?.readSelection();
        if (read && read.pieces.length > 0) {
          setPending(read.pieces);
          setSkipped(read.skipped);
          setSelectedId(null);
        }
      }, 200);
    };
    document.addEventListener('selectionchange', onSelection);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', onSelection);
    };
  }, [ready]);

  useEffect(() => setEditComment(selected?.comment ?? ''), [selected?.id, selected?.comment]);

  // Find: typing searches after a short pause.
  useEffect(() => {
    if (!findOpen || !ready) return;
    const timer = setTimeout(() => (findText === '' ? viewerRef.current?.clearFind() : viewerRef.current?.find(findText)), 250);
    return () => clearTimeout(timer);
  }, [findText, findOpen, ready]);

  const goTo = (n: number, y?: number) => viewerRef.current?.goTo(Math.min(Math.max(1, Math.round(n)), Math.max(1, pages)), y);
  /** The last comment sent for an annotation, so blur, Enter, the button and closing the bar never send the same text twice. */
  const sentComment = useRef<{ id: string; value: string } | null>(null);
  const saveComment = (a: Annotation, value: string) => {
    const next = value.trim();
    const known = sentComment.current?.id === a.id ? sentComment.current.value : (a.comment ?? '');
    if (next === known) return;
    sentComment.current = { id: a.id, value: next };
    // A failed save forgets it, so the next blur or Enter tries again.
    void change(a, { comment: next }).then((ok) => {
      if (!ok && sentComment.current?.id === a.id) sentComment.current = null;
    });
  };
  const closeBar = () => {
    // Closing the bar (Escape, the close button) must not drop a comment that was typed but not saved yet.
    if (!pending && selected) saveComment(selected, editComment);
    setPending(null);
    setSkipped(0);
    setSelectedId(null);
    window.getSelection()?.removeAllRanges();
  };

  /**
   * Saves one annotation per piece (page). The first failure stops everything: the pieces already saved are not offered
   * again, the bar stays open with the rest so the user can retry, and the error is shown.
   */
  const createFrom = async (kind: 'highlight' | 'underline', pieces: SelectionPiece[], keepBar: boolean) => {
    if (busy || pieces.length === 0) return;
    setBusy(true);
    try {
      const note = comment.trim();
      for (const [i, piece] of pieces.entries()) {
        const text = piece.text.slice(0, STUDY_LIMITS.annotationText);
        const saved = await ann.save({ kind, page: piece.page, rects: piece.rects, text, color, geom: 2, ...(note ? { comment: note } : {}) });
        if (!saved) {
          // `ann.save` already showed why; say where it stopped.
          fail(t('reader.createStopped', { page: piece.page }));
          if (keepBar) setPending(pieces.slice(i));
          return;
        }
      }
      setComment('');
      if (keepBar) closeBar();
    } finally {
      setBusy(false);
    }
  };
  /** "Riposiziona": the text selected again replaces the rectangles of the annotation under review (same page). */
  const applyReposition = async () => {
    const target = ann.annotations.find((a) => a.id === repositionId);
    const piece = pending?.find((p) => p.page === target?.page);
    if (!target || !piece) return fail(t('reader.repair.samePage'));
    if (await repair.reposition(target, piece.rects, piece.text.slice(0, STUDY_LIMITS.annotationText))) {
      setRepositionId(null);
      closeBar();
    }
  };
  const create = (kind: 'highlight' | 'underline') => (pending ? createFrom(kind, pending, true) : Promise.resolve());

  /** Keyboard path to annotate: the current find match becomes a highlight or underline (same normalisation as a selection). */
  const annotateMatch = (kind: 'highlight' | 'underline') => {
    const read = viewerRef.current?.readFindMatch();
    if (!read || read.pieces.length === 0) return fail(t('reader.findNoMatch'));
    void createFrom(kind, read.pieces, false);
  };

  const change = async (a: Annotation, patch: Partial<Pick<Annotation, 'kind' | 'color' | 'comment'>>): Promise<boolean> => {
    setBusy(true);
    try {
      const next = { ...a, ...patch };
      return (await ann.save({ id: a.id, kind: next.kind, page: next.page, rects: next.rects, text: next.text, color: colorOf(next.color), ...(next.comment !== undefined ? { comment: next.comment } : {}) })) !== null;
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: Annotation) => {
    setBusy(true);
    try {
      if (await ann.remove(a.id)) setSelectedId(null);
    } finally {
      setBusy(false);
    }
  };

  const pick = (a: Annotation) => {
    setPending(null);
    setSelectedId(a.id);
    setTab('annotations');
    goTo(a.page, a.rects[0]?.y);
  };

  const onPagesClick = (e: ReactMouseEvent) => {
    if (window.getSelection()?.isCollapsed === false) return; // the end of a text selection, not a click
    const at = viewerRef.current?.pointAt(e);
    if (!at) return setSelectedId(null);
    const hit = annotationAt(annotationsRef.current, at.page, at.x, at.y);
    setSelectedId(hit?.id ?? null);
    if (hit) setPending(null);
  };

  const matches = useShortcutMatcher();
  const openFind = () => {
    setFindOpen(true);
    setTimeout(() => findInputRef.current?.select(), 0);
  };
  const closeFind = () => {
    setFindOpen(false);
    setFindState({ state: 'idle', current: 0, total: 0 });
    viewerRef.current?.clearFind();
    containerRef.current?.focus();
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const inField = isEditable(e.target);
    // The reader shortcuts are the user's (keymap): find, and highlight or underline the current match.
    if (matches(e, 'reader.find')) return (e.preventDefault(), openFind());
    if (findOpen && matches(e, 'reader.highlight')) return (e.preventDefault(), annotateMatch('highlight'));
    if (findOpen && matches(e, 'reader.underline')) return (e.preventDefault(), annotateMatch('underline'));
    if (mod && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 'g') return (e.preventDefault(), pageInputRef.current?.select());
      if (key === '=' || key === '+') return (e.preventDefault(), viewerRef.current?.zoomBy(1));
      if (key === '-') return (e.preventDefault(), viewerRef.current?.zoomBy(-1));
      if (key === '0') return (e.preventDefault(), viewerRef.current?.fitWidth());
      if (!inField && e.key === 'Home') return (e.preventDefault(), goTo(1));
      if (!inField && e.key === 'End') return (e.preventDefault(), goTo(pages));
      return;
    }
    if (e.key === 'Escape') {
      if (e.target === findInputRef.current || findOpen) return (e.preventDefault(), closeFind());
      if (pending || selectedId) return (e.preventDefault(), closeBar());
      if (!inField) return (e.preventDefault(), onClose());
      return;
    }
    if (inField || e.altKey) return;
    if (e.key === 'n' || e.key === 'j') goTo(page + 1);
    else if (e.key === 'p' || e.key === 'k') goTo(page - 1);
  };

  const title = safeText(doc?.title?.trim() || info?.title || '') || t('reader.untitled');
  const underlined = doc?.study.underlined;
  const errorText = failure === null ? null : failure.kind === 'error' ? errorMessage(failure.error, t) : t(`reader.errors.${failure.kind}`);
  const findLabel = findState.state === 'notfound' ? t('reader.findNone') : findState.total > 0 ? t('reader.findCount', { current: findState.current, total: findState.total }) : '';

  return (
    <section className="reader" aria-label={t('reader.regionLabel', { title })} data-testid="reader" data-doc-id={docId} onKeyDown={onKeyDown}>
      <header className="reader-bar">
        <button type="button" onClick={onClose} data-testid="reader-close">
          <span aria-hidden="true">← </span>
          {t('reader.back')}
        </button>
        <h2 className="reader-title" title={title} data-testid="reader-title">
          {title}
        </h2>
        <span className="spacer" />
        <div className="reader-group" role="group" aria-label={t('reader.navigation')}>
          <button type="button" className="icon-button" aria-label={t('reader.prev')} title={t('reader.prev')} disabled={!ready || page <= 1} onClick={() => goTo(page - 1)} data-testid="reader-prev">
            <span aria-hidden="true">‹</span>
          </button>
          <label htmlFor={ids.page} className="sr-only">
            {t('reader.goToPage')}
          </label>
          <input
            ref={pageInputRef}
            id={ids.page}
            className="reader-page-input"
            type="number"
            min={1}
            max={Math.max(1, pages)}
            value={pageInput}
            disabled={!ready}
            onChange={(e) => setPageInput(e.target.value)}
            onBlur={() => setPageInput(String(page))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const n = Number.parseInt(pageInput, 10);
                if (Number.isFinite(n)) goTo(n);
                containerRef.current?.focus();
              }
            }}
            data-testid="reader-page-input"
          />
          <span className="reader-pages" data-testid="reader-pages">
            {t('reader.pageOf', { count: pages })}
          </span>
          <button type="button" className="icon-button" aria-label={t('reader.next')} title={t('reader.next')} disabled={!ready || page >= pages} onClick={() => goTo(page + 1)} data-testid="reader-next">
            <span aria-hidden="true">›</span>
          </button>
        </div>
        <div className="reader-group" role="group" aria-label={t('reader.zoom')}>
          <button type="button" className="icon-button" aria-label={t('reader.zoomOut')} title={t('reader.zoomOut')} disabled={!ready} onClick={() => viewerRef.current?.zoomBy(-1)} data-testid="reader-zoom-out">
            <span aria-hidden="true">−</span>
          </button>
          <span className="reader-zoom" role="status" aria-label={t('reader.zoomLevel', { percent: zoom.percent })} data-testid="reader-zoom">
            {zoom.percent}%
          </span>
          <button type="button" className="icon-button" aria-label={t('reader.zoomIn')} title={t('reader.zoomIn')} disabled={!ready} onClick={() => viewerRef.current?.zoomBy(1)} data-testid="reader-zoom-in">
            <span aria-hidden="true">+</span>
          </button>
          <button type="button" className={zoom.fit ? 'toggle on' : 'toggle'} aria-pressed={zoom.fit} disabled={!ready} onClick={() => viewerRef.current?.fitWidth()} data-testid="reader-fit">
            {t('reader.fitWidth')}
          </button>
        </div>
        <button type="button" className={findOpen ? 'toggle on' : 'toggle'} aria-pressed={findOpen} disabled={!ready} onClick={() => (findOpen ? closeFind() : openFind())} title={t('reader.findHint')} data-testid="reader-find-toggle">
          {t('reader.find')}
        </button>
        <button type="button" className={sideOpen ? 'toggle on' : 'toggle'} aria-pressed={sideOpen} onClick={() => setSideOpen(!sideOpen)} data-testid="reader-side-toggle">
          {t('reader.panel')}
        </button>
      </header>

      <div className="reader-study" role="group" aria-label={t('reader.studyGroup')}>
        <div className="radio-row" role="radiogroup" aria-label={t('doc.studyState')}>
          {STUDY.map((s) => (
            <label key={s} className="radio-chip">
              <input type="radio" name={`${ids.page}-study`} checked={doc?.study.state === s} disabled={!doc} onChange={() => setStudyState(s)} data-testid={`reader-study-${s}`} />
              <span>{t(`study.${s}`)}</span>
            </label>
          ))}
        </div>
        <div className="check">
          <input id={`${ids.page}-ul`} type="checkbox" checked={underlined?.value ?? false} disabled={!doc} onChange={(e) => setUnderlined(e.target.checked)} data-testid="reader-underlined" />
          <label htmlFor={`${ids.page}-ul`}>{t('doc.underlined')}</label>
          {underlined?.value && (
            <span className="hint" data-testid="reader-underlined-origin" data-origin={underlined.origin}>
              {t(`reader.underlinedOrigin_${underlined.origin}`)}
            </span>
          )}
        </div>
        <span className="spacer" />
        <span className="hint reader-keys">{t('reader.keys')}</span>
      </div>

      <div className={sideOpen ? 'reader-body with-side' : 'reader-body'}>
        <div className="reader-main">
          {findOpen && (
            <div className="reader-find" role="search" data-testid="reader-find">
              <label htmlFor={ids.find}>{t('reader.findLabel')}</label>
              <input
                ref={findInputRef}
                id={ids.find}
                type="search"
                value={findText}
                onChange={(e) => setFindText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    viewerRef.current?.find(findText, { again: true, backwards: e.shiftKey });
                  }
                }}
                data-testid="reader-find-input"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" className="icon-button" aria-label={t('reader.findPrev')} title={t('reader.findPrev')} onClick={() => viewerRef.current?.find(findText, { again: true, backwards: true })} data-testid="reader-find-prev">
                <span aria-hidden="true">↑</span>
              </button>
              <button type="button" className="icon-button" aria-label={t('reader.findNext')} title={t('reader.findNext')} onClick={() => viewerRef.current?.find(findText, { again: true })} data-testid="reader-find-next">
                <span aria-hidden="true">↓</span>
              </button>
              <button type="button" disabled={findState.total === 0} onClick={() => annotateMatch('highlight')} title={t('reader.findAnnotateHint')} data-testid="reader-find-highlight">
                {t('reader.findHighlight')}
              </button>
              <button type="button" disabled={findState.total === 0} onClick={() => annotateMatch('underline')} title={t('reader.findAnnotateHint')} data-testid="reader-find-underline">
                {t('reader.findUnderline')}
              </button>
              <span className="hint" role="status" data-testid="reader-find-count">
                {findLabel}
              </span>
              <button type="button" className="icon-button" aria-label={t('reader.findClose')} title={t('reader.findClose')} onClick={closeFind} data-testid="reader-find-close">
                <span aria-hidden="true">×</span>
              </button>
            </div>
          )}
          {ann.stale && (
            <p className="callout reader-stale" role="alert" data-testid="reader-stale">
              {t('reader.stale')}
            </p>
          )}
          {errorText && (
            <div className="reader-error" role="alert" data-testid="reader-error" data-kind={failure?.kind}>
              <ErrorNote>{errorText}</ErrorNote>
              <button type="button" onClick={onClose} data-testid="reader-error-back">
                {t('reader.back')}
              </button>
            </div>
          )}
          {!errorText && !ready && (
            <p className="hint reader-loading" role="status" data-testid="reader-loading">
              {t('reader.loading')}
            </p>
          )}
          <div
            ref={containerRef}
            className="reader-scroll"
            tabIndex={0}
            role="document"
            aria-label={t('reader.pagesLabel')}
            hidden={errorText !== null}
            onClick={onPagesClick}
            onMouseDown={() => setPending(null)}
            data-testid="reader-pages-area"
          >
            <div ref={viewerElRef} className="pdfViewer" />
            <AnnotationLayers layers={layers} annotations={ann.annotations} selectedId={selectedId} staleIds={ann.staleIds} />
          </div>
          {(pending || selected) && (
            <div className="ann-dock">
              {pending ? (
                <AnnotationBar
                  mode="new"
                  text={pending.map((p) => p.text).join(' … ')}
                  color={color}
                  comment={comment}
                  busy={busy}
                  notice={skipped > 0 ? t('reader.skipped', { count: skipped }) : undefined}
                  onColor={setColor}
                  onComment={setComment}
                  onCreate={(k) => void create(k)}
                  onReposition={repositionId ? () => void applyReposition() : undefined}
                  onClose={closeBar}
                />
              ) : (
                selected && (
                  <AnnotationBar
                    key={selected.id}
                    mode="edit"
                    annotation={selected}
                    comment={editComment}
                    busy={busy}
                    onColor={(c) => void change(selected, { color: c })}
                    onKind={(k) => void change(selected, { kind: k })}
                    onComment={setEditComment}
                    onSaveComment={() => saveComment(selected, editComment)}
                    stale={ann.staleIds.has(selected.id)}
                    onReconfirm={() => void change(selected, {})}
                    onDelete={() => void remove(selected)}
                    onClose={closeBar}
                  />
                )
              )}
            </div>
          )}
        </div>

        {sideOpen && (
          <aside className="reader-side" aria-label={t('reader.panel')} data-testid="reader-side">
            <div className="tabs" role="tablist" aria-label={t('reader.panel')}>
              {TABS.map((id) => (
                <button key={id} type="button" role="tab" id={`reader-tab-${id}`} aria-selected={tab === id} aria-controls={`reader-tabpanel-${id}`} className={tab === id ? 'tab on' : 'tab'} onClick={() => setTab(id)} data-testid={`reader-tab-${id}`}>
                  {t(`reader.tabs.${id}`)}
                </button>
              ))}
            </div>
            <div role="tabpanel" id={`reader-tabpanel-${tab}`} aria-labelledby={`reader-tab-${tab}`} className="reader-tabpanel">
              {tab === 'annotations' && <AnnotationList
                  annotations={ann.annotations}
                  selectedId={selectedId}
                  staleIds={ann.staleIds}
                  onPick={pick}
                  review={repair.review}
                  repositioning={repositionId}
                  onReposition={(a) => {
                    setRepositionId(a.id);
                    pick(a);
                  }}
                  onAccept={(a) => void repair.accept(a)}
                />}
              {tab === 'pageNote' && <NoteEditor key={`page-${page}`} docId={docId} page={page} testId="note-page" />}
              {tab === 'fileNote' && <NoteEditor key="file" docId={docId} testId="note-file" />}
              {tab === 'notes' && (
                <NotesList
                  docId={docId}
                  onOpen={(p) => {
                    if (p === null) setTab('fileNote');
                    else {
                      setTab('pageNote');
                      goTo(p);
                    }
                  }}
                />
              )}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
