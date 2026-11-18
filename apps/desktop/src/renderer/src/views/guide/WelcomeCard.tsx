import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { IconCheck } from '../../components/icons';
import { useAiUi } from '../../lib/aiUi';
import { useReader } from '../../lib/reader';
import { rl } from '../../lib/rl';
import { useApp } from '../../state/app-context';
import './guide.css';

/** The three first things to try (texts: `guide.welcome.items.<id>`). A step the user has done stays done: it is kept in `guide.dismissedTips`. */
const ITEMS = ['read', 'claude', 'backup'] as const;
type Item = (typeof ITEMS)[number];

/**
 * "Getting started" (4.11, D-262): after the first run, in the banner slot (96 px at most), three things to try that tick
 * themselves — open a PDF, ask Claude, set up a backup — and one button, Close. It never blocks the window.
 */
export function WelcomeCard() {
  const { t } = useTranslation();
  const app = useApp();
  const { chatBusy } = useAiUi();
  const { target } = useReader();
  const [error, setError] = useState(false);
  const stored = app.settings?.guide?.dismissedTips ?? [];
  const done: Record<Item, boolean> = {
    read: stored.includes('read'),
    claude: stored.includes('claude'),
    // A backup schedule is on, or the step was ticked before.
    backup: stored.includes('backup') || (app.settings?.backup?.auto ?? 'off') !== 'off',
  };

  const save = async (patch: { welcomeSeen?: boolean; dismissedTips?: string[] }) => {
    setError(false);
    try {
      await rl.invoke('settings:set', { guide: patch });
      await app.refresh();
    } catch {
      setError(true);
    }
  };

  // The ticks: a document opened in the reader, a message to Claude on its way. Each is written once.
  const ticking = useRef(false);
  const tick = (id: Item) => {
    if (done[id] || ticking.current) return;
    ticking.current = true;
    void save({ dismissedTips: [...stored, id] }).finally(() => {
      ticking.current = false;
    });
  };
  useEffect(() => {
    if (target) tick('read');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  useEffect(() => {
    if (chatBusy) tick('claude');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatBusy]);

  return (
    <aside className="welcome-card" aria-labelledby="welcome-title" data-testid="welcome-card">
      <h2 id="welcome-title">{t('guide.welcome.title')}</h2>
      <ul className="welcome-tips" aria-label={t('guide.welcome.title')}>
        {ITEMS.map((id) => (
          <li key={id} data-tip={id} data-done={done[id]}>
            <span className="welcome-tips__mark" aria-hidden="true">
              {done[id] ? <IconCheck size={16} /> : null}
            </span>
            <span>{t(`guide.welcome.items.${id}`)}</span>
          </li>
        ))}
      </ul>
      {error && (
        <p className="field-error" role="alert">
          {t('guide.welcome.saveFailed')}
        </p>
      )}
      <Button size="sm" variant="ghost" onClick={() => void save({ welcomeSeen: true })} data-testid="welcome-dismiss">
        {t('guide.welcome.close')}
      </Button>
    </aside>
  );
}
