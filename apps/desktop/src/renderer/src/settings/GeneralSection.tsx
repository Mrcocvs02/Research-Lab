import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Language, Theme } from '@rl/core';
import { Button } from '../components/Button';
import { Segmented } from '../components/Segmented';
import { rl } from '../lib/rl';
import { useApp } from '../state/app-context';
import { Group, Row, SectionHead } from './rows';
import { useAutoSave } from './useAutoSave';

/** General (6.1): language and appearance of the interface, the tips, and the version. */
export function GeneralSection() {
  const { t } = useTranslation();
  const app = useApp();
  const lang = useAutoSave();
  const theme = useAutoSave();
  const tips = useAutoSave();
  const about = useAutoSave();
  const [info, setInfo] = useState<string | null>(null);
  useEffect(() => {
    rl.invoke('app:info', {}).then(
      (i) => setInfo(`${i.name} ${i.version} · ${i.platform} · Electron ${i.electron}`),
      () => {},
    );
  }, []);
  const themes: Array<{ value: Theme; label: string }> = [
    { value: 'system', label: t('settings.appearance.system') },
    { value: 'light', label: t('settings.appearance.light') },
    { value: 'dark', label: t('settings.appearance.dark') },
  ];
  return (
    <>
      <SectionHead title={t('settings.sec.general')} intro={t('settings.intro.general')} />
      <Group>
        <Row sid="uiLanguage" label={t('settings.language.label')} help={t('settings.language.hint')} htmlFor="language-select" save={lang}>
          <select id="language-select" value={app.settings?.uiLanguage ?? 'it'} onChange={(e) => void lang.run(() => app.setUiLanguage(e.target.value as Language))} data-testid="language-select">
            <option value="it">{t('languages.it')}</option>
            <option value="en">{t('languages.en')}</option>
          </select>
        </Row>
        <Row sid="theme" label={t('settings.appearance.label')} help={t('settings.appearance.hint')} save={theme}>
          <div data-testid="settings-theme">
            <Segmented label={t('settings.appearance.label')} options={themes} value={app.settings?.appearance?.theme ?? 'system'} onChange={(v) => void theme.run(async () => (await rl.invoke('settings:set', { appearance: { theme: v } }), app.refresh()))} />
          </div>
        </Row>
        <Row sid="tips" label={t('settings.tips.label')} help={t('settings.tips.hint')} save={tips} savedText={t('settings.tips.done')}>
          <Button size="sm" onClick={() => void tips.run(async () => (await rl.invoke('settings:set', { guide: { welcomeSeen: false, dismissedTips: [] } }), app.refresh()))} data-testid="settings-tips-reset">
            {t('settings.tips.button')}
          </Button>
        </Row>
      </Group>
      <Group title={t('settings.about.title')}>
        <Row sid="about" label={t('settings.about.version')} save={about} savedText={t('settings.about.copied')}>
          <span data-testid="settings-version">{info ?? app.version}</span>
          <Button size="sm" onClick={() => void about.run(() => navigator.clipboard.writeText(info ?? app.version))} data-testid="settings-copy-info">
            {t('settings.about.copy')}
          </Button>
        </Row>
      </Group>
    </>
  );
}
