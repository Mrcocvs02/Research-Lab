import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckField, ErrorNote } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { rl } from '../lib/rl';
import { useApp } from '../state/app-context';

/** Online sources (citations, monitoring): the one setting, whether the profile email goes to OpenAlex. */
export function NetworkSection() {
  const { t } = useTranslation();
  const app = useApp();
  const on = app.settings?.network?.openAlexEmail ?? false;
  const hasEmail = (app.settings?.user.email ?? '').trim() !== '';
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const set = async (value: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await rl.invoke('settings:set', { network: { openAlexEmail: value } });
      await app.refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="settings-network" data-testid="settings-network">
      <h2 id="settings-network">{t('settings.network.title')}</h2>
      <p className="hint">{t('settings.network.intro')}</p>
      <CheckField
        label={t('settings.network.openAlexEmail')}
        hint={hasEmail || on ? t('settings.network.openAlexEmailHint') : `${t('settings.network.openAlexEmailHint')} ${t('settings.network.noEmail')}`}
        checked={on}
        disabled={busy || (!hasEmail && !on)}
        onChange={(e) => void set(e.target.checked)}
        data-testid="net-openalex-email"
      />
      {error ? <ErrorNote>{errorMessage(error, t)}</ErrorNote> : null}
    </section>
  );
}
