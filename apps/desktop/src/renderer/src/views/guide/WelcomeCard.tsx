import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiUi } from '../../lib/aiUi';
import { useEffectiveShortcuts } from '../../lib/keymap';
import { rl } from '../../lib/rl';
import { useApp } from '../../state/app-context';
import './guide.css';

/** Tips of the welcome card (texts: `guide.tips.<id>`); each can be closed for good (`guide.dismissedTips`). */
const TIPS = ['palette', 'search', 'backup'] as const;

/**
 * Shown once, on the first open after the guided first run (`guide.welcomeSeen`, D-262): a short welcome, the way to the
 * guide and a few tips the user can dismiss one by one. It never blocks the window.
 */
export function WelcomeCard() {
  const { t } = useTranslation();
  const app = useApp();
  const { openGuide } = useAiUi();
  const keys = useEffectiveShortcuts();
  const [error, setError] = useState(false);
  const dismissed = app.settings?.guide?.dismissedTips ?? [];
  const tips = TIPS.filter((id) => !dismissed.includes(id));

  const save = async (patch: { welcomeSeen?: boolean; dismissedTips?: string[] }) => {
    setError(false);
    try {
      await rl.invoke('settings:set', { guide: patch });
      await app.refresh();
    } catch {
      setError(true);
    }
  };

  return (
    <aside className="welcome-card" aria-labelledby="welcome-title" data-testid="welcome-card">
      <h2 id="welcome-title">{t('guide.welcome.title')}</h2>
      <p>{t('guide.welcome.body')}</p>
      {tips.length > 0 && (
        <ul className="welcome-tips" aria-label={t('guide.welcome.tips')}>
          {tips.map((id) => (
            <li key={id} data-tip={id}>
              <span>{t(`guide.tips.${id}`, { palette: keys['palette.open'] ?? '', search: keys['search.focus'] ?? '' })}</span>
              <button type="button" className="link" onClick={() => void save({ dismissedTips: [...dismissed, id] })} aria-label={t('guide.welcome.hideTip')} data-testid="welcome-tip-hide">
                {t('guide.welcome.hide')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="field-error" role="alert">
          {t('guide.welcome.saveFailed')}
        </p>
      )}
      <div className="actions">
        <button type="button" onClick={() => openGuide('guide')} data-testid="welcome-open-guide">
          {t('guide.welcome.open')}
        </button>
        <button type="button" className="primary" onClick={() => void save({ welcomeSeen: true })} data-testid="welcome-dismiss">
          {t('guide.welcome.gotIt')}
        </button>
      </div>
    </aside>
  );
}
