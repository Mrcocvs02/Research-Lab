import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cx } from './cx';
import './controls.css';

export interface IconButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children' | 'aria-label'> {
  /** Required: accessible name and tooltip. */
  label: string;
  /** Shortcut shown in the tooltip, for example "Ctrl+K". */
  keys?: string | undefined;
  variant?: 'ghost' | 'secondary';
  size?: 'sm' | 'md';
  /** Toggle buttons (panels, tools): `aria-pressed` plus the soft accent fill. */
  pressed?: boolean | undefined;
  disabledReason?: string | undefined;
  children: ReactNode;
}

export function IconButton({ label, keys, variant = 'ghost', size = 'md', pressed, disabledReason, className, disabled, title, type = 'button', children, ...rest }: IconButtonProps) {
  const tip = disabled && disabledReason ? `${label}: ${disabledReason}` : (title ?? (keys ? `${label} (${keys})` : label));
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={tip}
      className={cx('rl-iconbtn', `rl-iconbtn--${variant}`, `rl-iconbtn--${size}`, pressed && 'is-pressed', className)}
    >
      {children}
    </button>
  );
}
