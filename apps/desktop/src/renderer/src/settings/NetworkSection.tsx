import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckField, ErrorNote } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { rl } from '../lib/rl';
import { useApp } from '../state/app-context';

/** The optional OpenAlex key (secure store, app scope). Its value never comes back here: only "saved" or "not saved". */
const API_KEY = 'openalex-api-key';
const SCOPE = { kind: 'app' } as const;

function ApiKeyBlock() {
  const { t } = useTranslation();
  const [stored, setStored] = useState<boolean | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<unknown>(null);
  const reload = useCallback(async () => {
    try {
      setStored((await rl.invoke('secrets:has', { scope: SCOPE, name: API_KEY })).exists);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => void reload(), [reload]);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      setValue('');
      await reload();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <div className="group" data-testid="net-openalex-key">
      <h3>{t('settings.network.apiKey.title')}</h3>
      <p className="hint">{t('settings.network.apiKey.hint')}</p>
      <div className="secret-head">
        <label htmlFor="net-openalex-key-input">{t('settings.network.apiKey.label')}</label>
        <span className={stored ? 'badge ok' : 'badge'} data-testid="net-openalex-key-status">
          {stored ? t('settings.network.apiKey.stored') : t('settings.network.apiKey.notStored')}
        </span>
      </div>
      <div className="inline-form">
        <input
          id="net-openalex-key-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={stored ? t('settings.network.apiKey.replacePlaceholder') : t('settings.network.apiKey.placeholder')}
          onChange={(e) => setValue(e.target.value)}
          data-testid="net-openalex-key-input"
        />
        <button type="button" className="primary" disabled={!value.trim()} onClick={() => void run(() => rl.invoke('secrets:set', { scope: SCOPE, name: API_KEY, value: value.trim() }))} data-testid="net-openalex-key-store">
          {t('settings.network.apiKey.store')}
        </button>
        <button type="button" disabled={!stored} onClick={() => void run(() => rl.invoke('secrets:delete', { scope: SCOPE, name: API_KEY }))} data-testid="net-openalex-key-remove">
          {t('settings.network.apiKey.remove')}
        </button>
      </div>
      {error ? <ErrorNote>{errorMessage(error, t)}</ErrorNote> : null}
    </div>
  );
}

/** Online sources (citations, monitoring): whether the profile email goes to OpenAlex, and the optional OpenAlex API key. */
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
      <ApiKeyBlock />
    </section>
  );
}
