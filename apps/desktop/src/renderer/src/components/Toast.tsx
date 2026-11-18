import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from './cx';
import { IconCheck, IconClose, IconError, IconInfo } from './icons';
import { IconButton } from './IconButton';
import './overlays.css';

export type ToastTone = 'info' | 'success' | 'error';
const ICON = { info: IconInfo, success: IconCheck, error: IconError } as const;

/** Bottom-right stack (D-366 rule 4); put the toasts inside it. The timing and the queue belong to the notification provider. */
export function ToastRegion({ children }: { children: ReactNode }) {
  return (
    <div className="rl-toasts" aria-live="polite">
      {children}
    </div>
  );
}

/** One toast, 360 px at most: tone icon, text, an optional action (for example Undo) and Close. */
export function Toast({
  tone = 'info',
  children,
  action,
  onClose,
}: {
  tone?: ToastTone;
  children: ReactNode;
  action?: { label: string; onClick(): void } | undefined;
  onClose?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const Icon = ICON[tone];
  return (
    <div className={cx('rl-toast', `rl-toast--${tone}`)} role={tone === 'error' ? 'alert' : 'status'}>
      <span className="rl-toast__icon">
        <Icon size={20} />
      </span>
      <div className="rl-toast__text">{children}</div>
      {action && (
        <button type="button" className="rl-toast__action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {onClose && (
        <IconButton label={t('common.close')} size="sm" onClick={onClose}>
          <IconClose size={16} />
        </IconButton>
      )}
    </div>
  );
}
