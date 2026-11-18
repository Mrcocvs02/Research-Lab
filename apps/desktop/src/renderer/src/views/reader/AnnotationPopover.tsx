import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ANNOTATION_COLORS, type Annotation } from '@rl/core';
import { safeText } from '../library/safeText';
import { colorOf, excerpt, type AnnotationColor } from './geometry';

/** A place in the window (client coordinates) a popover hangs from. */
export interface Anchor {
  left: number;
  top: number;
  bottom: number;
}

/** Where a popover goes: 8 px under the anchor, above it when there is no room, and kept inside the window. Pure, so it is tested. */
export function popoverPlace(anchor: Anchor, size: { width: number; height: number }, win: { width: number; height: number }): { left: number; top: number } {
  const below = anchor.bottom + 8;
  const top = below + size.height <= win.height - 8 || anchor.top - 8 - size.height < 8 ? below : anchor.top - 8 - size.height;
  return { left: Math.max(8, Math.min(anchor.left, win.width - size.width - 8)), top: Math.max(8, top) };
}

/** The floating box of the reader: anchored to a rectangle (it follows the anchor while the pages scroll), 40 px high rows. */
function Floating({ anchor, label, testId, mode, children }: { anchor: () => Anchor | null; label: string; testId: string; mode: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const get = useRef(anchor);
  get.current = anchor;
  useLayoutEffect(() => {
    let frame = 0;
    const place = () => {
      const a = get.current();
      const el = box.current;
      if (a && el) setPos(popoverPlace(a, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }));
    };
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    place();
    window.addEventListener('resize', later);
    document.addEventListener('scroll', later, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', later);
      document.removeEventListener('scroll', later, true);
    };
  }, []);
  return (
    <div ref={box} className="ann-pop" role="group" aria-label={label} data-testid={testId} data-mode={mode} style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}>
      {children}
    </div>
  );
}

/** The five colour dots (a radiogroup): `testPrefix` + the colour name is the test id. */
export function ColorDots({ value, onPick, prefix, label }: { value: AnnotationColor; onPick(n: 1 | 2 | 3 | 4 | 5): void; prefix: string; label: string }) {
  const { t } = useTranslation();
  return (
    <div className="ann-dots" role="radiogroup" aria-label={label}>
      {ANNOTATION_COLORS.map((c, i) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          className={`ann-dot-btn ann-${c}`}
          title={`${t(`reader.colors.${c}`)} (${i + 1})`}
          aria-label={t(`reader.colors.${c}`)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick((i + 1) as 1 | 2 | 3 | 4 | 5)}
          data-testid={`${prefix}-${c}`}
        >
          <span aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/** Select tool, text selected: Copy and Highlight (in the current colour). Underline is the U tool (D-415). */
export function SelectionPopover({ anchor, text, notice, busy, color, onHighlight, onCopy, onReposition }: { anchor: () => Anchor | null; text: string; notice?: string | undefined; busy: boolean; color: AnnotationColor; onHighlight(): void; onCopy(): void; onReposition?: (() => void) | undefined }) {
  const { t } = useTranslation();
  return (
    <Floating anchor={anchor} label={t('reader.ann.newLabel')} testId="annotation-bar" mode="new">
      {notice && (
        <p className="callout" role="status" data-testid="ann-skipped">
          {notice}
        </p>
      )}
      <div className="ann-pop__row">
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onCopy} data-testid="ann-copy">
          {t('reader.ann.copy')}
        </button>
        <button type="button" className="primary" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={onHighlight} title={text ? safeText(excerpt(text, 140)) : undefined} data-testid="ann-highlight">
          <span className={`ann-pip ann-${color}`} aria-hidden="true" />
          {t('reader.kind.highlight')}
        </button>
        {onReposition && (
          <button type="button" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={onReposition} data-testid="ann-reposition-apply">
            {t('reader.repair.apply')}
          </button>
        )}
      </div>
    </Floating>
  );
}

/** An annotation was clicked: five colours, a comment and the bin (D-424); the comment opens as a one-line field. */
export function AnnotationPopover({
  annotation,
  anchor,
  commenting,
  draft,
  busy,
  stale,
  onColor,
  onOpenComment,
  onDraft,
  onCommit,
  onDelete,
  onReconfirm,
}: {
  annotation: Annotation;
  anchor: () => Anchor | null;
  commenting: boolean;
  draft: string;
  busy: boolean;
  stale: boolean;
  onColor(n: 1 | 2 | 3 | 4 | 5): void;
  onOpenComment(): void;
  onDraft(v: string): void;
  onCommit(): void;
  onDelete(): void;
  onReconfirm(): void;
}) {
  const { t } = useTranslation();
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (commenting) field.current?.focus();
  }, [commenting]);
  return (
    <Floating anchor={anchor} label={t('reader.ann.editLabel')} testId="annotation-bar" mode="edit">
      {stale && (
        <div className="callout ann-stale-note" role="status" data-testid="ann-stale">
          <span>{t('reader.ann.stale')}</span>
          <button type="button" disabled={busy} onClick={onReconfirm} title={t('reader.ann.reconfirmHint')} data-testid="ann-reconfirm">
            {t('reader.ann.reconfirm')}
          </button>
        </div>
      )}
      <div className="ann-pop__row">
        <ColorDots value={colorOf(annotation.color)} onPick={onColor} prefix="ann-pop-color" label={t('reader.ann.color')} />
        <button type="button" className={annotation.comment ? 'is-on' : undefined} aria-pressed={commenting} onMouseDown={(e) => e.preventDefault()} onClick={onOpenComment} title={`${t('reader.ann.comment')} (C)`} data-testid="ann-comment-open">
          {t('reader.ann.commentShort')}
        </button>
        <button type="button" className="danger" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={onDelete} title={`${t('reader.ann.delete')} (Del)`} data-testid="ann-delete">
          {t('reader.ann.delete')}
        </button>
      </div>
      {commenting && (
        <div className="ann-pop__row">
          <input
            ref={field}
            type="text"
            className="ann-comment"
            value={draft}
            maxLength={5000}
            aria-label={t('reader.ann.comment')}
            onChange={(e) => onDraft(e.target.value)}
            onBlur={onCommit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onCommit();
              }
            }}
            data-testid="ann-comment"
          />
          <button type="button" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={onCommit} data-testid="ann-save-comment">
            {t('reader.ann.saveComment')}
          </button>
        </div>
      )}
    </Floating>
  );
}

/** More than three annotations under one eraser stroke: nothing is deleted until the user says so. */
export function ConfirmErase({ anchor, count, onConfirm, onCancel }: { anchor: () => Anchor | null; count: number; onConfirm(): void; onCancel(): void }) {
  const { t } = useTranslation();
  return (
    <Floating anchor={anchor} label={t('reader.erase.confirm', { count })} testId="erase-confirm" mode="confirm">
      <p className="ann-pop__text">{t('reader.erase.confirm', { count })}</p>
      <div className="ann-pop__row">
        <button type="button" className="danger" onMouseDown={(e) => e.preventDefault()} onClick={onConfirm} data-testid="erase-confirm-yes">
          {t('reader.ann.delete')}
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onCancel} data-testid="erase-confirm-no">
          {t('common.cancel')}
        </button>
      </div>
    </Floating>
  );
}
