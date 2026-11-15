import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppNotice } from '@rl/core';
import { rl } from '../lib/rl';

/**
 * Startup notices from the main process (settings file reset, settings from a newer version).
 * They are pulled once on mount (the event may have fired before this component existed) and
 * also arrive as `app:notice` events; both paths are de-duplicated by id.
 */
export function NoticeBanner() {
  const { t } = useTranslation();
  const [notices, setNotices] = useState<AppNotice[]>([]);

  const add = useCallback((incoming: AppNotice[]) => {
    setNotices((cur) => [...cur, ...incoming.filter((n) => !cur.some((c) => c.id === n.id))]);
  }, []);

  useEffect(() => {
    let alive = true;
    rl.invoke('app:notices', {}).then(
      (r) => alive && add(r.notices),
      () => {},
    );
    const off = rl.on('app:notice', (n) => add([n]));
    return () => {
      alive = false;
      off();
    };
  }, [add]);

  const dismiss = (id: string) => {
    setNotices((cur) => cur.filter((n) => n.id !== id));
    rl.invoke('app:dismissNotice', { id }).catch(() => {});
  };

  if (notices.length === 0) return null;
  return (
    <div className="notice-stack" data-testid="notice-banner">
      {notices.map((n) => (
        <div key={n.id} className="notice-banner" role="alert" data-notice={n.kind}>
          <p>
            {n.kind === 'settings-reset'
              ? t('notices.settingsReset', { reason: t(`notices.reason.${n.reason}`), backup: n.backupName ?? '' })
              : t('notices.settingsReadOnly', { found: n.foundVersion, supported: n.supportedVersion })}
            {n.kind === 'settings-reset' && n.fields.length > 0 ? ` ${t('notices.fields', { fields: n.fields.join(', ') })}` : ''}
          </p>
          <button type="button" onClick={() => dismiss(n.id)}>
            {t('notices.dismiss')}
          </button>
        </div>
      ))}
    </div>
  );
}
