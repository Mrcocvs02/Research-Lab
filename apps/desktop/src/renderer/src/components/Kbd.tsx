import type { ComponentPropsWithoutRef } from 'react';
import { cx } from './cx';
import './controls.css';

/** A key as shown in tooltips, menus and the guide: the same everywhere. */
export function Kbd({ className, ...rest }: ComponentPropsWithoutRef<'kbd'>) {
  return <kbd {...rest} className={cx('rl-kbd', className)} />;
}
