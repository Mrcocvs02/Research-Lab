import type { ReactNode } from 'react';
import { cx } from './cx';
import { IconClose } from './icons';
import './controls.css';

export type ChipTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'ai';

interface CommonProps {
  children: ReactNode;
  className?: string | undefined;
}
interface FilterChipProps extends CommonProps {
  kind?: 'filter';
  selected?: boolean | undefined;
  onClick?: (() => void) | undefined;
  /** Makes the chip removable; `removeLabel` is the accessible name of the x ("Remove filter X"). */
  onRemove?: (() => void) | undefined;
  removeLabel?: string | undefined;
  disabled?: boolean | undefined;
}
interface StatusChipProps extends CommonProps {
  kind: 'status';
  tone?: ChipTone | undefined;
}
interface TagChipProps extends CommonProps {
  kind: 'tag';
  /** CSS colour of the node dot, a token such as `var(--cat-2)`. */
  dotColor?: string | undefined;
}
export type ChipProps = FilterChipProps | StatusChipProps | TagChipProps;

/** Pill, 28 px: filter (toggle, optionally removable), status (tone) or tag (dot in the node colour). */
export function Chip(props: ChipProps) {
  if (props.kind === 'status') {
    return <span className={cx('rl-chip rl-chip--status', `rl-chip--${props.tone ?? 'neutral'}`, props.className)}>{props.children}</span>;
  }
  if (props.kind === 'tag') {
    return (
      <span className={cx('rl-chip rl-chip--tag', props.className)}>
        <span className="rl-chip__dot" style={props.dotColor ? { background: props.dotColor } : undefined} aria-hidden="true" />
        {props.children}
      </span>
    );
  }
  const { selected, onClick, onRemove, removeLabel, disabled } = props;
  return (
    <span className={cx('rl-chip rl-chip--filter', selected && 'is-selected', disabled && 'is-disabled', props.className)}>
      <button type="button" className="rl-chip__main" aria-pressed={selected ?? false} disabled={disabled} onClick={onClick}>
        {props.children}
      </button>
      {onRemove && (
        <button type="button" className="rl-chip__remove" aria-label={removeLabel} disabled={disabled} onClick={onRemove}>
          <IconClose size={16} />
        </button>
      )}
    </span>
  );
}
