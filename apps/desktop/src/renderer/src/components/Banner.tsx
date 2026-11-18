import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from './cx';
import { Button } from './Button';
import { IconAlert, IconClose, IconError, IconInfo } from './icons';
import { IconButton } from './IconButton';
import './overlays.css';

export type BannerTone = 'info' | 'warning' | 'error';
const ICON = { info: IconInfo, warning: IconAlert, error: IconError } as const;

/** In-flow message (D-305): icon in the tone colour, text, at most one action, optional Close. Errors are announced (`role=alert`). */
export function Banner({
  tone = 'info',
  children,
  action,
  onClose,
  className,
}: {
  tone?: BannerTone;
  children: ReactNode;
  action?: { label: string; onClick(): void } | undefined;
  onClose?: (() => void) | undefined;
  className?: string | undefined;
}) {
  const { t } = useTranslation();
  const Icon = ICON[tone];
  return (
    <div className={cx('rl-banner', `rl-banner--${tone}`, className)} role={tone === 'error' ? 'alert' : 'status'}>
      <span className="rl-banner__icon">
        <Icon size={20} />
      </span>
      <div className="rl-banner__text">{children}</div>
      {action && (
        <Button size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
      {onClose && (
        <IconButton label={t('common.close')} size="sm" onClick={onClose}>
          <IconClose size={16} />
        </IconButton>
      )}
    </div>
  );
}
