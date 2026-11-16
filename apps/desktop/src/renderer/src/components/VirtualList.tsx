import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEventHandler, type ReactNode } from 'react';

export interface VirtualListHandle {
  focus(): void;
}

interface Props {
  count: number;
  /** Height of one row (a grid row when `minColumnWidth` is set). */
  itemHeight: number;
  /** Grid mode: as many columns as fit with at least this width. */
  minColumnWidth?: number;
  overscan?: number;
  /** Called with the first and last index that must be loaded (visible rows plus the overscan). */
  onRange?(start: number, end: number): void;
  onColumns?(columns: number): void;
  /** Scrolled into view when it changes. */
  activeIndex?: number | null;
  renderItem(index: number): ReactNode;
  ariaLabel: string;
  multiselectable?: boolean;
  activeId?: string | undefined;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  testId?: string;
  className?: string;
}

/** Size used before the first measurement and where layout does not exist (tests). */
const FALLBACK = { width: 800, height: 600 };

/**
 * Windowed list: only the rows around the viewport are in the DOM, so thousands of documents cost the same as a
 * screenful. Fixed row height; a grid is the same list with several items per row.
 */
export const VirtualList = forwardRef<VirtualListHandle, Props>(function VirtualList(
  { count, itemHeight, minColumnWidth, overscan = 4, onRange, onColumns, activeIndex, renderItem, ariaLabel, multiselectable, activeId, onKeyDown, testId, className },
  ref,
) {
  const box = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [size, setSize] = useState(FALLBACK);

  useImperativeHandle(ref, () => ({ focus: () => box.current?.focus() }), []);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth || FALLBACK.width, height: el.clientHeight || FALLBACK.height });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const columns = minColumnWidth ? Math.max(1, Math.floor(size.width / minColumnWidth)) : 1;
  useEffect(() => onColumns?.(columns), [columns, onColumns]);

  const rows = Math.ceil(count / columns);
  const firstRow = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const lastRow = Math.min(rows - 1, Math.ceil((scrollTop + size.height) / itemHeight) + overscan);
  const start = firstRow * columns;
  const end = Math.min(count - 1, (lastRow + 1) * columns - 1);

  useEffect(() => {
    if (count > 0 && end >= start) onRange?.(start, end);
  }, [start, end, count, onRange]);

  // Keep the active row inside the viewport.
  useEffect(() => {
    const el = box.current;
    if (!el || activeIndex === null || activeIndex === undefined || activeIndex < 0) return;
    const top = Math.floor(activeIndex / columns) * itemHeight;
    const viewHeight = el.clientHeight || size.height;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + itemHeight > el.scrollTop + viewHeight) el.scrollTop = top + itemHeight - viewHeight;
  }, [activeIndex, columns, itemHeight, size.height]);

  const onScroll = useCallback(() => setScrollTop(box.current?.scrollTop ?? 0), []);

  const items: ReactNode[] = [];
  for (let i = start; i <= end; i++) {
    const row = Math.floor(i / columns);
    const col = i % columns;
    items.push(
      <div
        key={i}
        className="vl-item"
        style={{ position: 'absolute', top: row * itemHeight, height: itemHeight, left: `${(col * 100) / columns}%`, width: `${100 / columns}%` }}
      >
        {renderItem(i)}
      </div>,
    );
  }

  return (
    <div
      ref={box}
      className={className ? `vl ${className}` : 'vl'}
      role="listbox"
      aria-label={ariaLabel}
      aria-multiselectable={multiselectable || undefined}
      aria-activedescendant={activeId}
      aria-rowcount={rows}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      data-testid={testId}
      data-count={count}
    >
      <div style={{ position: 'relative', height: rows * itemHeight }}>{items}</div>
    </div>
  );
});
