import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SecretScope } from '@rl/core';
import { ErrorNote } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { rl } from '../lib/rl';
import { useApp } from '../state/app-context';
import './settings.css';

/** Names of the keys listed here; the value never comes back from the main process. The Anthropic key is in the AI settings. */
export const SECRET_NAMES = ['gemini-api-key'] as const;
type SecretName = (typeof SECRET_NAMES)[number];

/** API keys for the active library profile: write-only, with an "is set" indicator. */
export function SecretsSection() {
  const { t } = useTranslation();
  const app = useApp();
  const libraryId = app.activeLibraryId;
  const [exists, setExists] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);

  const scope = useCallback((): SecretScope | null => (libraryId ? { kind: 'library', libraryId } : null), [libraryId]);

  const reload = useCallback(async () => {
    const sc = scope();
    if (!sc) return;
    try {
      const entries = await Promise.all(SECRET_NAMES.map(async (name) => [name, (await rl.invoke('secrets:has', { scope: sc, name })).exists] as const));
      setExists(Object.fromEntries(entries));
    } catch (e) {
      setError(e);
    }
  }, [scope]);

  useEffect(() => {
    setValues({});
    void reload();
  }, [reload]);

  const save = async (name: SecretName) => {
    const sc = scope();
    const value = values[name];
    if (!sc || !value) return;
    setError(null);
    try {
      await rl.invoke('secrets:set', { scope: sc, name, value });
      setValues((v) => ({ ...v, [name]: '' }));
      await reload();
    } catch (e) {
      setError(e);
    }
  };

  const remove = async (name: SecretName) => {
    const sc = scope();
    if (!sc) return;
    setError(null);
    try {
      await rl.invoke('secrets:delete', { scope: sc, name });
      await reload();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <section className="card" aria-labelledby="settings-secrets">
      <h2 id="settings-secrets">{t('settings.secrets.title')}</h2>
      {!libraryId ? (
        <p className="hint">{t('settings.needsLibrary')}</p>
      ) : (
        <>
          <p className="hint">{t('settings.secrets.intro', { name: app.activeProfile?.name ?? '' })}</p>
          <ul className="secret-list">
            {SECRET_NAMES.map((name) => (
              <li key={name} data-testid={`secret-${name}`}>
                <div className="secret-head">
                  <label htmlFor={`secret-input-${name}`}>{t(`settings.secrets.names.${name}`)}</label>
                  <span className={exists[name] ? 'badge ok' : 'badge'} data-testid={`secret-status-${name}`}>
                    {exists[name] ? t('settings.secrets.set') : t('settings.secrets.notSet')}
                  </span>
                </div>
                <div className="inline-form">
                  <input
                    id={`secret-input-${name}`}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={values[name] ?? ''}
                    placeholder={exists[name] ? t('settings.secrets.replacePlaceholder') : t('settings.secrets.placeholder')}
                    onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
                  />
                  <button type="button" className="primary" disabled={!values[name]} onClick={() => void save(name)}>
                    {t('common.save')}
                  </button>
                  <button type="button" disabled={!exists[name]} onClick={() => void remove(name)}>
                    {t('settings.secrets.delete')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="hint">{t('settings.secrets.storage')}</p>
        </>
      )}
      {error ? <ErrorNote>{errorMessage(error, t)}</ErrorNote> : null}
    </section>
  );
}
