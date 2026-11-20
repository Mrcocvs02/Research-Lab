import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { keyWidth, type Resizable } from '../lib/useResizable';
import { cx } from './cx';
import './controls.css';

interface Props {
  r: Resizable;
  /** Which edge of the panel the handle sits on: `end` for a panel at the left (grows to the right), `start` for one at the right. */
  edge: 'start' | 'end';
  /** Accessible name, e.g. "Resize the sidebar". */
  label: string;
  testId?: string;
  className?: string;
}

/** Thin drag handle on the edge of a side panel (the parent must be `position: relative`). Keyboard: arrows ±16 px, Home/End, double click resets. */
export function ResizeHandle({ r, edge, label, testId, className }: Props) {
  const { t } = useTranslation();
  const drag = useRef<{ x: number; w: number } | null>(null);
  const { min, max } = r.limits;
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, w: r.width };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const to = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return null;
    const dx = e.clientX - d.x;
    return d.w + (edge === 'end' ? dx : -dx);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const w = to(e);
    if (w !== null) r.set(w, false);
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const w = to(e);
    drag.current = null;
    if (w !== null) r.set(w, true);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const w = keyWidth(r.width, e.key, edge, r.limits);
    if (w === null) return;
    e.preventDefault();
    r.set(w);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={r.width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={t('common.resizeHint')}
      className={cx('rl-resize', `rl-resize--${edge}`, className)}
      data-testid={testId}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={r.reset}
      onKeyDown={onKey}
    />
  );
}
