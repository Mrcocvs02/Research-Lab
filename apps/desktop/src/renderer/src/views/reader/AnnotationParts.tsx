import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ANNOTATION_COLORS, type Annotation } from '@rl/core';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import { colorName, useColorMeanings } from './colorMeaning';
import { colorOf, excerpt, type AnnotationColor } from './geometry';
import { ReaderMenu } from './ReaderMenu';
import './reader.css';
import './reader-tools.css';

/** The picture of a crop, loaded from the data folder when its entry is drawn; nothing shows while it is missing. */
function CropThumb({ docId, annId, label }: { docId: string; annId: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    rl.invoke('crops:get', { docId, annId }).then(
      (r) => alive && setSrc(r.image ? `data:image/webp;base64,${r.image}` : null),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [docId, annId]);
  return src ? <img className="crop-thumb" src={src} alt={label} data-testid="crop-thumb" /> : null;
}

const pct = (n: number) => `${Math.round(Math.min(1, Math.max(0, Number(n) || 0)) * 10000) / 100}%`;

/**
 * Draws the annotations of every page that is on screen, into the overlay element the viewer made for that page. Rectangles
 * are fractions of the page, so they follow the zoom with no work. The colour is a name from our own palette (a CSS class),
 * never a value taken from the data.
 */
export function AnnotationLayers({ layers, annotations, selectedId, staleIds, erasing }: { layers: ReadonlyMap<number, HTMLElement>; annotations: readonly Annotation[]; selectedId: string | null; staleIds: ReadonlySet<string>; erasing?: ReadonlySet<string> }) {
  const { t } = useTranslation();
  const byPage = useMemo(() => {
    const m = new Map<number, Annotation[]>();
    for (const a of annotations) m.set(a.page, [...(m.get(a.page) ?? []), a]);
    return m;
  }, [annotations]);
  return (
    <>
      {[...layers].map(([page, el]) =>
        el.isConnected
          ? createPortal(
              (byPage.get(page) ?? []).flatMap((a) =>
                a.rects.map((r, i) => (
                  <div
                    key={`${a.id}:${i}`}
                    className={`ann ann-${a.kind} ann-${colorOf(a.color)}${a.id === selectedId ? ' is-selected' : ''}${staleIds.has(a.id) ? ' ann-stale' : ''}${erasing?.has(a.id) ? ' ann-erase' : ''}`}
                    title={staleIds.has(a.id) ? t('reader.ann.stale') : undefined}
                    data-stale={staleIds.has(a.id) ? 'true' : undefined}
                    style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}
                    data-testid="annotation-mark"
                    data-annotation-id={a.id}
                    data-kind={a.kind}
                    data-color={colorOf(a.color)}
                  />
                )),
              ),
              el,
              `page-${page}`,
            )
          : null,
      )}
    </>
  );
}

/** The annotations of the document by page; each entry takes the reader to it. */
export function AnnotationList({
  docId,
  annotations,
  selectedId,
  staleIds,
  onPick,
  review,
  repositioning,
  onReposition,
  onAccept,
  onKind,
  onDelete,
}: {
  docId: string;
  annotations: readonly Annotation[];
  selectedId: string | null;
  staleIds: ReadonlySet<string>;
  onPick(a: Annotation): void;
  /** Annotations the repair could not place ("Da controllare"). */
  review?: ReadonlySet<string>;
  repositioning?: string | null;
  onReposition?(a: Annotation): void;
  onAccept?(a: Annotation): void;
  /** The `⋯` of an entry (D-424): the type is changed here, not in the popover. */
  onKind?(a: Annotation, kind: 'highlight' | 'underline'): void;
  onDelete?(a: Annotation): void;
}) {
  const { t } = useTranslation();
  const meanings = useColorMeanings();
  // The filter by meaning (feature 36): one colour, or all of them.
  const [filter, setFilter] = useState<AnnotationColor | null>(null);
  const [filterMenu, setFilterMenu] = useState(false);
  const filterBtn = useRef<HTMLButtonElement>(null);
  const shown = useMemo(() => (filter ? annotations.filter((a) => colorOf(a.color) === filter) : annotations), [annotations, filter]);
  const pages = useMemo(() => {
    const m = new Map<number, Annotation[]>();
    for (const a of [...shown].sort((x, y) => x.page - y.page || (x.rects[0]?.y ?? 0) - (y.rects[0]?.y ?? 0))) m.set(a.page, [...(m.get(a.page) ?? []), a]);
    return [...m];
  }, [shown]);
  if (annotations.length === 0) {
    return (
      <p className="hint" data-testid="annotation-empty">
        {t('reader.ann.empty')}
      </p>
    );
  }
  const toCheck = annotations.filter((a) => review?.has(a.id));
  return (
    <div className="ann-list" data-testid="annotation-list">
      <div className="ann-list__head">
        {filter ? (
          <span className="ann-list__filter" data-testid="annotation-filter-label">
            {colorName(t, filter, meanings)}
          </span>
        ) : (
          <span className="ann-list__filter" data-testid="annotation-count">
            {t('reader.ann.count', { count: annotations.length })}
          </span>
        )}
        <button ref={filterBtn} type="button" className="ann-more" aria-label={t('reader.colorMeaning.menu')} aria-expanded={filterMenu} onClick={() => setFilterMenu(!filterMenu)} data-testid="annotation-panel-more">
          <span aria-hidden="true">⋯</span>
        </button>
        <ReaderMenu
          anchor={filterBtn}
          open={filterMenu}
          onClose={() => setFilterMenu(false)}
          label={t('reader.colorMeaning.menu')}
          width={240}
          placement="bottom-end"
          groups={[
            {
              id: 'meaning',
              heading: t('reader.colorMeaning.filter'),
              items: [
                { id: 'all', label: t('reader.colorMeaning.all'), checked: filter === null, testId: 'ann-filter-all', onSelect: () => setFilter(null) },
                ...ANNOTATION_COLORS.map((c) => ({ id: c, label: colorName(t, c, meanings), checked: filter === c, testId: `ann-filter-${c}`, onSelect: () => setFilter(c) })),
              ],
            },
          ]}
        />
      </div>
      {toCheck.length > 0 && (
        <section aria-label={t('reader.repair.heading')} className="ann-review" data-testid="annotation-review">
          <h4>{t('reader.repair.heading')}</h4>
          <p className="hint">{t('reader.repair.hint')}</p>
          <ul>
            {toCheck.map((a) => (
              <li key={a.id} data-testid="annotation-review-item" data-annotation-id={a.id}>
                <button type="button" className={`ann-item${a.id === selectedId ? ' on' : ''}`} onClick={() => onPick(a)} aria-label={t('reader.ann.jump', { kind: t(`reader.kind.${a.kind}`), page: a.page })}>
                  <span className={`ann-dot ann-${colorOf(a.color)}`} aria-hidden="true" />
                  <span className="ann-item-body">
                    <span className="ann-item-text">{safeText(excerpt(a.text, 100)) || t(`reader.kind.${a.kind}`)}</span>
                    <span className="hint">{t('reader.ann.pageHeading', { page: a.page })}</span>
                  </span>
                </button>
                <div className="ann-review-actions">
                  <button type="button" className={repositioning === a.id ? 'toggle on' : 'toggle'} aria-pressed={repositioning === a.id} onClick={() => onReposition?.(a)} data-testid="ann-reposition">
                    {t('reader.repair.reposition')}
                  </button>
                  <button type="button" onClick={() => onAccept?.(a)} data-testid="ann-accept">
                    {t('reader.repair.accept')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {pages.map(([page, items]) => (
        <section key={page} aria-label={t('reader.ann.pageHeading', { page })}>
          <h4>{t('reader.ann.pageHeading', { page })}</h4>
          <ul>
            {items.map((a) => (
              <li key={a.id}>
                <button type="button" className={`ann-item${a.id === selectedId ? ' on' : ''}`} onClick={() => onPick(a)} aria-label={t('reader.ann.jump', { kind: t(`reader.kind.${a.kind}`), page })} data-testid="annotation-item" data-annotation-id={a.id}>
                  <span className={`ann-dot ann-${colorOf(a.color)}`} aria-hidden="true" />
                  {a.kind === 'area' && <CropThumb docId={docId} annId={a.id} label={t('reader.crop.label', { page })} />}
                  <span className="ann-item-body">
                    <span className="ann-item-text">{a.kind === 'area' ? safeText(excerpt(a.crop?.caption ?? '', 100)) || t(`reader.crop.types.${a.crop?.type ?? 'figure'}`) : safeText(excerpt(a.text, 100)) || t(`reader.kind.${a.kind}`)}</span>
                    {a.comment && <span className="ann-item-comment">{safeText(excerpt(a.comment, 100))}</span>}
                    {staleIds.has(a.id) && (
                      <span className="ann-item-stale" data-testid="annotation-stale">
                        {t('reader.ann.stale')}
                      </span>
                    )}
                  </span>
                </button>
                <ItemMenu annotation={a} onKind={onKind} onDelete={onDelete} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The `⋯` of one entry of the list: switch between highlight and underline, or delete. */
function ItemMenu({ annotation: a, onKind, onDelete }: { annotation: Annotation; onKind: ((a: Annotation, k: 'highlight' | 'underline') => void) | undefined; onDelete: ((a: Annotation) => void) | undefined }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const other = a.kind === 'underline' ? 'highlight' : 'underline';
  return (
    <>
      <button ref={btn} type="button" className="ann-more" aria-label={t('reader.more')} aria-expanded={open} onClick={() => setOpen(!open)} data-testid="annotation-more">
        <span aria-hidden="true">⋯</span>
      </button>
      <ReaderMenu
        anchor={btn}
        open={open}
        onClose={() => setOpen(false)}
        label={t('reader.more')}
        width={220}
        placement="bottom-end"
        groups={[
          {
            id: 'a',
            items: [
              // A crop has no type to switch to: only deleting.
              ...(a.kind === 'area' ? [] : [{ id: 'kind', label: t(`reader.ann.to_${other}`), testId: 'ann-item-kind', onSelect: () => onKind?.(a, other) }]),
              { id: 'del', label: t('reader.ann.delete'), danger: true, testId: 'ann-item-delete', onSelect: () => onDelete?.(a) },
            ],
          },
        ]}
      />
    </>
  );
}
