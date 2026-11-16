import { useId, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ANNOTATION_COLORS, type Annotation } from '@rl/core';
import { safeText } from '../library/safeText';
import { colorOf, excerpt, type AnnotationColor } from './geometry';

const pct = (n: number) => `${Math.round(Math.min(1, Math.max(0, Number(n) || 0)) * 10000) / 100}%`;

/**
 * Draws the annotations of every page that is on screen, into the overlay element the viewer made for that page. Rectangles
 * are fractions of the page, so they follow the zoom with no work. The colour is a name from our own palette (a CSS class),
 * never a value taken from the data.
 */
export function AnnotationLayers({ layers, annotations, selectedId }: { layers: ReadonlyMap<number, HTMLElement>; annotations: readonly Annotation[]; selectedId: string | null }) {
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
                    className={`ann ann-${a.kind} ann-${colorOf(a.color)}${a.id === selectedId ? ' selected' : ''}`}
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

export function ColorPicker({ value, onChange, name }: { value: AnnotationColor; onChange(c: AnnotationColor): void; name: string }) {
  const { t } = useTranslation();
  return (
    <div className="ann-colors" role="radiogroup" aria-label={t('reader.ann.color')}>
      {ANNOTATION_COLORS.map((c) => (
        <label key={c} className={`ann-swatch ann-${c}`} title={t(`reader.colors.${c}`)}>
          <input type="radio" name={name} checked={value === c} onChange={() => onChange(c)} aria-label={t(`reader.colors.${c}`)} data-testid={`ann-color-${c}`} />
          <span aria-hidden="true" />
        </label>
      ))}
    </div>
  );
}

interface NewProps {
  mode: 'new';
  text: string;
  color: AnnotationColor;
  comment: string;
  busy: boolean;
  onColor(c: AnnotationColor): void;
  onComment(v: string): void;
  onCreate(kind: 'highlight' | 'underline'): void;
  onClose(): void;
}
interface EditProps {
  mode: 'edit';
  annotation: Annotation;
  comment: string;
  busy: boolean;
  onColor(c: AnnotationColor): void;
  onKind(k: 'highlight' | 'underline'): void;
  onComment(v: string): void;
  onSaveComment(): void;
  onDelete(): void;
  onClose(): void;
}

/**
 * The small toolbar of the reader: for a text selection it offers highlight or underline, a colour and an optional comment;
 * for an annotation the user clicked it changes the colour or the comment, or deletes it.
 */
export function AnnotationBar(props: NewProps | EditProps) {
  const { t } = useTranslation();
  const name = useId();
  const commentId = useId();
  const text = props.mode === 'new' ? props.text : props.annotation.text;
  const color = props.mode === 'new' ? props.color : colorOf(props.annotation.color);
  return (
    <div className="ann-bar" role="group" aria-label={props.mode === 'new' ? t('reader.ann.newLabel') : t('reader.ann.editLabel')} data-testid="annotation-bar" data-mode={props.mode}>
      {text && (
        <p className="ann-bar-text" data-testid="ann-text">
          {safeText(excerpt(text, 140))}
        </p>
      )}
      <div className="ann-bar-row">
        {props.mode === 'new' ? (
          <>
            <button type="button" className="primary" disabled={props.busy} onClick={() => props.onCreate('highlight')} data-testid="ann-highlight">
              {t('reader.kind.highlight')}
            </button>
            <button type="button" className="primary" disabled={props.busy} onClick={() => props.onCreate('underline')} data-testid="ann-underline">
              {t('reader.kind.underline')}
            </button>
          </>
        ) : (
          <div className="radio-row" role="radiogroup" aria-label={t('reader.ann.kind')}>
            {(['highlight', 'underline'] as const).map((k) => (
              <label key={k} className="radio-chip">
                <input type="radio" name={`${name}-kind`} checked={props.annotation.kind === k} onChange={() => props.onKind(k)} data-testid={`ann-kind-${k}`} />
                <span>{t(`reader.kind.${k}`)}</span>
              </label>
            ))}
          </div>
        )}
        <ColorPicker value={color} onChange={props.onColor} name={`${name}-color`} />
        <span className="spacer" />
        {props.mode === 'edit' && (
          <button type="button" className="danger" disabled={props.busy} onClick={props.onDelete} data-testid="ann-delete">
            {t('reader.ann.delete')}
          </button>
        )}
        <button type="button" className="icon-button" aria-label={t('common.close')} title={t('common.close')} onClick={props.onClose} data-testid="ann-close">
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="ann-bar-row">
        <label htmlFor={commentId} className="ann-comment-label">
          {t('reader.ann.comment')}
        </label>
        <input
          id={commentId}
          type="text"
          className="ann-comment"
          value={props.comment}
          maxLength={5000}
          onChange={(e) => props.onComment(e.target.value)}
          onBlur={props.mode === 'edit' ? props.onSaveComment : undefined}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && props.mode === 'edit') {
              e.preventDefault();
              props.onSaveComment();
            }
          }}
          data-testid="ann-comment"
        />
        {props.mode === 'edit' && (
          <button type="button" disabled={props.busy} onClick={props.onSaveComment} data-testid="ann-save-comment">
            {t('reader.ann.saveComment')}
          </button>
        )}
      </div>
    </div>
  );
}

/** The annotations of the document by page; each entry takes the reader to it. */
export function AnnotationList({ annotations, selectedId, onPick }: { annotations: readonly Annotation[]; selectedId: string | null; onPick(a: Annotation): void }) {
  const { t } = useTranslation();
  const pages = useMemo(() => {
    const m = new Map<number, Annotation[]>();
    for (const a of [...annotations].sort((x, y) => x.page - y.page || (x.rects[0]?.y ?? 0) - (y.rects[0]?.y ?? 0))) m.set(a.page, [...(m.get(a.page) ?? []), a]);
    return [...m];
  }, [annotations]);
  if (annotations.length === 0) {
    return (
      <p className="hint" data-testid="annotation-empty">
        {t('reader.ann.empty')}
      </p>
    );
  }
  return (
    <div className="ann-list" data-testid="annotation-list">
      {pages.map(([page, items]) => (
        <section key={page} aria-label={t('reader.ann.pageHeading', { page })}>
          <h4>{t('reader.ann.pageHeading', { page })}</h4>
          <ul>
            {items.map((a) => (
              <li key={a.id}>
                <button type="button" className={`ann-item${a.id === selectedId ? ' on' : ''}`} onClick={() => onPick(a)} aria-label={t('reader.ann.jump', { kind: t(`reader.kind.${a.kind}`), page })} data-testid="annotation-item" data-annotation-id={a.id}>
                  <span className={`ann-dot ann-${colorOf(a.color)}`} aria-hidden="true" />
                  <span className="ann-item-body">
                    <span className="ann-item-text">{safeText(excerpt(a.text, 100)) || t(`reader.kind.${a.kind}`)}</span>
                    {a.comment && <span className="ann-item-comment">{safeText(excerpt(a.comment, 100))}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
