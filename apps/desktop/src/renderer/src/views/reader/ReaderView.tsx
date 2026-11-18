import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ANNOTATION_COLORS, STUDY_LIMITS, type Annotation } from '@rl/core';
import { costLabel } from '../../components/AiCostPreview';
import { Lazy, lazyView } from '../../components/Lazy';
import { ErrorNote } from '../../components/ui';
import { useAiUi } from '../../lib/aiUi';
import { errorMessage } from '../../lib/errors';
import { useHistory } from '../../lib/history';
import { resolveShortcut, useEffectiveShortcuts, useShortcutMatcher } from '../../lib/keymap';
import { useNotify } from '../../lib/notify';
import type { ReaderTarget } from '../../lib/reader';
import { rl } from '../../lib/rl';
import { RlError } from '../../lib/rl-error';
import { useApp } from '../../state/app-context';
import { useLocalFlag } from '../../lib/useLocalFlag';
import { NoteEditor } from '../notes/NoteEditor';
import { NotesList } from '../notes/NotesList';
import { safeText } from '../library/safeText';
import { AnnotationLayers, AnnotationList } from './AnnotationParts';
import { AnnotationPopover, ConfirmErase, SelectionPopover, type Anchor } from './AnnotationPopover';
import { CropLayer, type CropDrag } from './CropLayer';
import { CropPopover } from './CropPopover';
import { copyCropImage, cropTooSmall, dragRect } from './crop';
import { cursorFor } from './cursors';
import { createViewer, ViewerError, type FindState, type SelectionPiece, type Viewer } from './engine';
import { FindBar } from './FindBar';
import { annotationAt, annotationsAt, colorOf, type AnnotationColor, type Rect } from './geometry';
import { PdfConsentBanner, PdfConsentDialog } from './PdfConsentDialog';
import { PdfConfirmDialogs, PdfInfoRow, usePdfWrite } from './PdfWriteChip';
import { ReaderBar, type ZoomChoice } from './ReaderBar';
import { useRepair } from './repair';
import { initialCtx, step, type ColorNo, type Ctx, type Env, type Ev, type Mode, type Result, type Tool } from './toolMachine';
import type { ExplainRequest } from './ExplainCard';
import { useAnnotations } from './useAnnotations';
import { useExplainEstimate } from './useExplainEstimate';
import { useReaderDoc } from './useReaderDoc';
import './reader.css';
import './reader-tools.css';
import './cursors.css';

// "✦ Spiega" and its cost dialog load when the first explanation is asked for.
const ExplainCard = lazyView(() => import('./ExplainCard').then((m) => ({ default: m.ExplainCard })), ['reader']);

type Failure = { kind: 'notPdf' | 'missing' | 'encrypted' | 'invalid' | 'failed' } | { kind: 'error'; error: unknown };
type Side = 'annotations' | 'notes' | 'info';
type Scope = 'pageNote' | 'fileNote' | 'notes';
const SIDES: Side[] = ['annotations', 'notes', 'info'];
const SCOPES: Scope[] = ['pageNote', 'fileNote', 'notes'];
const TOOL_KEY = 'rl.readerTool';
const SPACE_KEY = 'rl.readerSpaceHint';
const OVERLAY = '.rl-popover, [role="dialog"][aria-modal="true"]';
const TOOL_OF: Partial<Record<string, Tool>> = { 'reader.tool.select': 'select', 'reader.tool.highlight': 'highlight', 'reader.tool.underline': 'underline', 'reader.tool.crop': 'crop', 'reader.tool.eraser': 'eraser' };

/** The "how to close" hint of Escape was shown in this session. */
let rootHinted = false;

const isEditable = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
const colorName = (n: ColorNo): AnnotationColor => ANNOTATION_COLORS[n - 1]!;

/** The last tool and the colour are remembered (8.2.1); the reader always opens on Select. */
function loadCtx(): Ctx {
  try {
    const v = JSON.parse(window.localStorage.getItem(TOOL_KEY) ?? 'null') as Partial<Ctx> | null;
    const tools: Tool[] = ['select', 'highlight', 'underline', 'crop', 'eraser'];
    if (v && tools.includes(v.prev as Tool) && [1, 2, 3, 4, 5].includes(v.color as number)) return { tool: 'select', prev: v.prev as Tool, color: v.color as ColorNo };
  } catch {
    // no storage, or not ours: the defaults
  }
  return initialCtx();
}

interface Props {
  target: ReaderTarget;
  onClose(): void;
}

/**
 * The in-app PDF reader. pdf.js draws only the pages on screen (with a text layer for selection and find); the annotations of the
 * user are drawn over them from data kept apart from the file, and the file is never written. The user chooses a tool first
 * (Select, Highlight, Underline, Eraser; `toolMachine.ts`) and then annotates. The bar of the reader (`ReaderBar`) takes the
 * place of the top bar of the shell when the shell has a slot for it, and sits on top of the reader otherwise.
 */
export function ReaderView({ target, onClose }: Props) {
  const { t } = useTranslation();
  const { reportError, fail, info: notifyInfo } = useNotify();
  const docId = target.docId;
  const findId = useId();

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
  const [side, setSide] = useState<Side>(target.panel === undefined || target.panel === 'annotations' ? 'annotations' : 'notes');
  const [scope, setScope] = useState<Scope>(target.panel === 'fileNote' || target.panel === 'notes' ? target.panel : 'pageNote');
  const [sideOpen, setSideOpen] = useLocalFlag('rl.readerSide', true);
  const [pending, setPending] = useState<SelectionPiece[] | null>(null);
  /** Pages inside the selection that were not drawn yet and so were left out (shown with the popover). */
  const [skipped, setSkipped] = useState(0);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const [away, setAway] = useState(false);
  const [eraseIds, setEraseIds] = useState<ReadonlySet<string>>(new Set());
  const [confirm, setConfirm] = useState<{ ids: string[]; at: Anchor } | null>(null);
  const [repositionId, setRepositionId] = useState<string | null>(null);
  // Crop (27): the rectangle being dragged (state, to draw it) and its start and latest rectangle (refs, always current).
  const [cropDrag, setCropDrag] = useState<CropDrag | null>(null);
  const cropStart = useRef<{ page: number; x: number; y: number } | null>(null);
  const cropRect = useRef<CropDrag | null>(null);
  // "✦ Spiega" (31): the passage being explained and where its card hangs.
  const [explain, setExplain] = useState<{ req: ExplainRequest; anchor: () => Anchor | null; key: number } | null>(null);
  const { config } = useApp();
  // The tool machine: its state is kept in a ref too, so a burst of events (a drag) always steps from the latest state.
  const [machine, setMachine] = useState<{ ctx: Ctx; mode: Mode }>(() => ({ ctx: loadCtx(), mode: { m: 'idle', hasSelection: false } }));
  const mref = useRef(machine);
  const { ctx, mode } = machine;
  const selectedId = mode.m === 'selected' || mode.m === 'commenting' ? mode.annId : null;
  const color = colorName(ctx.color);

  // The chat uses the open document and page as its context.
  const { publishReader } = useAiUi();
  useEffect(() => {
    publishReader({ docId, page });
  }, [docId, page, publishReader]);
  useEffect(() => () => publishReader(null), [publishReader]);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewerElRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const lastUp = useRef({ x: 0, y: 0 });

  const { doc, setStudyState, setUnderlined, applyUnderlined } = useReaderDoc(docId, reportError);
  const ann = useAnnotations(docId, applyUnderlined, reportError);
  // Writing into the PDF (G4a): the state of the PDF group, the consent (banner at the first annotation, dialog once when closing).
  const pdf = usePdfWrite(docId, reportError);
  const [consentDialog, setConsentDialog] = useState(false);
  const askedConsent = useRef(false);
  const closeRef = useRef<() => void>(() => {});
  closeRef.current = () => {
    if (!askedConsent.current && pdf.consentOpen(ann.annotations.length)) {
      askedConsent.current = true;
      setConsentDialog(true);
    } else onClose();
  };
  const closeReader = useCallback(() => closeRef.current(), []);
  const history = useHistory();
  const repair = useRepair({ ready, loaded: ann.loaded, annotations: ann.annotations, layers, viewerRef, save: ann.save, info: notifyInfo, docId });
  const selected = ann.annotations.find((a) => a.id === selectedId) ?? null;
  const annotationsRef = useRef<readonly Annotation[]>([]);
  annotationsRef.current = ann.annotations;

  // Where the bar goes: the slot of the shell's top bar (the reader replaces that bar), or on top of the reader without one.
  const [slot, setSlot] = useState<HTMLElement | null | undefined>(undefined);
  useLayoutEffect(() => setSlot(document.getElementById('reader-bar-slot')), []);

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
    if (target.panel) {
      setSide(target.panel === 'annotations' ? 'annotations' : 'notes');
      if (target.panel !== 'annotations') setScope(target.panel);
    }
  }, [target.nonce, target.page, target.panel]);

  // The focus goes back to where it was when the reader closes.
  useEffect(() => {
    const before = document.activeElement;
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);

  /* ---------------------------------------------------------------- the tool machine */

  const goTo = (n: number, y?: number) => viewerRef.current?.goTo(Math.min(Math.max(1, Math.round(n)), Math.max(1, pages)), y);
  const matches = useShortcutMatcher();
  const keys = useEffectiveShortcuts();
  const findOpenRef = useRef(false);
  findOpenRef.current = findOpen;
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(hintTimer.current), []);
  useEffect(() => {
    try {
      window.localStorage.setItem(TOOL_KEY, JSON.stringify({ tool: ctx.tool, prev: ctx.prev, color: ctx.color }));
    } catch {
      // no storage: not remembered
    }
  }, [ctx.tool, ctx.prev, ctx.color]);

  // The cursor of the tool, with a dot in the colour of the stroke (read from the token, so it follows the theme).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const hex = getComputedStyle(el).getPropertyValue(`--hl-${color}`).trim() || 'currentColor';
    const cursor = cursorFor(ctx.tool, hex);
    if (cursor) el.style.setProperty('--reader-cursor', cursor);
    else el.style.removeProperty('--reader-cursor');
  }, [ctx.tool, color]);

  const sentComment = useRef<{ id: string; value: string } | null>(null);
  const change = async (a: Annotation, patch: Partial<Pick<Annotation, 'kind' | 'color' | 'comment' | 'crop'>>): Promise<boolean> => {
    setBusy(true);
    try {
      const next = { ...a, ...patch };
      return (await ann.save({ id: a.id, kind: next.kind, page: next.page, rects: next.rects, text: next.text, color: colorOf(next.color), ...(next.comment !== undefined ? { comment: next.comment } : {}), ...(next.crop ? { crop: next.crop } : {}) })) !== null;
    } finally {
      setBusy(false);
    }
  };
  /** The last comment sent for an annotation, so blur, Enter, the button and Escape never send the same text twice. */
  const saveComment = (a: Annotation, value: string) => {
    const next = value.trim();
    const known = sentComment.current?.id === a.id ? sentComment.current.value : (a.comment ?? '');
    if (next === known) return;
    sentComment.current = { id: a.id, value: next };
    void change(a, { comment: next }).then((ok) => {
      if (!ok && sentComment.current?.id === a.id) sentComment.current = null;
    });
  };

  /** Deletes annotations and offers to bring them back (a copy is saved again: Undo). */
  const removeMany = async (list: Annotation[]) => {
    setBusy(true);
    try {
      const gone: Annotation[] = [];
      // The image of a crop is kept in memory until the toast goes away, so that Undo can bring the crop back whole.
      const images = new Map<string, string>();
      for (const a of list) {
        if (a.kind === 'area') {
          const got = await rl.invoke('crops:get', { docId, annId: a.id }).catch(() => ({ image: null }));
          if (got.image) images.set(a.id, got.image);
        }
        if (await ann.remove(a.id)) {
          gone.push(a);
          if (a.kind === 'area') void rl.invoke('crops:remove', { docId, annId: a.id }).catch(() => {});
        }
      }
      if (gone.length === 0) return;
      notifyInfo(t('reader.erased', { count: gone.length }), {
        label: t('reader.erase.undo'),
        run: () => {
          void (async () => {
            for (const a of gone) {
              const back = await ann.save({ kind: a.kind, page: a.page, rects: a.rects, text: a.text, color: colorOf(a.color), ...(a.geom === 2 ? { geom: 2 as const } : {}), ...(a.comment ? { comment: a.comment } : {}), ...(a.crop ? { crop: a.crop } : {}) });
              const image = images.get(a.id);
              if (back && image) await rl.invoke('crops:save', { docId, annId: back.id, image }).catch(reportError);
            }
          })();
        },
      });
    } finally {
      setBusy(false);
    }
  };
  const removeIds = (idList: string[]) => removeMany(annotationsRef.current.filter((a) => idList.includes(a.id)));

  const clearPending = () => {
    setPending(null);
    setSkipped(0);
    window.getSelection()?.removeAllRanges();
  };
  /**
   * Saves one annotation per piece (page). The first failure stops everything: the pieces already saved are not offered
   * again, the popover stays open with the rest so the user can retry, and the error is shown.
   */
  const createFrom = async (kind: 'highlight' | 'underline', pieces: SelectionPiece[], keepPopover: boolean, paint: AnnotationColor) => {
    if (busy || pieces.length === 0) return;
    setBusy(true);
    try {
      for (const [i, piece] of pieces.entries()) {
        const text = piece.text.slice(0, STUDY_LIMITS.annotationText);
        const saved = await ann.save({ kind, page: piece.page, rects: piece.rects, text, color: paint, geom: 2 });
        if (!saved) {
          // `ann.save` already showed why; say where it stopped.
          fail(t('reader.createStopped', { page: piece.page }));
          if (keepPopover) setPending(pieces.slice(i));
          return;
        }
      }
      if (keepPopover) clearPending();
    } finally {
      setBusy(false);
    }
  };
  const readPending = () => {
    const read = viewerRef.current?.readSelection();
    if (read && read.pieces.length > 0) {
      setPending(read.pieces);
      setSkipped(read.skipped);
    }
  };

  const showText = (text: string, ms: number) => {
    setHint(text);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(''), ms);
  };
  const showHint = (tool: Tool) => showText(t(`reader.tools.${tool}`), 1000);
  /** The first time (per profile) Space switches the tool: say that it does not scroll, and how to. */
  const spaceHint = () => {
    try {
      if (window.localStorage.getItem(SPACE_KEY)) return;
      window.localStorage.setItem(SPACE_KEY, '1');
    } catch {
      // no storage: say it every time rather than never
    }
    notifyInfo(t('reader.spaceHint'), { label: t('reader.gotIt'), run: () => {} });
  };

  /** A crop of a figure, table or equation (27): cut the image from the page, keep it in the data folder and save the annotation. */
  const commitCrop = async () => {
    const drag = cropRect.current;
    cropRect.current = null;
    cropStart.current = null;
    setCropDrag(null);
    const viewer = viewerRef.current;
    if (!drag || !viewer) return;
    const size = viewer.pageSize(drag.page);
    if (!size || cropTooSmall(drag.rect, size)) return showText(t('reader.crop.tooSmall'), 1500);
    const img = await viewer.renderCrop(drag.page, drag.rect);
    if (img === 'pending') return showText(t('reader.crop.pending'), 2500);
    if (!img) return fail(t('reader.crop.failed'));
    setBusy(true);
    try {
      const saved = await ann.save({ kind: 'area', page: drag.page, rects: [drag.rect], text: '', color, crop: { type: 'figure' }, geom: 2 });
      if (!saved) return;
      try {
        await rl.invoke('crops:save', { docId, annId: saved.id, image: img.base64 });
      } catch (e) {
        await ann.remove(saved.id);
        reportError(e);
        return;
      }
      setMode({ m: 'selected', annId: saved.id });
      notifyInfo(t('reader.crop.saved'), [
        { label: t('reader.crop.copy'), run: () => void copyCropImage(img.base64).then(() => notifyInfo(t('reader.crop.copied')), reportError) },
        {
          label: t('reader.crop.undo'),
          run: () =>
            void (async () => {
              if (await ann.remove(saved.id)) await rl.invoke('crops:remove', { docId, annId: saved.id }).catch(() => {});
              setMode({ m: 'idle', hasSelection: false });
            })(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  /** Feeds one event to the machine and carries out what it asks. Returns the result (the caller may need to know if something changed). */
  const dispatch = (ev: Ev, fromUi = false): Result => {
    const before = mref.current;
    // A click on a control is never a key that belongs to a text field or an open menu.
    const env: Env = { inTextField: !fromUi && isEditable(document.activeElement), overlayOpen: !fromUi && document.querySelector(OVERLAY) !== null, findOpen: findOpenRef.current };
    const r = step(before.ctx, before.mode, ev, env);
    mref.current = { ctx: r.ctx, mode: r.mode };
    setMachine(mref.current);
    if (ev.e === 'down') {
      setPending(null);
      setExplain(null);
    }
    for (const fx of r.effects) {
      switch (fx) {
        case 'create':
          if (before.mode.m === 'stroking') {
            const read = viewerRef.current?.readSelection();
            if (read && read.pieces.length > 0) {
              if (read.skipped > 0) notifyInfo(t('reader.skipped', { count: read.skipped }));
              void createFrom(before.mode.kind, read.pieces, false, colorName(before.ctx.color));
            }
          }
          break;
        case 'delete':
          void removeIds(before.mode.m === 'erasing' ? before.mode.erased : before.mode.m === 'selected' ? [before.mode.annId] : []);
          break;
        case 'confirm-erase':
          if (before.mode.m === 'erasing') setConfirm({ ids: before.mode.erased, at: { left: lastUp.current.x, top: lastUp.current.y, bottom: lastUp.current.y } });
          break;
        case 'erase-hint':
          if (r.mode.m === 'erasing') setEraseIds(new Set(r.mode.erased));
          break;
        case 'recolor': {
          const was = before.mode;
          const a = was.m === 'selected' ? annotationsRef.current.find((x) => x.id === was.annId) : undefined;
          if (a && ev.e === 'color') void change(a, { color: colorName(ev.n) });
          break;
        }
        case 'save-comment': {
          const was = before.mode;
          const a = was.m === 'commenting' ? annotationsRef.current.find((x) => x.id === was.annId) : undefined;
          if (a && was.m === 'commenting') saveComment(a, was.draft);
          break;
        }
        case 'show-popover':
          if (r.mode.m === 'idle') readPending();
          else setPending(null);
          break;
        case 'clear-selection':
          clearPending();
          break;
        case 'announce':
          showHint(r.ctx.tool);
          if (ev.e === 'swap') spaceHint();
          break;
        case 'crop-commit':
          void commitCrop();
          break;
        case 'crop-cancel':
          cropRect.current = null;
          cropStart.current = null;
          setCropDrag(null);
          break;
        case 'close-find':
          closeFind();
          break;
        case 'close-reader':
          closeReader();
          break;
        case 'root-hint':
          // Escape does not close the reader (D-329): once per session it says how.
          if (!rootHinted) {
            rootHinted = true;
            showText(t('reader.rootHint'), 4000);
          }
          break;
        default:
          break;
      }
    }
    if (r.mode.m !== 'erasing') setEraseIds((cur) => (cur.size > 0 ? new Set() : cur));
    return r;
  };
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  /** Opens a mode without an event (a click on an entry of the list selects that annotation). */
  const setMode = (m: Mode) => {
    mref.current = { ctx: mref.current.ctx, mode: m };
    setMachine(mref.current);
  };

  // The window lost the focus: strokes and popovers are dropped (the tool stays).
  useEffect(() => {
    const onBlur = () => dispatchRef.current({ e: 'blur' });
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, []);

  // With Select, a text selection made in any way (the keyboard too) offers the popover once it settles.
  useEffect(() => {
    if (!ready) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSelection = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const now = mref.current;
        if (now.ctx.tool !== 'select' || now.mode.m !== 'idle') return;
        readPending();
      }, 200);
    };
    document.addEventListener('selectionchange', onSelection);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', onSelection);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Find: typing searches after a short pause.
  useEffect(() => {
    if (!findOpen || !ready) return;
    const timer = setTimeout(() => (findText === '' ? viewerRef.current?.clearFind() : viewerRef.current?.find(findText)), 250);
    return () => clearTimeout(timer);
  }, [findText, findOpen, ready]);

  /** "Riposiziona": the text selected again replaces the rectangles of the annotation under review (same page). */
  const applyReposition = async () => {
    const at = ann.annotations.find((a) => a.id === repositionId);
    const piece = pending?.find((p) => p.page === at?.page);
    if (!at || !piece) return fail(t('reader.repair.samePage'));
    if (await repair.reposition(at, piece.rects, piece.text.slice(0, STUDY_LIMITS.annotationText))) {
      setRepositionId(null);
      clearPending();
    }
  };

  /** Keyboard path to annotate: the current find match becomes a highlight or underline (same normalisation as a selection). */
  const annotateMatch = (kind: 'highlight' | 'underline') => {
    const read = viewerRef.current?.readFindMatch();
    if (!read || read.pieces.length === 0) return fail(t('reader.findNoMatch'));
    void createFrom(kind, read.pieces, false, color);
  };

  const pick = (a: Annotation) => {
    setPending(null);
    setMode({ m: 'selected', annId: a.id });
    setSide('annotations');
    goTo(a.page, a.rects[0]?.y);
  };

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
  const zoomTo = (v: ZoomChoice) => (v === 'fit-width' ? viewerRef.current?.fitWidth() : viewerRef.current?.zoomTo(v));

  /* ---------------------------------------------------------------- pointer */

  const hitAt = (e: ReactPointerEvent) => {
    const at = viewerRef.current?.pointAt(e);
    return at ? annotationAt(annotationsRef.current, at.page, at.x, at.y) : undefined;
  };
  const onPointerDown = (e: ReactPointerEvent) => {
    if ((e.button !== 0 && e.button !== 5) || (e.target as Element).closest('a')) return;
    const hit = hitAt(e);
    const crop = mref.current.ctx.tool === 'crop' && (e.buttons & 32) === 0;
    const at = crop ? viewerRef.current?.pointAt(e) : null;
    // With Crop a drag can start anywhere on a page (the text layer does not matter); only an existing crop is "an annotation".
    const on = crop ? (hit?.kind === 'area' ? 'annotation' : at ? 'text' : 'empty') : (e.target as Element).closest('.textLayer') ? 'text' : hit ? 'annotation' : 'empty';
    const r = dispatch({ e: 'down', on, ...(on === 'annotation' && hit ? { annId: hit.id } : {}), pointerId: e.pointerId, pen: e.pointerType === 'pen' ? 'pen' : e.pointerType === 'touch' ? 'touch' : 'mouse', eraserButton: (e.buttons & 32) !== 0 });
    if (r.mode.m === 'cropping' && at) {
      cropStart.current = { page: at.page, x: at.x, y: at.y };
      cropRect.current = { page: at.page, rect: { x: at.x, y: at.y, w: 0, h: 0 } };
      setCropDrag(cropRect.current);
      containerRef.current?.setPointerCapture?.(e.pointerId);
    }
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (mref.current.mode.m === 'cropping') {
      const start = cropStart.current;
      const box = start ? layers.get(start.page)?.getBoundingClientRect() : undefined;
      if (start && box && box.width > 0 && box.height > 0) {
        cropRect.current = { page: start.page, rect: dragRect(start, { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height }) };
        setCropDrag(cropRect.current);
      }
      return;
    }
    if (mref.current.mode.m !== 'erasing') return;
    const at = viewerRef.current?.pointAt(e);
    if (at) dispatch({ e: 'move', annIdsUnder: annotationsAt(annotationsRef.current, at.page, at.x, at.y) });
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const m = mref.current.mode.m;
    if (m !== 'selecting' && m !== 'stroking' && m !== 'erasing' && m !== 'cropping') return;
    if (m === 'cropping') onPointerMove(e);
    lastUp.current = { x: e.clientX, y: e.clientY };
    const hit = hitAt(e);
    dispatch({ e: 'up', selectionText: window.getSelection()?.toString() ?? '', ...(hit ? { annId: hit.id } : {}) });
  };

  /* ---------------------------------------------------------------- keyboard */

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const inField = isEditable(e.target);
    const onButton = e.target instanceof HTMLElement && e.target.closest('button, [role^="menuitem"], [role="radio"]') !== null;
    // The reader shortcuts are the user's (keymap): find, close, and highlight or underline the current match.
    if (matches(e, 'reader.find')) return (e.preventDefault(), openFind());
    if (matches(e, 'reader.close')) return (e.preventDefault(), closeReader());
    if (findOpen && matches(e, 'reader.highlight')) return (e.preventDefault(), annotateMatch('highlight'));
    if (findOpen && matches(e, 'reader.underline')) return (e.preventDefault(), annotateMatch('underline'));
    if (mod && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 'g') return (e.preventDefault(), pageInputRef.current?.select());
      if (key === 'h' && !inField) return (e.preventDefault(), document.querySelector<HTMLElement>('[data-testid="reader-more"]')?.click());
      if (key === '=' || key === '+') return (e.preventDefault(), viewerRef.current?.zoomBy(1));
      if (key === '-') return (e.preventDefault(), viewerRef.current?.zoomBy(-1));
      if (key === '0') return (e.preventDefault(), viewerRef.current?.fitWidth());
      if (!inField && e.key === 'Home') return (e.preventDefault(), goTo(1));
      if (!inField && e.key === 'End') return (e.preventDefault(), goTo(pages));
      return;
    }
    if (e.key === 'Escape') {
      if (e.target === findInputRef.current) return (e.preventDefault(), closeFind());
      if (explain) return (e.preventDefault(), setExplain(null));
      if (confirm) return (e.preventDefault(), setConfirm(null));
      if (pending) return (e.preventDefault(), clearPending());
      const was = mref.current;
      const r = dispatch({ e: 'esc' });
      if (r.effects.length > 0 || r.ctx !== was.ctx || r.mode !== was.mode) e.preventDefault();
      return;
    }
    if (inField || e.altKey) return;
    // Shift+Space scrolls back one screen, as in Chrome (plain Space switches tool: 8.2.2).
    if (e.key === ' ' && e.shiftKey && !onButton) {
      e.preventDefault();
      containerRef.current?.scrollBy({ top: -(containerRef.current.clientHeight * 0.9) });
      return;
    }
    const id = resolveShortcut(e, keys, 'reader-tool') ?? (e.key === 'Backspace' ? 'reader.annotation.delete' : null);
    if (id) {
      const tool = TOOL_OF[id];
      const n = /^reader\.color\.([1-5])$/.exec(id)?.[1];
      let ev: Ev | null = null;
      if (tool) ev = { e: 'tool', tool };
      else if (id === 'reader.tool.swap') ev = onButton ? null : { e: 'swap', repeat: e.repeat };
      else if (n) ev = { e: 'color', n: Number(n) as ColorNo };
      else if (id === 'reader.comment') ev = { e: 'comment', current: selected?.comment ?? '' };
      else if (id === 'reader.annotation.delete') ev = { e: 'delete' };
      if (ev) {
        const was = mref.current;
        const r = dispatch(ev);
        // Space does not scroll when it switched the tool; the other keys are ours whenever they did something.
        if (r.ctx !== was.ctx || r.mode !== was.mode || ev.e === 'swap') e.preventDefault();
        return;
      }
    }
    if (e.key === 'n' || e.key === 'j') goTo(page + 1);
    else if (e.key === 'p' || e.key === 'k') goTo(page - 1);
  };

  /* ---------------------------------------------------------------- render */

  const title = safeText(doc?.title?.trim() || info?.title || '') || t('reader.untitled');
  const errorText = failure === null ? null : failure.kind === 'error' ? errorMessage(failure.error, t) : t(`reader.errors.${failure.kind}`);
  const markAnchor = useCallback((id: string): Anchor | null => {
    const r = document.querySelector(`[data-testid="annotation-mark"][data-annotation-id="${id}"]`)?.getBoundingClientRect();
    return r ? { left: r.left, top: r.top, bottom: r.bottom } : null;
  }, []);
  const selectionAnchor = useCallback((): Anchor | null => {
    const sel = window.getSelection();
    const r = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null;
    return r && (r.width > 0 || r.height > 0) ? { left: r.left, top: r.top, bottom: r.bottom } : { left: lastUp.current.x, top: lastUp.current.y, bottom: lastUp.current.y };
  }, []);

  // "✦ Spiega" (31): the selection (with the paragraph around it) or a crop (its caption and the text in it), each with its estimate.
  const modelLabel = (id: string) => config?.ai.models.find((m) => m.id === id)?.label ?? id;
  const selReq = useMemo(() => {
    const first = pending?.[0];
    if (!pending || !first) return null;
    const text = pending.map((p) => p.text).join(' ').slice(0, 6000);
    return { page: first.page, text, around: (viewerRef.current?.paragraphAround(first.page, text) ?? '').slice(0, 9000) };
  }, [pending]);
  const selEst = useExplainEstimate(docId, selReq);
  const cropReq = useMemo(() => {
    const rect = selected?.rects[0];
    if (!selected || selected.kind !== 'area' || !rect) return null;
    const near = viewerRef.current?.textNear(selected.page, rect) ?? { inside: '', around: '' };
    return { page: selected.page, text: [selected.crop?.caption ?? '', near.inside].filter(Boolean).join('\n').slice(0, 6000), around: near.around.slice(0, 9000) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.crop?.caption, ready]);
  const cropEst = useExplainEstimate(docId, cropReq);
  const askExplain = (req: ExplainRequest, anchor: () => Anchor | null) => setExplain({ req, anchor, key: Date.now() });

  const bar = (
    <ReaderBar
      title={title}
      ready={ready}
      tool={ctx.tool}
      color={ctx.color}
      away={away}
      onTool={(tool) => dispatch({ e: 'tool', tool }, true)}
      onColor={(n) => dispatch({ e: 'color', n }, true)}
      page={page}
      pages={pages}
      pageInput={pageInput}
      pageInputRef={pageInputRef}
      onPageInput={setPageInput}
      onGoPage={(n) => {
        goTo(n);
        containerRef.current?.focus();
      }}
      zoom={zoom}
      onZoom={zoomTo}
      findOpen={findOpen}
      onFind={() => (findOpen ? closeFind() : openFind())}
      doc={doc}
      pdf={pdf}
      onStudy={setStudyState}
      onUnderlined={setUnderlined}
      sideOpen={sideOpen}
      onSide={() => setSideOpen(!sideOpen)}
      canUndo={history.canUndo}
      onUndo={() => void history.undo()}
      onOpenFile={() => void rl.invoke('documents:open', { docId }).catch(reportError)}
      onReveal={() => void rl.invoke('documents:reveal', { docId }).catch(reportError)}
      onClose={closeReader}
    />
  );

  return (
    <section
      className="reader"
      aria-label={t('reader.regionLabel', { title })}
      data-testid="reader"
      data-doc-id={docId}
      onKeyDown={onKeyDown}
      onFocus={() => setAway(false)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setAway(true)}
    >
      {slot === undefined ? null : slot ? createPortal(bar, slot) : bar}
      {pdf.consentOpen(ann.annotations.length) && !consentDialog && <PdfConsentBanner onChoose={pdf.choose} />}
      {consentDialog && (
        <PdfConsentDialog
          onChoose={(c) => {
            setConsentDialog(false);
            pdf.choose(c);
            onClose();
          }}
          onClose={() => {
            setConsentDialog(false);
            onClose();
          }}
        />
      )}
      {pdf.ask === 'consent' && <PdfConsentDialog onChoose={pdf.choose} onClose={() => pdf.setAsk(null)} />}
      <PdfConfirmDialogs pdf={pdf} docId={docId} />
      <div className={sideOpen ? 'reader-body with-side' : 'reader-body'}>
        <div className="reader-main">
          {findOpen && (
            <FindBar
              inputId={findId}
              inputRef={findInputRef}
              text={findText}
              state={findState}
              onText={setFindText}
              onStep={(backwards) => viewerRef.current?.find(findText, { again: true, backwards })}
              onAnnotate={annotateMatch}
              onClose={closeFind}
            />
          )}
          {ann.stale && (
            <p className="callout reader-stale" role="alert" data-testid="reader-stale">
              {t('reader.stale')}
            </p>
          )}
          {hint && (
            <span className="reader-hint" role="status" aria-live="polite" data-testid="reader-tool-hint">
              {hint}
            </span>
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
            className={`reader-scroll ann-${color}`}
            tabIndex={0}
            role="document"
            aria-label={t('reader.pagesLabel')}
            hidden={errorText !== null}
            data-tool={ctx.tool}
            data-away={away ? '' : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => dispatch({ e: 'cancel' })}
            data-testid="reader-pages-area"
          >
            <div ref={viewerElRef} className="pdfViewer" />
            <AnnotationLayers layers={layers} annotations={ann.annotations} selectedId={selectedId} staleIds={ann.staleIds} erasing={eraseIds} />
            <CropLayer drag={cropDrag} layers={layers} />
          </div>
          {pending && !explain && (
            <SelectionPopover
              anchor={selectionAnchor}
              text={pending.map((p) => p.text).join(' … ')}
              notice={skipped > 0 ? t('reader.skipped', { count: skipped }) : undefined}
              busy={busy}
              color={color}
              onHighlight={() => void createFrom('highlight', pending, true, color)}
              onCopy={() => void navigator.clipboard?.writeText(pending.map((p) => p.text).join(' ')).then(() => notifyInfo(t('reader.ann.copied')), reportError)}
              onReposition={repositionId ? () => void applyReposition() : undefined}
              explainLabel={costLabel(t, t('reader.explain.button'), selEst, selEst ? modelLabel(selEst.model) : '')}
              onExplain={selReq ? () => askExplain({ ...selReq, from: 'selection' }, selectionAnchor) : undefined}
            />
          )}
          {!pending && !explain && selected?.kind === 'area' && (
            <CropPopover
              key={selected.id}
              annotation={selected}
              anchor={() => markAnchor(selected.id)}
              busy={busy}
              explainLabel={costLabel(t, t('reader.explain.crop'), cropEst, cropEst ? modelLabel(cropEst.model) : '')}
              explainDisabled={cropReq && cropReq.text.trim() === '' ? t('reader.explain.cropNoText') : undefined}
              onType={(type) => void change(selected, { crop: { type, ...(selected.crop?.caption ? { caption: selected.crop.caption } : {}) } })}
              onCaption={(caption) => void change(selected, { crop: { type: selected.crop?.type ?? 'figure', ...(caption ? { caption } : {}) } })}
              onCopyImage={() =>
                void rl.invoke('crops:get', { docId, annId: selected.id }).then((r) => (r.image ? copyCropImage(r.image).then(() => notifyInfo(t('reader.crop.copied'))) : fail(t('reader.crop.failed'))), reportError)
              }
              onExplain={() => cropReq && askExplain({ ...cropReq, from: 'crop' }, () => markAnchor(selected.id))}
              onDelete={() => dispatch({ e: 'delete' }, true)}
            />
          )}
          {!pending && !explain && selected && selected.kind !== 'area' && (
            <AnnotationPopover
              key={selected.id}
              annotation={selected}
              anchor={() => markAnchor(selected.id)}
              commenting={mode.m === 'commenting'}
              draft={mode.m === 'commenting' ? mode.draft : (selected.comment ?? '')}
              busy={busy}
              stale={ann.staleIds.has(selected.id)}
              onColor={(n) => dispatch({ e: 'color', n }, true)}
              onOpenComment={() => dispatch({ e: 'comment', current: selected.comment ?? '' }, true)}
              onDraft={(v) => dispatch({ e: 'draft', value: v }, true)}
              onCommit={() => dispatch({ e: 'commit-comment' }, true)}
              onDelete={() => dispatch({ e: 'delete' }, true)}
              onReconfirm={() => void change(selected, {})}
            />
          )}
          {explain && (
            <Lazy>
              <ExplainCard key={explain.key} docId={docId} request={explain.req} anchor={explain.anchor} onClose={() => setExplain(null)} />
            </Lazy>
          )}
          {confirm && (
            <ConfirmErase
              anchor={() => confirm.at}
              count={confirm.ids.length}
              onConfirm={() => {
                void removeIds(confirm.ids);
                setConfirm(null);
              }}
              onCancel={() => setConfirm(null)}
            />
          )}
        </div>

        {sideOpen && (
          <aside className="reader-side" aria-label={t('reader.panel')} data-testid="reader-side-panel">
            <div className="rl-tabs" role="tablist" aria-label={t('reader.panel')}>
              {SIDES.map((id) => (
                <button key={id} type="button" role="tab" id={`reader-panel-${id}`} aria-selected={side === id} aria-controls="reader-sidepanel" className={side === id ? 'rl-tab is-on' : 'rl-tab'} onClick={() => setSide(id)} data-testid={`reader-panel-${id}`}>
                  {t(`reader.sides.${id}`)}
                </button>
              ))}
            </div>
            <div role="tabpanel" id="reader-sidepanel" aria-labelledby={`reader-panel-${side}`} className="reader-tabpanel">
              {side === 'annotations' && (
                <AnnotationList
                  docId={docId}
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
                  onKind={(a, kind) => void change(a, { kind })}
                  onDelete={(a) => void removeMany([a])}
                />
              )}
              {side === 'notes' && (
                <>
                  <div className="rl-seg rl-seg--sm" role="radiogroup" aria-label={t('reader.sides.notes')}>
                    {SCOPES.map((id) => (
                      <button key={id} type="button" role="radio" aria-checked={scope === id} className={scope === id ? 'rl-seg__opt is-on' : 'rl-seg__opt'} onClick={() => setScope(id)} data-testid={`reader-tab-${id}`}>
                        {t(`reader.tabs.${id}`)}
                      </button>
                    ))}
                  </div>
                  {scope === 'pageNote' && <NoteEditor key={`page-${page}`} docId={docId} page={page} testId="note-page" />}
                  {scope === 'fileNote' && <NoteEditor key="file" docId={docId} testId="note-file" />}
                  {scope === 'notes' && (
                    <NotesList
                      docId={docId}
                      onOpen={(p) => {
                        if (p === null) setScope('fileNote');
                        else {
                          setScope('pageNote');
                          goTo(p);
                        }
                      }}
                    />
                  )}
                </>
              )}
              {side === 'info' && (
                <dl className="reader-info" data-testid="reader-info">
                  <dt>{t('doc.studyState')}</dt>
                  <dd data-testid="reader-info-state">{doc ? t(`study.${doc.study.state}`) : ''}</dd>
                  <dt>{t('doc.underlined')}</dt>
                  <dd>
                    {doc?.study.underlined.value ? t('reader.info.yes') : t('reader.info.no')}
                    {doc?.study.underlined.value && (
                      <span className="hint" data-testid="reader-underlined-origin" data-origin={doc.study.underlined.origin}>
                        {' · '}
                        {t(`reader.underlinedOrigin_${doc.study.underlined.origin}`)}
                      </span>
                    )}
                  </dd>
                  <dt>{t('reader.info.pdf')}</dt>
                  <dd>
                    <PdfInfoRow pdf={pdf} />
                  </dd>
                </dl>
              )}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
