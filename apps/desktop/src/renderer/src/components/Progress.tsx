import type { ComponentPropsWithoutRef } from 'react';
import { cx } from './cx';
import './controls.css';

/** Ring (16 px by default): determinate with `value` 0..1, otherwise it spins. Used by the Activity chip and as the busy spinner. */
export function ProgressRing({
  value,
  size = 16,
  className,
  ...rest
}: { value?: number | undefined; size?: number } & Omit<ComponentPropsWithoutRef<'svg'>, 'children' | 'width' | 'height' | 'value'>) {
  const r = 7;
  const c = 2 * Math.PI * r;
  const determinate = typeof value === 'number';
  const v = determinate ? Math.min(1, Math.max(0, value)) : 0.28;
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={cx('rl-ring', !determinate && 'rl-ring--spin', className)}
      role={determinate ? 'progressbar' : undefined}
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? 100 : undefined}
      aria-valuenow={determinate ? Math.round(v * 100) : undefined}
      aria-hidden={determinate || rest['aria-label'] ? undefined : true}
      focusable="false"
      {...rest}
    >
      <circle className="rl-ring__track" cx="8" cy="8" r={r} />
      <circle className="rl-ring__arc" cx="8" cy="8" r={r} strokeDasharray={`${c * v} ${c}`} transform="rotate(-90 8 8)" />
    </svg>
  );
}

/** Indeterminate spinner for busy buttons. */
export function Spinner() {
  return <ProgressRing />;
}

/** Bar (6 px): determinate with `value` 0..1, otherwise a sliding segment. `label` names it for assistive technology. */
export function ProgressBar({ value, label, className }: { value?: number | undefined; label: string; className?: string | undefined }) {
  const determinate = typeof value === 'number';
  const v = determinate ? Math.min(1, Math.max(0, value)) : 0;
  return (
    <div
      className={cx('rl-bar', !determinate && 'rl-bar--indeterminate', className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? Math.round(v * 100) : undefined}
    >
      <div className="rl-bar__fill" style={determinate ? { transform: `scaleX(${v})` } : undefined} />
    </div>
  );
}
