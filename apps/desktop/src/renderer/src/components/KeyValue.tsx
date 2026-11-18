import type { ReactNode } from 'react';
import { cx } from './cx';
import './controls.css';

/** Two-column definition list (label 180 px muted, value), rows of 28 px: replaces the unstyled `<dl>`s. */
export function KeyValue({ items, className }: { items: readonly { label: string; value: ReactNode; testId?: string | undefined }[]; className?: string | undefined }) {
  return (
    <dl className={cx('rl-kv', className)}>
      {items.map((item) => (
        <div key={item.label} className="rl-kv__row">
          <dt>{item.label}</dt>
          <dd data-testid={item.testId}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
