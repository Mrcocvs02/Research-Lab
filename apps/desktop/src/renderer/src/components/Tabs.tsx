import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';
import './controls.css';

export interface TabItem {
  id: string;
  label: string;
  /** Trailing content, for example a count Badge. */
  trailing?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
}

/** ids shared by a tab and its panel: give the panel `{ id: panelId, role: 'tabpanel', 'aria-labelledby': tabId }`. */
export function tabIds(idBase: string, id: string) {
  return { tabId: `${idBase}-tab-${id}`, panelId: `${idBase}-panel-${id}` };
}

/** Tab strip: `role=tablist`, arrows/Home/End move and activate, the active tab has a 2 px accent line. The caller renders the panels. */
export function Tabs({
  tabs,
  value,
  onChange,
  label,
  idBase,
  testIdBase,
  className,
}: {
  tabs: readonly TabItem[];
  value: string;
  onChange(id: string): void;
  label: string;
  /** Base for the ids that link tabs and panels (see `tabIds`); defaults to a generated one. */
  idBase?: string | undefined;
  /** When set, each tab gets `data-testid="<testIdBase>-<id>"`. */
  testIdBase?: string | undefined;
  className?: string | undefined;
}) {
  const generated = useId();
  const base = idBase ?? generated;
  const box = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent, from: number) => {
    let to = -1;
    const n = tabs.length;
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (e.key === 'Home') to = tabs.findIndex((t) => !t.disabled);
    else if (e.key === 'End') to = tabs.findLastIndex((t) => !t.disabled);
    else if (step) for (let i = 1; i <= n; i++) {
      const idx = (from + step * i + n * i) % n;
      if (!tabs[idx]?.disabled) {
        to = idx;
        break;
      }
    }
    const next = tabs[to];
    if (!next) return;
    e.preventDefault();
    onChange(next.id);
    box.current?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
  };
  return (
    <div ref={box} role="tablist" aria-label={label} className={cx('rl-tabs', className)}>
      {tabs.map((t, i) => {
        const on = t.id === value;
        const ids = tabIds(base, t.id);
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={ids.tabId}
            data-testid={testIdBase ? `${testIdBase}-${t.id}` : undefined}
            aria-selected={on}
            aria-controls={ids.panelId}
            aria-disabled={t.disabled || undefined}
            disabled={t.disabled}
            title={t.disabled ? t.disabledReason : undefined}
            tabIndex={on ? 0 : -1}
            className={cx('rl-tab', on && 'is-on')}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
            {t.trailing}
          </button>
        );
      })}
    </div>
  );
}
