import type { ReactNode } from 'react';
import { cx } from './cx';
import './controls.css';

/** Icon (24) in a 48 px circle, heading, text, one action: every empty view. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cx('rl-empty', className)}>
      <div className="rl-empty__icon" aria-hidden="true">
        {icon}
      </div>
      <h2 className="rl-empty__title">{title}</h2>
      {children && <p className="rl-empty__text">{children}</p>}
      {action && <div className="rl-empty__action">{action}</div>}
    </div>
  );
}
