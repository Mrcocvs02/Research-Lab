import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cx } from './cx';
import './controls.css';

/** On/off setting, 32x18. A button with role=switch: the visible `label` (or `aria-label`) is its name. */
export function Switch({
  checked,
  onChange,
  label,
  disabledReason,
  className,
  disabled,
  title,
  ...rest
}: Omit<ComponentPropsWithoutRef<'button'>, 'onChange' | 'role' | 'aria-checked' | 'children'> & {
  checked: boolean;
  onChange(next: boolean): void;
  label?: ReactNode;
  disabledReason?: string | undefined;
}) {
  return (
    <button
      {...rest}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={disabled && disabledReason ? disabledReason : title}
      className={cx('rl-switch', checked && 'is-on', className)}
      onClick={() => onChange(!checked)}
    >
      <span className="rl-switch__track" aria-hidden="true" />
      {label !== undefined && <span className="rl-switch__label">{label}</span>}
    </button>
  );
}
