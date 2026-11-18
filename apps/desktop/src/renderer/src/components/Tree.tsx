import { useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface TreeItem {
  key: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

interface Props<T extends TreeItem> {
  items: T[];
  selectedKey: string | null;
  onSelect(item: T): void;
  onToggle(item: T): void;
  renderLabel(item: T): ReactNode;
  ariaLabel: string;
  testId?: string;
  /** Dragging: which items can be dragged, and what happens when one is dropped on another (or on the empty area). */
  draggable?: boolean;
  onDrop?(dragged: T, target: T | null): void;
  /** `data-*` attribute value of an item (tests find rows by it). */
  dataKey?(item: T): string;
}

/**
 * Accessible tree (ARIA tree pattern): one tab stop, arrows move, Right/Left open and close, Home/End jump, Enter selects.
 * Selection follows the keyboard focus. Optional drag and drop for moving nodes (the keyboard route to the same
 * result is the "parents" editor of the node, so dragging is never the only way).
 */
export function Tree<T extends TreeItem>({ items, selectedKey, onSelect, onToggle, renderLabel, ariaLabel, testId, draggable, onDrop, dataKey }: Props<T>) {
  const { t } = useTranslation();
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const box = useRef<HTMLUListElement>(null);

  const current = focusKey ?? selectedKey ?? items[0]?.key ?? null;
  const index = items.findIndex((i) => i.key === current);

  const focusItem = (key: string) => {
    setFocusKey(key);
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(`[data-tree-key="${CSS.escape(key)}"]`)?.focus());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, item: T, i: number) => {
    const go = (j: number) => {
      const target = items[Math.max(0, Math.min(items.length - 1, j))];
      if (!target) return;
      focusItem(target.key);
      onSelect(target);
    };
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        go(i + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        go(i - 1);
        break;
      case 'Home':
        e.preventDefault();
        go(0);
        break;
      case 'End':
        e.preventDefault();
        go(items.length - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (item.hasChildren && !item.expanded) onToggle(item);
        else if (item.hasChildren) go(i + 1);
        break;
      case 'ArrowLeft': {
        e.preventDefault();
        if (item.hasChildren && item.expanded) onToggle(item);
        else {
          for (let j = i - 1; j >= 0; j--) {
            if (items[j]!.depth < item.depth) {
              go(j);
              break;
            }
          }
        }
        break;
      }
      case 'Enter':
      case ' ':
        e.preventDefault();
        onSelect(item);
        break;
      default:
    }
  };

  const dragged = items.find((i) => i.key === dragKey) ?? null;
  const drop = (e: DragEvent, target: T | null) => {
    e.preventDefault();
    e.stopPropagation();
    setOverKey(null);
    setDragKey(null);
    if (dragged) onDrop?.(dragged, target);
  };

  return (
    <ul
      ref={box}
      className="tree"
      role="tree"
      aria-label={ariaLabel}
      data-testid={testId}
      onDragOver={draggable ? (e) => dragKey && e.preventDefault() : undefined}
      onDrop={draggable ? (e) => drop(e, null) : undefined}
    >
      {items.map((item, i) => {
        const selected = item.key === selectedKey;
        return (
          <li
            key={item.key}
            role="treeitem"
            aria-level={item.depth + 1}
            aria-expanded={item.hasChildren ? item.expanded : undefined}
            aria-selected={selected}
            tabIndex={(index < 0 ? i === 0 : item.key === current) ? 0 : -1}
            data-tree-key={item.key}
            data-key={dataKey?.(item)}
            className={['tree-item', selected ? 'is-selected' : '', overKey === item.key ? 'drop-over' : ''].filter(Boolean).join(' ')}
            style={{ paddingLeft: 6 + item.depth * 16 }}
            draggable={draggable || undefined}
            onClick={(e) => {
              e.stopPropagation();
              setFocusKey(item.key);
              onSelect(item);
            }}
            onFocus={(e) => e.target === e.currentTarget && setFocusKey(item.key)}
            onKeyDown={(e) => e.target === e.currentTarget && onKeyDown(e, item, i)}
            onDragStart={draggable ? (e) => {
              e.dataTransfer.setData('text/plain', item.key);
              e.dataTransfer.effectAllowed = 'move';
              setDragKey(item.key);
            } : undefined}
            onDragEnd={draggable ? () => { setDragKey(null); setOverKey(null); } : undefined}
            onDragOver={draggable ? (e) => {
              if (dragKey && dragKey !== item.key) {
                e.preventDefault();
                e.stopPropagation();
                setOverKey(item.key);
              }
            } : undefined}
            onDragLeave={draggable ? () => setOverKey((k) => (k === item.key ? null : k)) : undefined}
            onDrop={draggable ? (e) => dragKey !== item.key && drop(e, item) : undefined}
          >
            {item.hasChildren ? (
              <button
                type="button"
                className="icon-button tree-toggle"
                tabIndex={-1}
                aria-label={t('tree.toggle')}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(item);
                }}
              >
                <span aria-hidden="true">{item.expanded ? '▾' : '▸'}</span>
              </button>
            ) : (
              <span className="icon-spacer" aria-hidden="true" />
            )}
            <span className="tree-label">{renderLabel(item)}</span>
          </li>
        );
      })}
    </ul>
  );
}
