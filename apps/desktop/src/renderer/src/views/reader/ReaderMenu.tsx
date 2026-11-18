import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Kbd } from '../../components/Kbd';
import { Popover, type Placement } from '../../components/Popover';
import { cx } from '../../components/cx';

/** One entry of a reader menu. A disabled entry says why (never hidden, D-412); `testId` is what the tests and the guide point at. */
export interface RItem {
  id: string;
  label: string;
  testId?: string;
  keys?: string | undefined;
  checked?: boolean;
  danger?: boolean;
  /** Set (non-empty) to disable the entry: the reason is its tooltip. */
  disabled?: string;
  onSelect(): void;
}
export interface RGroup {
  id: string;
  /** Heading line; `headingId` is its test id (the PDF state of the Studio menu). */
  heading?: string;
  headingId?: string;
  items: readonly RItem[];
}

/**
 * The menus of the reader bar: the shared Popover with menu items that carry test ids (the shared Menu has none). Same rules:
 * arrows, Home/End and Tab cycle the entries, Enter or Space select, Escape closes and the focus goes back to the button.
 */
export function ReaderMenu({ anchor, open, onClose, groups, label, width = 240, placement = 'bottom-start' }: { anchor: RefObject<HTMLElement | null>; open: boolean; onClose(): void; groups: readonly RGroup[]; label: string; width?: number; placement?: Placement }) {
  const list = useRef<HTMLDivElement>(null);
  const items = () => [...(list.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
  useEffect(() => {
    if (open) setTimeout(() => items()[0]?.focus(), 0);
  }, [open]);
  const onKeyDown = (e: KeyboardEvent) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const to = e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey) ? (at + 1) % all.length : e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ? (at - 1 + all.length) % all.length : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    all[to]?.focus();
  };
  const pick = (i: RItem) => {
    if (i.disabled) return;
    onClose();
    anchor.current?.focus();
    i.onSelect();
  };
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} label={label} placement={placement} width={width} role="menu">
      <div ref={list} className="rl-menu" onKeyDown={onKeyDown}>
        {groups.map((g, gi): ReactNode => (
          <div key={g.id} role="group" aria-label={g.heading ?? g.id}>
            {gi > 0 && <div role="separator" className="rl-menu__sep" />}
            {g.heading && (
              <div className="rl-menu__heading" data-testid={g.headingId}>
                {g.heading}
              </div>
            )}
            {g.items.map((i) => (
              <div
                key={i.id}
                role={i.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                aria-checked={i.checked}
                tabIndex={-1}
                aria-disabled={i.disabled ? true : undefined}
                title={i.disabled || undefined}
                className={cx('rl-menu__item', i.danger && 'is-danger', i.disabled && 'is-disabled')}
                onClick={() => pick(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    pick(i);
                  }
                }}
                data-testid={i.testId}
              >
                <span className="rl-menu__icon" aria-hidden="true">
                  {i.checked ? '✓' : ''}
                </span>
                <span className="rl-menu__label">{i.label}</span>
                {i.keys && <Kbd>{i.keys}</Kbd>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </Popover>
  );
}
