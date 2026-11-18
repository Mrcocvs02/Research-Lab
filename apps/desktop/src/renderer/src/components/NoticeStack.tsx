import { useTranslation } from 'react-i18next';
import type { AppNotice } from '@rl/core';
import { Icon } from '../shell/shellIcons';
import './controls.css';
import './overlays.css';

/** The startup notices as in-flow banners (design 7): at most two, the most serious first. */
export function NoticeStack({ notices, onDismiss }: { notices: AppNotice[]; onDismiss(id: string): void }) {
  const { t } = useTranslation();
  // At most two at a time, the most serious first (D-305, 7).
  const shown = [...notices].sort((x, y) => Number(y.kind === 'backup-failed') - Number(x.kind === 'backup-failed')).slice(0, 2);
  return (
    <div className="notice-stack" data-testid="notice-banner">
      {shown.map((n) => {
        const error = n.kind === 'backup-failed';
        return (
          <div key={n.id} className={error ? 'rl-banner rl-banner--error' : 'rl-banner rl-banner--warning'} role={error ? 'alert' : 'status'} data-notice={n.kind}>
            <span className="rl-banner__icon">
              <Icon name="alert" />
            </span>
            <p className="rl-banner__text">
              {n.kind === 'settings-reset'
                ? t('notices.settingsReset', { reason: t(`notices.reason.${n.reason}`), backup: n.backupName ?? '' })
                : n.kind === 'backup-failed'
                  ? t('notices.backupFailed', { code: n.code })
                  : t('notices.settingsReadOnly', { found: n.foundVersion, supported: n.supportedVersion })}
              {n.kind === 'settings-reset' && n.fields.length > 0 ? ` ${t('notices.fields', { fields: n.fields.join(', ') })}` : ''}
            </p>
            <button type="button" className="rl-btn rl-btn--secondary rl-btn--sm" onClick={() => onDismiss(n.id)}>
              {t('notices.dismiss')}
            </button>
          </div>
        );
      })}
    </div>
  );
}
