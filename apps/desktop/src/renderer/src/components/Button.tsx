import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cx } from './cx';
import { Spinner } from './Progress';
import './controls.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children'> {
  /** One `primary` per area. `danger` only in the confirmation dialog. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 16 px icon, 6 px from the text. */
  icon?: ReactNode;
  /** Replaces the icon with a spinner, sets `aria-busy` and ignores clicks; the text stays. */
  busy?: boolean;
  /** Why the button is disabled: shown as the tooltip. A disabled control always has a reason nearby (5.5.1). */
  disabledReason?: string | undefined;
  children?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', icon, busy, disabledReason, className, disabled, onClick, title, type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      aria-busy={busy || undefined}
      title={disabled && disabledReason ? disabledReason : title}
      className={cx('rl-btn', `rl-btn--${variant}`, `rl-btn--${size}`, busy && 'is-busy', className)}
      onClick={busy ? undefined : onClick}
    >
      {busy ? <Spinner /> : icon}
      {children}
    </button>
  );
}
