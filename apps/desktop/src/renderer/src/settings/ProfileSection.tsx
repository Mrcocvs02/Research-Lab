import { useTranslation } from 'react-i18next';
import { userProfileSchema, type UserProfile } from '@rl/core';
import { Switch } from '../components/Switch';
import { rl } from '../lib/rl';
import { splitLines, validateWith, validationKey } from '../lib/validate';
import { useApp } from '../state/app-context';
import { Group, Row, SectionHead, TextRow } from './rows';
import { useAutoSave } from './useAutoSave';

type Field = 'name' | 'email' | 'orcid' | 'openAlexId';

/** Profile (6.1): who you are, the names you appear under among authors, identifiers and the OpenAlex email choice. Every field saves by itself. */
export function ProfileSection() {
  const { t } = useTranslation();
  const app = useApp();
  const user = app.settings?.user;
  const mail = useAutoSave();
  const on = app.settings?.network?.openAlexEmail ?? false;
  const hasEmail = (user?.email ?? '').trim() !== '';
  const patch = async (p: Partial<UserProfile>) => {
    await rl.invoke('settings:set', { user: p });
    await app.refresh();
  };
  // A value is checked with the core schema against the profile it would join (the same rule as the main process).
  const check = (field: Field | 'authorVariants', v: unknown) => (validateWith(userProfileSchema, { ...user, [field]: v }).errors[field] ? t(validationKey(field)) : undefined);
  const field = (f: Field) => ({ value: user?.[f] ?? '', validate: (v: string) => check(f, v.trim()), commit: (v: string) => patch({ [f]: v.trim() }) });
  return (
    <>
      <SectionHead title={t('settings.sec.profile')} intro={t('settings.intro.profile')} />
      <Group>
        <TextRow sid="userName" label={t('profile.name')} placeholder={t('profile.namePlaceholder')} testId="settings-profile-name" {...field('name')} />
        <TextRow sid="userVariants" label={t('profile.variants')} help={t('profile.variantsHint')} multiline placeholder={t('profile.variantsPlaceholder')} value={(user?.authorVariants ?? []).join('\n')} validate={(v) => check('authorVariants', splitLines(v))} commit={(v) => patch({ authorVariants: splitLines(v) })} />
        <TextRow sid="userEmail" label={t('profile.email')} placeholder="name@example.org" type="email" {...field('email')} />
        <TextRow sid="userOrcid" label={t('profile.orcid')} placeholder="0000-0000-0000-0000" {...field('orcid')} />
        <TextRow sid="userOpenAlexId" label={t('profile.openAlexId')} placeholder="A1234567890" help={t('settings.profile.openAlexHelp')} {...field('openAlexId')} />
      </Group>
      <Group title={t('settings.network.title')}>
        <Row sid="openAlexEmail" label={t('settings.network.openAlexEmail')} help={hasEmail || on ? t('settings.network.openAlexEmailHint') : `${t('settings.network.openAlexEmailHint')} ${t('settings.network.noEmail')}`} save={mail}>
          <Switch
            aria-label={t('settings.network.openAlexEmail')}
            checked={on}
            disabled={!hasEmail && !on}
            onChange={(v) => void mail.run(async () => (await rl.invoke('settings:set', { network: { openAlexEmail: v } }), app.refresh()))}
            data-testid="net-openalex-email"
          />
        </Row>
      </Group>
    </>
  );
}
