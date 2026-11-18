import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import './overlays.css';

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';
interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Where a popover goes: under its anchor (or above when `placement` says so), flipped to the other side when the preferred one has no
 * room and the other has, aligned to the anchor's start or end edge and kept `margin` px inside the viewport. Pure, so it is tested.
 */
export function placePopover(anchor: Box, size: { width: number; height: number }, viewport: { width: number; height: number }, placement: Placement = 'bottom-start', gap = 4, margin = 8) {
  const wantsTop = placement.startsWith('top');
  const below = anchor.top + anchor.height + gap;
  const above = anchor.top - gap - size.height;
  const fitsBelow = below + size.height <= viewport.height - margin;
  const fitsAbove = above >= margin;
  const top = wantsTop ? (fitsAbove || !fitsBelow ? above : below) : fitsBelow || !fitsAbove ? below : above;
  const flipped = wantsTop ? top === below : top === above;
  const alignEnd = placement.endsWith('end');
  const rawLeft = alignEnd ? anchor.left + anchor.width - size.width : anchor.left;
  const left = Math.max(margin, Math.min(rawLeft, viewport.width - size.width - margin));
  return { top: Math.max(margin, top), left, flipped };
}

/** Anchored floating panel (280-420 px): closes with Escape (focus back to the anchor) and on a click outside. No library. */
export function Popover({
  anchor,
  open,
  onClose,
  children,
  label,
  placement = 'bottom-start',
  width = 320,
  role = 'dialog',
  className,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose(): void;
  children: ReactNode;
  /** Accessible name. */
  label: string;
  placement?: Placement;
  width?: number;
  role?: 'dialog' | 'menu' | 'listbox';
  className?: string | undefined;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current;
      const el = box.current;
      if (!a || !el) return;
      const r = a.getBoundingClientRect();
      const p = placePopover({ top: r.top, left: r.left, width: r.width, height: r.height }, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, placement);
      setPos({ top: p.top, left: p.left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchor, placement]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
      anchor.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchor, onClose]);

  if (!open) return null;
  return createPortal(
    <div ref={box} role={role} aria-label={label} className={cx('rl-popover', className)} style={{ width, top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}>
      {children}
    </div>,
    document.body,
  );
}
