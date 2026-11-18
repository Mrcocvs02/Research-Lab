import type { ReactNode } from 'react';
import { cx } from './cx';
import './controls.css';

export type FileKind = 'pdf' | 'md' | 'office';

type BadgeProps =
  | { kind?: 'count'; value: number; max?: number; label?: string | undefined; children?: undefined; fileKind?: undefined }
  | { kind: 'warning' | 'ai'; children: ReactNode; value?: undefined; max?: undefined; label?: undefined; fileKind?: undefined }
  | { kind: 'type'; fileKind: FileKind; children: ReactNode; value?: undefined; max?: undefined; label?: undefined };

/** Number (accent), warning, AI, or file type (5.2.2); each has its own background, so the contrast never depends on the row. */
export function Badge(props: BadgeProps) {
  if (props.kind === undefined || props.kind === 'count') {
    const { value, max = 99, label } = props;
    return (
      <span className="rl-badge rl-badge--count" aria-label={label}>
        {value !== undefined && value > max ? `${max}+` : value}
      </span>
    );
  }
  return <span className={cx('rl-badge', `rl-badge--${props.kind}`, props.kind === 'type' && `rl-badge--${props.fileKind}`)}>{props.children}</span>;
}
