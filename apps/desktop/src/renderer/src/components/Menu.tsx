import { Fragment, useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { cx } from './cx';
import { Kbd } from './Kbd';
import { Popover, type Placement } from './Popover';
import './overlays.css';

/** A menu entry. A disabled entry MUST say why (the type forces `disabledReason`): entries are never hidden by context (D-412). */
export type MenuItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Shortcut, shown with Kbd. */
  keys?: string;
  danger?: boolean;
  onSelect(): void;
} & ({ disabled?: false; disabledReason?: undefined } | { disabled: true; disabledReason: string });

/** A group: an optional heading (status lines go here or in a tooltip, never as items) and its entries. */
export interface MenuGroup {
  id: string;
  label?: string;
  items: readonly MenuItem[];
}

/** At most three groups, one level (no submenus). */
export type MenuGroups = readonly [MenuGroup] | readonly [MenuGroup, MenuGroup] | readonly [MenuGroup, MenuGroup, MenuGroup];

export const MENU_MAX_ITEMS = 7;
export const MENU_MAX_GROUPS = 3;

/** The menu rule of the design (17.1, D-412) as a list of violations; empty when the menu is fine. Used by Menu in development and by tests. */
export function checkMenu(groups: readonly MenuGroup[]): string[] {
  const problems: string[] = [];
  const items = groups.flatMap((g) => g.items);
  if (groups.length > MENU_MAX_GROUPS) problems.push(`${groups.length} groups (max ${MENU_MAX_GROUPS})`);
  if (items.length > MENU_MAX_ITEMS) problems.push(`${items.length} items (max ${MENU_MAX_ITEMS})`);
  for (const g of groups) if (g.items.length === 0) problems.push(`group "${g.id}" is empty`);
  for (const i of items) if (i.disabled && !i.disabledReason) problems.push(`item "${i.id}" is disabled without a reason`);
  if (new Set(items.map((i) => i.id)).size !== items.length) problems.push('duplicate item ids');
  return problems;
}

function MenuList({ groups, onClose, anchor }: { groups: MenuGroups; onClose(): void; anchor: RefObject<HTMLElement | null> }) {
  const list = useRef<HTMLDivElement>(null);
  const items = (): HTMLElement[] => [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  useEffect(() => {
    items()[0]?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    let to = -1;
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) to = (at + 1) % all.length;
    else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) to = (at - 1 + all.length) % all.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = all.length - 1;
    if (to < 0) return;
    e.preventDefault();
    all[to]?.focus();
  };

  const select = (item: MenuItem) => {
    if (item.disabled) return;
    onClose();
    anchor.current?.focus();
    item.onSelect();
  };

  return (
    <div ref={list} className="rl-menu" onKeyDown={onKeyDown}>
      {groups.map((g, gi) => (
        <Fragment key={g.id}>
          {gi > 0 && <div role="separator" className="rl-menu__sep" />}
          <div role="group" aria-label={g.label ?? g.id}>
            {g.label && <div className="rl-menu__heading">{g.label}</div>}
            {g.items.map((item) => (
              <div
                key={item.id}
                role="menuitem"
                tabIndex={-1}
                aria-disabled={item.disabled || undefined}
                title={item.disabled ? item.disabledReason : undefined}
                className={cx('rl-menu__item', item.danger && 'is-danger', item.disabled && 'is-disabled')}
                onClick={() => select(item)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    select(item);
                  }
                }}
              >
                <span className="rl-menu__icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="rl-menu__label">{item.label}</span>
                {item.keys && <Kbd>{item.keys}</Kbd>}
              </div>
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * Menu on a Popover: at most 7 entries in 3 groups, one level, disabled entries with a reason and never hidden. Arrows, Home/End and
 * Tab cycle the entries (the focus stays inside), Enter/Space select, Escape closes with the focus back on the anchor.
 */
export function Menu({ anchor, open, onClose, groups, label, placement = 'bottom-end', width = 240 }: { anchor: RefObject<HTMLElement | null>; open: boolean; onClose(): void; groups: MenuGroups; label: string; placement?: Placement; width?: number }) {
  if (import.meta.env.DEV && open) {
    const problems = checkMenu(groups);
    if (problems.length > 0) console.error(`Menu "${label}" breaks the menu rule: ${problems.join('; ')}`);
  }
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} label={label} placement={placement} width={width} role="menu">
      <MenuList groups={groups} onClose={onClose} anchor={anchor} />
    </Popover>
  );
}
