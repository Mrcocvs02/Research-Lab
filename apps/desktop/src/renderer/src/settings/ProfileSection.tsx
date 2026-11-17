import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { userProfileSchema } from '@rl/core';
import { ErrorNote, LanguageSelect, SelectField, TextAreaField, TextField } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { rl } from '../lib/rl';
import { splitLines, validateWith, validationKey } from '../lib/validate';
import { useApp } from '../state/app-context';

/** User profile (name, author variants, identifiers) and the interface language. */
export function ProfileSection() {
  const { t } = useTranslation();
  const app = useApp();
  const user = app.settings?.user;
  const [draft, setDraft] = useState({ name: '', variants: '', email: '', orcid: '', openAlexId: '' });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [langError, setLangError] = useState<unknown>(null);

  useEffect(() => {
    if (user) {
      setDraft({ name: user.name, variants: user.authorVariants.join('\n'), email: user.email, orcid: user.orcid, openAlexId: user.openAlexId });
    }
  }, [user]);

  const check = useMemo(
    () =>
      validateWith(userProfileSchema, {
        name: draft.name,
        authorVariants: splitLines(draft.variants),
        email: draft.email.trim(),
        orcid: draft.orcid.trim(),
        openAlexId: draft.openAlexId.trim(),
      }),
    [draft],
  );
  const err = (key: string) => (check.errors[key] ? t(validationKey(key)) : undefined);
  const edit = (patch: Partial<typeof draft>) => {
    setDraft({ ...draft, ...patch });
    setSaved(false);
  };

  const save = async () => {
    if (!check.data) return;
    setError(null);
    try {
      await rl.invoke('settings:set', { user: check.data });
      await app.refresh();
      setSaved(true);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <section className="card" aria-labelledby="settings-profile">
      <h2 id="settings-profile">{t('settings.profile.title')}</h2>
      <LanguageSelect
        label={t('settings.language.label')}
        hint={t('settings.language.hint')}
        value={app.settings?.uiLanguage ?? 'it'}
        testId="settings-ui-language"
        onChange={(v) => {
          setLangError(null);
          app.setUiLanguage(v).catch((e: unknown) => setLangError(e));
        }}
      />
      {langError ? <ErrorNote>{errorMessage(langError, t)}</ErrorNote> : null}
      <SelectField
        label={t('settings.appearance.label')}
        hint={t('settings.appearance.hint')}
        value={app.settings?.appearance?.theme ?? 'system'}
        data-testid="settings-theme"
        onChange={(e) => {
          setLangError(null);
          rl.invoke('settings:set', { appearance: { theme: e.target.value as 'system' | 'light' | 'dark' } })
            .then(() => app.refresh())
            .catch((err: unknown) => setLangError(err));
        }}
      >
        <option value="system">{t('settings.appearance.system')}</option>
        <option value="light">{t('settings.appearance.light')}</option>
        <option value="dark">{t('settings.appearance.dark')}</option>
      </SelectField>
      <TextField label={t('profile.name')} placeholder={t('profile.namePlaceholder')} value={draft.name} onChange={(e) => edit({ name: e.target.value })} data-testid="settings-profile-name" />
      <TextAreaField label={t('profile.variants')} hint={t('profile.variantsHint')} placeholder={t('profile.variantsPlaceholder')} rows={3} value={draft.variants} onChange={(e) => edit({ variants: e.target.value })} />
      <TextField label={t('profile.email')} type="email" placeholder="name@example.org" value={draft.email} error={err('email')} onChange={(e) => edit({ email: e.target.value })} />
      <TextField label={t('profile.orcid')} placeholder="0000-0000-0000-0000" value={draft.orcid} error={err('orcid')} onChange={(e) => edit({ orcid: e.target.value })} />
      <TextField label={t('profile.openAlexId')} placeholder="A1234567890" value={draft.openAlexId} error={err('openAlexId')} onChange={(e) => edit({ openAlexId: e.target.value })} />
      <div className="actions start">
        <button type="button" className="primary" onClick={() => void save()} disabled={!check.data} data-testid="settings-profile-save">
          {t('common.save')}
        </button>
        <span className="status" role="status">
          {saved ? t('common.saved') : ''}
        </span>
      </div>
      {error ? <ErrorNote>{errorMessage(error, t)}</ErrorNote> : null}
    </section>
  );
}
