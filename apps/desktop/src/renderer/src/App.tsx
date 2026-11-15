import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Language } from '@rl/core';
import i18n from './i18n';
import { rl } from './lib/rl';

/** Empty shell: title + UI language. Real screens are added by the frontend role. */
export function App() {
  const { t } = useTranslation();
  const [language, setLanguage] = useState<Language>('it');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    rl.invoke('settings:get', {}).then(
      (s) => {
        if (!alive) return;
        setLanguage(s.uiLanguage);
        setLoaded(true);
        void i18n.changeLanguage(s.uiLanguage);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);

  const onChange = async (next: Language) => {
    setLanguage(next);
    await i18n.changeLanguage(next);
    await rl.invoke('settings:set', { uiLanguage: next }).catch(() => {});
  };

  return (
    <main className="shell">
      <h1 data-testid="app-title">{t('app.title')}</h1>
      <p>{t('app.tagline')}</p>
      <p data-testid="shell-empty">{t('shell.empty')}</p>
      <label>
        {t('shell.language')}{' '}
        <select data-testid="language-select" disabled={!loaded} value={language} onChange={(e) => void onChange(e.target.value as Language)}>
          <option value="it">{t('languages.it')}</option>
          <option value="en">{t('languages.en')}</option>
        </select>
      </label>
    </main>
  );
}
