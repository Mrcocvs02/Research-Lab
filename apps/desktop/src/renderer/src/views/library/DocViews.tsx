import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { RlError } from '../../lib/rl-error';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { IconCheck, IconMore } from '../../components/icons';
import { Menu, type MenuGroups } from '../../components/Menu';
import { VirtualList } from '../../components/VirtualList';
import { rl } from '../../lib/rl';
import { useNotify } from '../../lib/notify';
import { thumbs, useThumbUrl } from '../../lib/thumbs';
import { canRead, useReader, type ReaderPanel } from '../../lib/reader';
import type { DocList, DocRow } from './useDocumentList';
import { clickSelect, emptySelection, indexOfId, moveSelect, rangeHasHoles, selectAll, toggleActive, type SelectionState } from './selection';
import { baseName, fileExt } from './fileName';
import { formatSize } from './formatSize';
import { safeText } from './safeText';
import { plainSnippet, Snippet } from './Snippet';
import { TagChip } from './TagParts';
import { resolveId } from './taxonomyModel';
import { useTaxonomy } from './useTaxonomy';

export { baseName, fileExt };
export type ViewMode = 'list' | 'grid';

export const ROW_HEIGHT = { browse: 60, search: 100, card: 188 } as const;
const CARD_MIN_WIDTH = 236;

/**
 * The first page of a PDF in the grid (D-196), or the type icon: while the image is not there yet, for every other
 * format and for a missing file. The image is decoration (empty alt): the title stays the label of the card.
 */
function GridThumb({ docId, path, missing }: { docId: string; path: string; missing: boolean }) {
  const url = useThumbUrl(fileExt(path) === 'pdf' && !missing ? docId : null);
  const [broken, setBroken] = useState<string | null>(null);
  return (
    <span className="doc-thumb" data-testid="doc-thumb" data-has-image={url !== null && broken !== url ? 'true' : 'false'}>
      {url !== null && broken !== url ? <img src={url} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(url)} /> : <TypeIcon path={path} large />}
    </span>
  );
}

/** A document glyph with the file format on it; the colour follows the format. */
export function TypeIcon({ path, large }: { path: string; large?: boolean }) {
  const ext = fileExt(path);
  const kind = ['pdf'].includes(ext) ? 'pdf' : ['md', 'txt', 'tex', 'rst'].includes(ext) ? 'text' : ['doc', 'docx', 'odt', 'rtf'].includes(ext) ? 'word' : ['ppt', 'pptx', 'odp'].includes(ext) ? 'slides' : ['ipynb'].includes(ext) ? 'notebook' : 'other';
  return (
    <span className={`type-icon type-${kind}${large ? ' large' : ''}`} aria-hidden="true" data-ext={ext}>
      <svg viewBox="0 0 24 30" width="100%" height="100%" focusable="false">
        <path d="M3 1h12l6 6v21a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M15 1v6h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <span className="type-ext">{ext.slice(0, 4).toUpperCase() || '·'}</span>
    </span>
  );
}

function StudyBadge({ state }: { state: DocRow['studyState'] }) {
  const { t } = useTranslation();
  return (
    <span className={`study study-${state}`} data-testid="study-badge" data-state={state}>
      {t(`study.${state}`)}
    </span>
  );
}

function Tags({ tags, max }: { tags: string[] | null; max: number }) {
  const { t } = useTranslation();
  const { model } = useTaxonomy();
  if (!tags || tags.length === 0) return null;
  const shown = tags.slice(0, max);
  return (
    <span className="doc-tags" data-testid="doc-tags">
      {shown.map((id) => {
        const node = model.byId.get(resolveId(model, id));
        return <TagChip key={id} id={id} label={node?.label ?? id} color={node?.color} deprecated={node?.status === 'deprecated'} />;
      })}
      {tags.length > max && <span className="tag tag-more">{t('docs.moreTags', { count: tags.length - max })}</span>}
    </span>
  );
}

interface ItemProps {
  row: DocRow | undefined;
  view: ViewMode;
  selected: boolean;
  active: boolean;
  searching: boolean;
  onClick(e: MouseEvent): void;
  onDoubleClick(): void;
  onOpenFile(): void;
  onReveal(): void;
  /** Opens the reader on this document, at a page and tab when given. */
  onRead(page?: number, panel?: ReaderPanel): void;
  /** Opens the card (the place of the file note). */
  onDetail(): void;
  /** The checkbox of the row: adds it to or takes it out of the selection (as Ctrl+click). */
  onToggle(): void;
  /** The list is sorted by size: the size of the file is shown. */
  showSize: boolean;
}

/** The menu of a row: the two actions that leave the app (D-333; the reader and the card have buttons). */
function rowMenu(t: ReturnType<typeof useTranslation>['t'], missing: boolean, openFile: () => void, reveal: () => void): MenuGroups {
  const why = t('docs.missing');
  return [
    {
      id: 'file',
      items: [
        missing ? { id: 'open', label: t('library.openDefault'), disabled: true, disabledReason: why, onSelect: openFile } : { id: 'open', label: t('library.openDefault'), onSelect: openFile },
        missing ? { id: 'reveal', label: t('docs.reveal'), disabled: true, disabledReason: why, onSelect: reveal } : { id: 'reveal', label: t('docs.reveal'), onSelect: reveal },
      ],
    },
  ];
}

const DocItem = memo(function DocItem({ row, view, selected, active, searching, onClick, onDoubleClick, onOpenFile, onReveal, onRead, onDetail, onToggle, showSize }: ItemProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const moreRef = useRef<HTMLSpanElement>(null);
  if (!row) return <div className={`doc-${view === 'grid' ? 'card' : 'row'} skeleton`} aria-hidden="true" />;
  const title = safeText(row.title?.trim() || baseName(row.path));
  const authors = safeText(row.authors.slice(0, 3).join(', ')) + (row.authors.length > 3 ? ' …' : '');
  const meta = [authors, row.year, row.type === null ? null : safeText(row.type)].filter((x) => x !== '' && x !== null && x !== undefined);
  const readable = canRead(row.path, row.missing);
  const cls = ['doc', view === 'grid' ? 'doc-card' : 'doc-row', selected ? 'is-selected' : '', active ? 'active' : '', row.missing ? 'missing' : ''].filter(Boolean).join(' ');
  return (
    <div
      id={`doc-${row.docId}`}
      role="option"
      aria-selected={selected}
      className={cls}
      data-testid="search-result"
      data-doc-id={row.docId}
      data-view={view}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <span className={selected ? 'doc-cb is-on' : 'doc-cb'} aria-hidden="true" data-testid="row-check" onClick={(e) => { e.stopPropagation(); onToggle(); }} onDoubleClick={(e) => e.stopPropagation()}>
        {selected && <IconCheck size={16} />}
      </span>
      {view === 'grid' ? <GridThumb docId={row.docId} path={row.path} missing={row.missing} /> : <TypeIcon path={row.path} />}
      <div className="doc-main">
        <h3 className="result-title" data-testid="result-title" title={title}>
          {title}
        </h3>
        <div className="doc-sub">
          {meta.length > 0 && <p className="result-meta">{meta.join(' · ')}</p>}
          <Tags tags={row.tags} max={view === 'grid' ? 3 : 4} />
        </div>
        {view === 'list' && searching && row.snippet && (
          <p className="result-snippet" data-testid="result-snippet" data-field={row.field}>
            {(row.field === 'note' || row.field === 'annotation') && (
              <button
                type="button"
                className="badge badge-hit"
                tabIndex={-1}
                title={row.page !== undefined && readable ? t('search.openAtPage', { page: row.page }) : t('search.openNotes')}
                onClick={(e) => {
                  e.stopPropagation();
                  if (row.page !== undefined && readable) onRead(row.page, row.field === 'note' ? 'pageNote' : 'annotations');
                  // The index does not know which page a matched note is on: for a PDF the reader opens on the list of its
                  // notes (one click to the right page); other files show the card with the file note.
                  else if (row.field === 'note') (readable ? onRead(undefined, 'notes') : onDetail());
                  else if (readable) onRead(undefined, 'annotations');
                }}
                data-testid="hit-field"
                data-field={row.field}
              >
                {t(`search.hitIn.${row.field}`)}
              </button>
            )}{' '}
            <Snippet text={row.snippet} />
          </p>
        )}
        {view === 'list' && searching && row.pages && row.pages.length > 0 && (
          <p className="result-pages" data-testid="result-pages">
            <span className="result-pages-label">{t('search.pagesLabel')}</span>{' '}
            {row.pages.slice(0, 8).map((p) => (
              readable ? (
                <button key={p.page} type="button" className="page-chip" tabIndex={-1} data-page={p.page} title={plainSnippet(p.snippet)} aria-label={t('search.openAtPage', { page: p.page })} onClick={(e) => { e.stopPropagation(); onRead(p.page); }}>
                  {t('search.page', { page: p.page })}
                </button>
              ) : (
                <span key={p.page} className="page-chip" data-page={p.page} title={plainSnippet(p.snippet)}>
                  {t('search.page', { page: p.page })}
                </span>
              )
            ))}
          </p>
        )}
      </div>
      <div className="doc-side">
        {showSize && (
          <span className="doc-size" data-testid="doc-size" title={t('docs.sizeTitle', { bytes: row.size })}>
            {formatSize(row.size)}
          </span>
        )}
        <StudyBadge state={row.studyState} />
        {row.missing && <span className="badge badge-warn">{t('docs.missing')}</span>}
        <span className="doc-actions" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          {readable ? (
            <Button size="sm" variant="primary" tabIndex={-1} onClick={() => onRead()} data-testid="row-read">
              {t('docs.read')}
            </Button>
          ) : (
            <Button size="sm" variant="primary" tabIndex={-1} disabled={row.missing} disabledReason={t('docs.missing')} onClick={onOpenFile} data-testid="row-open">
              {t('library.open')}
            </Button>
          )}
          <Button size="sm" tabIndex={-1} onClick={onDetail} data-testid="row-detail">
            {t('docs.details')}
          </Button>
          <span ref={moreRef}>
            <IconButton label={t('library.rowMore')} variant="secondary" size="sm" tabIndex={-1} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)} data-testid="row-more">
              <IconMore size={16} />
            </IconButton>
          </span>
          {menuOpen && (
            <Menu
              anchor={moreRef}
              open
              onClose={() => setMenuOpen(false)}
              label={t('library.rowMore')}
              width={260}
              groups={rowMenu(t, row.missing, onOpenFile, onReveal)}
            />
          )}
        </span>
      </div>
    </div>
  );
});

interface Props {
  list: DocList;
  view: ViewMode;
  searching: boolean;
  selection: SelectionState;
  onSelection(next: SelectionState): void;
  /** Enter, or a click on an already-selected single row: show the document card. */
  onOpenDetail(docId: string): void;
  /** Delete / Backspace: never deletes by itself; the view asks before doing anything. */
  onDeleteKey(): void;
  ariaLabel: string;
  /** The list is sorted by file size: rows show it. */
  showSize?: boolean;
}

/** The documents as a virtualised list or grid with multi-selection and keyboard navigation. */
export function DocViews({ list, view, searching, selection, onSelection, onOpenDetail, onDeleteKey, ariaLabel, showSize = false }: Props) {
  const { reportError, fail, info } = useNotify();
  const { t } = useTranslation();
  const { openReader } = useReader();
  const [columns, setColumns] = useState(1);
  const selRef = useRef(selection);
  selRef.current = selection;

  const openFile = useCallback(
    (docId: string) =>
      rl.invoke('documents:open', { docId }).catch((e: unknown) => (RlError.from(e).code === 'PERMISSION_DENIED' ? fail(t('docs.openRefused')) : reportError(e))),
    [reportError, fail, t],
  );
  const reveal = useCallback((docId: string) => rl.invoke('documents:reveal', { docId }).catch(reportError), [reportError]);

  /** Row ids in order, loading everything first when a range crosses rows that are not loaded. */
  const orderFor = (fromId: string | null, to: number): Array<string | undefined> | Promise<Array<string | undefined>> => {
    const order = list.ids();
    if (fromId !== null) {
      const from = order.indexOf(fromId);
      // An anchor that is not loaded (its page was dropped) or a range over unloaded rows: load everything first.
      if (from < 0 || rangeHasHoles(order, from, to)) return list.loadAll().then(() => list.ids());
    }
    return order;
  };

  /** Applies  to the order now when every row is loaded, else after loading them (a range across pages). */
  const withOrder = (from: string | null, to: number, apply: (order: Array<string | undefined>) => void) => {
    const order = orderFor(from, to);
    if (Array.isArray(order)) apply(order);
    else void order.then(apply);
  };

  const click = (index: number, e: MouseEvent) => {
    const mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
    withOrder(mods.shift ? selRef.current.anchor : null, index, (order) => onSelection(clickSelect(selRef.current, order, index, mods)));
  };

  const toggle = (index: number) => withOrder(null, index, (order) => onSelection(clickSelect(selRef.current, order, index, { shift: false, ctrl: true })));

  const onKeyDown = (e: KeyboardEvent) => {
    const mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
    const page = 8 * columns;
    let move: number | 'home' | 'end' | null = null;
    switch (e.key) {
      case 'ArrowDown':
        move = columns;
        break;
      case 'ArrowUp':
        move = -columns;
        break;
      case 'ArrowRight':
        if (view === 'grid') move = 1;
        break;
      case 'ArrowLeft':
        if (view === 'grid') move = -1;
        break;
      case 'PageDown':
        move = page;
        break;
      case 'PageUp':
        move = -page;
        break;
      case 'Home':
        move = 'home';
        break;
      case 'End':
        move = 'end';
        break;
      default:
    }
    if (move !== null) {
      e.preventDefault();
      const cur = selRef.current;
      const activeAt = indexOfId(list.ids(), cur.active);
      const target = move === 'home' ? 0 : move === 'end' ? list.total - 1 : (activeAt >= 0 ? activeAt : move < 0 ? list.total : -1) + move;
      const m = move;
      withOrder(mods.shift ? (cur.anchor ?? cur.active) : null, Math.max(0, Math.min(list.total - 1, target)), (order) => onSelection(moveSelect(cur, order, m, mods)));
      return;
    }
    if ((e.key === 'a' || e.key === 'A') && mods.ctrl) {
      e.preventDefault();
      // Ids only: the rows that are not loaded stay on the server.
      // The server returns at most `idsMax` ids: when the result is longer, say how much of it is selected (D-178).
      void list.allIds().then((ids) => {
        onSelection(selectAll(ids));
        if (list.total > ids.length) info(t('docs.selectCapped', { selected: ids.length, total: list.total }));
      }, reportError);
    } else if (e.key === ' ' && mods.ctrl) {
      e.preventDefault();
      onSelection(toggleActive(selRef.current, list.ids()));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // 3.2: Enter reads (a PDF) or opens the file; Shift+Enter opens the card; Ctrl+Enter opens the file in the other program.
      const id = selRef.current.active;
      if (!id) return;
      const at = indexOfId(list.ids(), id);
      const row = at >= 0 ? list.rowAt(at) : undefined;
      if (mods.ctrl) void openFile(id);
      else if (mods.shift) onOpenDetail(id);
      else if (row && canRead(row.path, row.missing)) openReader(id);
      else void openFile(id);
    } else if ((e.key === 'r' || e.key === 'R') && !mods.ctrl && !e.altKey) {
      // R: read the active document in the app (PDFs only).
      e.preventDefault();
      const at = indexOfId(list.ids(), selRef.current.active);
      const row = at >= 0 ? list.rowAt(at) : undefined;
      if (row && canRead(row.path, row.missing)) openReader(row.docId);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDeleteKey();
    } else if (e.key === 'Escape' && selRef.current.ids.size > 0) {
      e.stopPropagation();
      onSelection(emptySelection());
    }
  };

  // The focus is tracked by id; its position follows the list when rows are added, removed or reordered.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const activeIndex = useMemo(() => { const at = indexOfId(list.ids(), selection.active); return at >= 0 ? at : null; }, [list.version, list.total, selection.active]);
  const activeRow = activeIndex !== null ? list.rowAt(activeIndex) : undefined;
  const itemHeight = view === 'grid' ? ROW_HEIGHT.card : searching ? ROW_HEIGHT.search : ROW_HEIGHT.browse;
  // The rows around the viewport, as the virtual list reports them: the PDFs among them get a thumbnail (grid only).
  const [shown, setShown] = useState<readonly [number, number]>([0, -1]);
  const range = useCallback(
    (a: number, b: number) => {
      list.ensure(a, b);
      setShown((p) => (p[0] === a && p[1] === b ? p : [a, b]));
    },
    [list],
  );
  useEffect(() => {
    if (view !== 'grid') return;
    thumbs().setActive(true);
    return () => thumbs().setActive(false);
  }, [view]);
  useEffect(() => {
    if (view !== 'grid') return;
    const ids: string[] = [];
    for (let i = shown[0]; i <= shown[1]; i++) {
      const row = list.rowAt(i);
      if (row && !row.missing && fileExt(row.path) === 'pdf') ids.push(row.docId);
    }
    thumbs().want(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, shown, list.version]);

  return (
    <VirtualList
      key={view}
      count={list.total}
      itemHeight={itemHeight}
      {...(view === 'grid' ? { minColumnWidth: CARD_MIN_WIDTH } : {})}
      onRange={range}
      onColumns={setColumns}
      activeIndex={activeIndex}
      ariaLabel={ariaLabel}
      multiselectable
      activeId={activeRow ? `doc-${activeRow.docId}` : undefined}
      onKeyDown={onKeyDown}
      testId="search-results"
      className={`${view === 'grid' ? 'vl-grid' : 'vl-list'}${selection.ids.size > 0 ? ' has-sel' : ''}`}
      renderItem={(i) => {
        const row = list.rowAt(i);
        return (
          <DocItem
            row={row}
            view={view}
            selected={row ? selection.ids.has(row.docId) : false}
            active={row ? selection.active === row.docId : false}
            searching={searching}
            onClick={(e) => click(i, e)}
            onDoubleClick={() => row && (canRead(row.path, row.missing) ? openReader(row.docId) : void openFile(row.docId))}
            onOpenFile={() => row && void openFile(row.docId)}
            onReveal={() => row && void reveal(row.docId)}
            onRead={(page, panel) => row && openReader(row.docId, page, panel ? { panel } : undefined)}
            onDetail={() => row && onOpenDetail(row.docId)}
            onToggle={() => toggle(i)}
            showSize={showSize}
          />
        );
      }}
    />
  );
}
