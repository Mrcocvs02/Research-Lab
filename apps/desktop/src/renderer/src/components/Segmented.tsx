import { useRef, type KeyboardEvent } from 'react';
import { cx } from './cx';
import './controls.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  /** Why this option is unavailable (tooltip). */
  disabledReason?: string;
  testId?: string;
}

/** 2-5 exclusive options (replaces radio-chip and the `toggle on` buttons). One radiogroup; arrows move and select. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  className,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange(value: T): void;
  /** Accessible name of the group. */
  label: string;
  size?: 'sm' | 'md';
  className?: string | undefined;
}) {
  const box = useRef<HTMLDivElement>(null);
  const move = (e: KeyboardEvent, from: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    for (let i = 1; i <= options.length; i++) {
      const idx = (from + step * i + options.length * i) % options.length;
      const next = options[idx];
      if (next && !next.disabled) {
        onChange(next.value);
        box.current?.querySelectorAll<HTMLElement>('[role="radio"]')[idx]?.focus();
        return;
      }
    }
  };
  return (
    <div ref={box} role="radiogroup" aria-label={label} className={cx('rl-seg', `rl-seg--${size}`, className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-disabled={o.disabled || undefined}
            disabled={o.disabled}
            title={o.disabled ? o.disabledReason : undefined}
            data-testid={o.testId}
            tabIndex={on ? 0 : -1}
            className={cx('rl-seg__opt', on && 'is-on')}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => move(e, i)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
