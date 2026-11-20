import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ANNOTATION_COLORS, type StudyState } from '@rl/core';
import { Lazy, lazyView } from '../../components/Lazy';
import { Popover } from '../../components/Popover';
import { Icon } from '../../shell/shellIcons';
import { ColorDots } from './AnnotationPopover';
import { colorName as meaningName, useColorMeanings } from './colorMeaning';
import { usePdfGroup, type PdfWrite } from './PdfWriteChip';
import { ReaderMenu, type RGroup } from './ReaderMenu';
import type { ColorNo, Tool } from './toolMachine';
import type { ReaderDoc } from './useReaderDoc';

// The list of changes loads when "History" is chosen.
const HistoryPanel = lazyView(() => import('../../lib/HistoryPanel').then((m) => ({ default: m.HistoryPanel })), ['history']);

/** The drawings of the reader bar (same 24 grid and stroke as the shell icons; the shell table is in the first screen, this one is not). */
const GLYPH = {
  select: 'M4 4l7 17 2.5-7.5L21 11z',
  highlight: 'm9 11-6 6v3h9l3-3|m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4',
  underline: 'M6 4v6a6 6 0 0 0 12 0V4|M4 20h16',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14|M18 22V8a2 2 0 0 0-2-2H2',
  eraser: 'm7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21|M22 21H7|m5 11 9 9',
  panel: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z|M15 3v18',
  more: 'M12 12h.01|M19 12h.01|M5 12h.01',
} as const;
function Glyph({ name }: { name: keyof typeof GLYPH }) {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {GLYPH[name].split('|').map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

const STUDY: StudyState[] = ['to-read', 'reading', 'read'];
const TOOLS = ['select', 'highlight', 'underline', 'crop', 'eraser'] as const;
const KEY: Record<(typeof TOOLS)[number], string> = { select: 'V', highlight: 'H', underline: 'U', crop: 'R', eraser: 'E' };

export type ZoomChoice = number | 'fit-width' | 'page-fit';

interface Props {
  title: string;
  ready: boolean;
  tool: Tool;
  color: ColorNo;
  /** The focus is outside the reader: its keys do not act, and the tools dim. */
  away: boolean;
  onTool(t: Tool): void;
  onColor(n: ColorNo): void;
  page: number;
  pages: number;
  pageInput: string;
  pageInputRef: RefObject<HTMLInputElement | null>;
  onPageInput(v: string): void;
  onGoPage(n: number): void;
  zoom: { percent: number; fit: boolean };
  onZoom(v: ZoomChoice): void;
  findOpen: boolean;
  onFind(): void;
  doc: ReaderDoc | null;
  /** The PDF group of the Study menu (G4a). */
  pdf: PdfWrite;
  onStudy(s: StudyState): void;
  onUnderlined(v: boolean): void;
  sideOpen: boolean;
  onSide(): void;
  /** Side by side (feature 3): the panel is closed while two papers are open, with this reason on the button. */
  sideDisabled?: string | undefined;
  /** Two papers are open: the menu entry closes the split instead of opening it. */
  split?: boolean;
  onSideBySide(): void;
  /** The guide checkbox of the menu (experiment 30): only passed while Experimental features is on. */
  guide?: { on: boolean; onToggle(): void } | undefined;
  canUndo: boolean;
  onUndo(): void;
  onLiterature(): void;
  canRedo: boolean;
  onRedo(): void;
  onOpenFile(): void;
  onReveal(): void;
  onClose(): void;
}

/** A bar button that never takes the focus on a click (the pages keep it, so Space still switches tool), 32 x 32. */
function BarButton({ label, keys, pressed, disabled, reason, testId, children, onClick, buttonRef, expanded }: { label: string; keys?: string; pressed?: boolean; disabled?: boolean; reason?: string; testId: string; children: ReactNode; onClick(): void; buttonRef?: RefObject<HTMLButtonElement | null>; expanded?: boolean }) {
  const tip = disabled && reason ? `${label}: ${reason}` : keys ? `${label} · ${keys}` : label;
  return (
    <button
      ref={buttonRef}
      type="button"
      className={pressed ? 'rl-iconbtn rl-iconbtn--ghost rl-iconbtn--md is-pressed' : 'rl-iconbtn rl-iconbtn--ghost rl-iconbtn--md'}
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-disabled={disabled || undefined}
      title={tip}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => !disabled && onClick()}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

/**
 * The bar of the reader (4.3, D-410): 13 controls in one 48 px row that replaces the top bar of the shell. Close, five
 * tools (Select, Highlight, Underline, Crop, Eraser), the colour dot, the page field, the zoom menu, find, Study, the panel
 * and More. The title is only text.
 */
export function ReaderBar(p: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<null | 'color' | 'zoom' | 'study' | 'more' | 'history'>(null);
  const colorBtn = useRef<HTMLButtonElement>(null);
  const zoomBtn = useRef<HTMLButtonElement>(null);
  const studyBtn = useRef<HTMLButtonElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(null);
  const colorName = ANNOTATION_COLORS[p.color - 1]!;
  const meanings = useColorMeanings();

  const zoomGroups: RGroup[] = [
    {
      id: 'zoom',
      items: [
        { id: 'w', label: t('reader.fitWidth'), keys: 'Ctrl+0', testId: 'reader-fit', onSelect: () => p.onZoom('fit-width') },
        { id: 'p', label: t('reader.fitPage'), testId: 'reader-fit-page', onSelect: () => p.onZoom('page-fit') },
        { id: '1', label: '100 %', testId: 'reader-zoom-100', onSelect: () => p.onZoom(1) },
        { id: '15', label: '150 %', testId: 'reader-zoom-150', onSelect: () => p.onZoom(1.5) },
      ],
    },
  ];
  const study = p.doc?.study;
  const pdfGroup = usePdfGroup(p.pdf);
  const studyGroups: RGroup[] = [
    {
      id: 'state',
      heading: t('reader.studyState'),
      items: [
        ...STUDY.map((s) => ({ id: s, label: t(`study.${s}`), checked: study?.state === s, testId: `reader-study-${s}`, onSelect: () => p.onStudy(s) })),
      ],
    },
    pdfGroup,
  ];
  const moreGroups: RGroup[] = [
    {
      id: 'a',
      items: [
        { id: 'undo', label: t('history.undo'), keys: 'Ctrl+Z', testId: 'reader-undo', ...(p.canUndo ? {} : { disabled: t('history.nothingToUndo') }), onSelect: p.onUndo },
        { id: 'redo', label: t('history.redo'), keys: 'Ctrl+Y', testId: 'reader-redo', ...(p.canRedo ? {} : { disabled: t('history.nothingToRedo') }), onSelect: p.onRedo },
        { id: 'history', label: t('history.title'), keys: 'Ctrl+H', testId: 'reader-history', onSelect: () => setOpen('history') },
        { id: 'lit', label: t('reader.litNote'), testId: 'reader-literature', onSelect: p.onLiterature },
        { id: 'side', label: p.split ? t('reader.unsplit') : t('reader.sideBySide'), testId: 'reader-side-by-side', onSelect: p.onSideBySide },
      ],
    },
    {
      id: 'b',
      items: [
        { id: 'open', label: t('reader.openDefault'), testId: 'reader-open-file', onSelect: p.onOpenFile },
        { id: 'reveal', label: t('reader.reveal'), testId: 'reader-reveal', onSelect: p.onReveal },
        { id: 'export', label: t('reader.exportCopy'), testId: 'reader-export-copy', ...(p.pdf.busy ? { disabled: t('reader.pdf.busy') } : {}), onSelect: () => void p.pdf.exportCopy() },
      ],
    },
    // The guide checkbox exists only while Experimental features is on; with it off the menu has no trace of it.
    { id: 'c', items: p.guide ? [{ id: 'guide', label: t('reader.guideMode'), keys: 'G', checked: p.guide.on, testId: 'reader-guide', onSelect: p.guide.onToggle }] : [] },
  ].filter((g) => g.items.length > 0);

  const tools = TOOLS.map((id) => {
    const label = t(`reader.tools.${id}`);
    return (
      <span key={id} className="rbar__tool">
        <BarButton label={label} keys={KEY[id]} pressed={p.tool === id} testId={`reader-tool-${id}`} onClick={() => p.onTool(id as Tool)}>
          <Glyph name={id} />
          {(id === 'highlight' || id === 'underline') && <span className={`rbar__cd ann-${colorName}`} aria-hidden="true" />}
        </BarButton>
      </span>
    );
  });

  return (
    <div className="rbar" data-testid="reader-bar">
      <div className="rbar__grp rbar__title">
        <BarButton label={t('reader.back')} keys="Alt+←" testId="reader-close" onClick={p.onClose}>
          <Icon name="close" />
        </BarButton>
        <span className="reader-title__root">{t('sections.library')} ›</span>
        <h2 className="reader-title" title={p.title} data-testid="reader-title">
          {p.title}
        </h2>
      </div>
      <div className="rbar__grp" role="toolbar" aria-label={t('reader.tools.label')} data-testid="reader-toolbar" data-away={p.away ? '' : undefined}>
        {tools}
        <BarButton label={t('reader.colorPip', { name: meaningName(t, colorName, meanings) })} keys="1-5" expanded={open === 'color'} testId="ann-color" buttonRef={colorBtn} onClick={() => setOpen(open === 'color' ? null : 'color')}>
          <span className={`rbar__pip ann-${colorName}`} aria-hidden="true" />
        </BarButton>
        <Popover anchor={colorBtn} open={open === 'color'} onClose={close} label={t('reader.ann.color')} width={196}>
          <div className="rbar__colors">
            <ColorDots
              value={colorName}
              label={t('reader.ann.color')}
              prefix="ann-color"
              onPick={(n) => {
                p.onColor(n);
                close();
              }}
            />
          </div>
        </Popover>
      </div>
      <div className="rbar__grp">
        <label className="sr-only" htmlFor="reader-page-field">
          {t('reader.goToPage')}
        </label>
        <input
          ref={p.pageInputRef}
          id="reader-page-field"
          className="reader-page-input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={p.pageInput}
          disabled={!p.ready}
          onChange={(e) => p.onPageInput(e.target.value.replace(/\D/g, '').slice(0, 5))}
          onBlur={() => p.onPageInput(String(p.page))}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const n = Number.parseInt(p.pageInput, 10);
            if (Number.isFinite(n)) p.onGoPage(n);
          }}
          data-testid="reader-page-input"
        />
        <span className="reader-pages" data-testid="reader-pages">
          {t('reader.pageTotal', { count: p.pages })}
        </span>
      </div>
      <div className="rbar__grp">
        <button
          ref={zoomBtn}
          type="button"
          className="rbar__zoom"
          aria-haspopup="menu"
          aria-expanded={open === 'zoom'}
          aria-label={t('reader.zoomLevel', { percent: p.zoom.percent })}
          title={`${t('reader.zoom')} · Ctrl+ / Ctrl−`}
          disabled={!p.ready}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen(open === 'zoom' ? null : 'zoom')}
          data-testid="reader-zoom"
        >
          {p.zoom.percent} % <Icon name="chevron" size={16} />
        </button>
        <ReaderMenu anchor={zoomBtn} open={open === 'zoom'} onClose={close} groups={zoomGroups} label={t('reader.zoom')} width={220} />
        <BarButton label={t('reader.find')} keys="Ctrl+F" pressed={p.findOpen} disabled={!p.ready} testId="reader-find-toggle" onClick={p.onFind}>
          <Icon name="search" />
        </BarButton>
      </div>
      <div className="rbar__grp">
        <button
          ref={studyBtn}
          type="button"
          className="rbar__study"
          aria-haspopup="menu"
          aria-expanded={open === 'study'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen(open === 'study' ? null : 'study')}
          data-testid="reader-study-menu"
        >
          {t('reader.study')} <Icon name="chevron" size={16} />
        </button>
        <ReaderMenu anchor={studyBtn} open={open === 'study'} onClose={close} groups={studyGroups} label={t('reader.study')} width={280} />
      </div>
      <div className="rbar__grp rbar__end">
        <BarButton label={t('reader.panel')} pressed={p.sideOpen} disabled={!!p.sideDisabled} reason={p.sideDisabled} testId="reader-side" onClick={p.onSide}>
          <Glyph name="panel" />
        </BarButton>
        <BarButton label={t('reader.more')} expanded={open === 'more'} testId="reader-more" buttonRef={moreBtn} onClick={() => setOpen(open === 'more' ? null : 'more')}>
          <Glyph name="more" />
        </BarButton>
        <ReaderMenu anchor={moreBtn} open={open === 'more'} onClose={close} groups={moreGroups} label={t('reader.more')} width={300} placement="bottom-end" />
        {open === 'history' && (
          <Lazy>
            <HistoryPanel id="reader-history-panel" anchor={moreBtn} onClose={close} />
          </Lazy>
        )}
      </div>
    </div>
  );
}
