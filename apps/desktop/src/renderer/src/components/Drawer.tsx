import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cx } from './cx';
import { IconClose } from './icons';
import { IconButton } from './IconButton';
import { useFocusTrap } from './useFocusTrap';
import './overlays.css';

function DrawerPanel({ title, onClose, side, width, children, testId }: { title: string; onClose(): void; side: 'left' | 'right'; width: number; children: ReactNode; testId?: string | undefined }) {
  const { t } = useTranslation();
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const onKeyDown = useFocusTrap(box, onClose);
  return (
    <div className="rl-drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-testid={testId} className={cx('rl-drawer', `rl-drawer--${side}`)} style={{ width }} onKeyDown={onKeyDown}>
        <header className="rl-drawer__head">
          <h2 id={titleId}>{title}</h2>
          <IconButton label={t('common.close')} size="sm" onClick={onClose}>
            <IconClose size={16} />
          </IconButton>
        </header>
        <div className="rl-drawer__body">{children}</div>
      </div>
    </div>
  );
}

/** Side panel over the content (Claude, document card): `--e-3`, light scrim, Escape or a click outside closes, focus trapped. */
export function Drawer({ open, onClose, title, side = 'right', width = 380, children, testId }: { open: boolean; onClose(): void; title: string; side?: 'left' | 'right'; width?: number; children: ReactNode; testId?: string }) {
  if (!open) return null;
  return createPortal(
    <DrawerPanel title={title} onClose={onClose} side={side} width={width} testId={testId}>
      {children}
    </DrawerPanel>,
    document.body,
  );
}
