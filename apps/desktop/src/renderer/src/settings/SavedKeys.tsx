import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SecretScope } from '@rl/core';
import { Button } from '../components/Button';
import { rl } from '../lib/rl';
import { useApp } from '../state/app-context';
import { Group, Row, SaveError, SavedMark } from './rows';
import { useAutoSave } from './useAutoSave';

/** The keys the app can hold. Their values never come back from the main process: only "saved" or "not saved" is shown (6.3). */
export const KEYS = [
  { name: 'anthropic-api-key', scope: 'app', sid: 'secretAnthropic' },
  { name: 'openalex-api-key', scope: 'app', sid: 'secretOpenAlex' },
  { name: 'gemini-api-key', scope: 'library', sid: 'secretGemini' },
] as const;
export type KeyName = (typeof KEYS)[number]['name'];

/** State and actions of one key: write-only, in the OS secure store. `scope` null (a library key with no library) means unavailable. */
export function useSecret(name: KeyName, scope: 'app' | 'library', onChanged?: () => void) {
  const app = useApp();
  const libraryId = app.activeLibraryId;
  const sc = useMemo<SecretScope | null>(() => (scope === 'app' ? { kind: 'app' } : libraryId ? { kind: 'library', libraryId } : null), [scope, libraryId]);
  const [stored, setStored] = useState<boolean | null>(null);
  const save = useAutoSave();
  const reload = useCallback(async () => {
    if (!sc) return setStored(null);
    try {
      setStored((await rl.invoke('secrets:has', { scope: sc, name })).exists);
    } catch {
      setStored(null);
    }
  }, [sc, name]);
  useEffect(() => void reload(), [reload]);
  const apply = async (fn: () => Promise<unknown>) => {
    const ok = await save.run(fn);
    if (ok) {
      await reload();
      onChanged?.();
    }
    return ok;
  };
  const put = (value: string) => apply(() => rl.invoke('secrets:set', { scope: sc!, name, value }));
  const remove = () => apply(() => rl.invoke('secrets:delete', { scope: sc!, name }));
  return { stored, available: sc !== null, save, put, remove };
}

/** One key as a control: state, "Add key…" / "Replace…" (a password field, never shown back) and "Remove". */
export function SecretControl({ name, scope, onChanged, primary }: { name: KeyName; scope: 'app' | 'library'; onChanged?: () => void; /** The "Add key…" button is the primary action of the card (an API key is what is missing). */ primary?: boolean }) {
  const { t } = useTranslation();
  const s = useSecret(name, scope, onChanged);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  if (!s.available) return <span className="muted">{t('settings.needsLibrary')}</span>;
  const done = async () => {
    if (await s.put(value.trim())) {
      setValue('');
      setEditing(false);
    }
  };
  return (
    <div className="secret-row" data-testid={`secret-${name}`}>
      <span className={s.stored ? 'badge ok' : 'badge'} data-testid={`secret-status-${name}`}>
        {s.stored ? t('settings.keys.stored') : t('settings.keys.notStored')}
      </span>
      {editing ? (
        <>
          <input type="password" autoComplete="off" spellCheck={false} autoFocus aria-label={t(`settings.keys.names.${name}`)} placeholder={t('settings.keys.placeholder')} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && value.trim() && void done()} data-testid={`secret-input-${name}`} />
          <Button variant="primary" size="sm" disabled={!value.trim()} onClick={() => void done()} data-testid={`secret-save-${name}`}>
            {t('common.save')}
          </Button>
          <Button size="sm" onClick={() => (setEditing(false), setValue(''))}>
            {t('common.cancel')}
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" variant={primary && !s.stored ? 'primary' : 'secondary'} onClick={() => setEditing(true)} data-testid={`secret-add-${name}`}>
            {s.stored ? t('settings.keys.replace') : t('settings.keys.add')}
          </Button>
          {s.stored && (
            <Button size="sm" variant="ghost" onClick={() => void s.remove()} data-testid={`secret-remove-${name}`}>
              {t('settings.keys.remove')}
            </Button>
          )}
        </>
      )}
      <SavedMark save={s.save} />
      <SaveError save={s.save} />
    </div>
  );
}

/** "Saved keys" at the top of Advanced (6.3): the three keys together, same component as where they are used. */
export function SavedKeys() {
  const { t } = useTranslation();
  return (
    <Group title={t('settings.keys.title')} testId="saved-keys">
      <p className="set-help">{t('settings.keys.intro')}</p>
      {KEYS.map((k) => (
        <Row key={k.name} sid={k.sid} label={t(`settings.keys.names.${k.name}`)} help={k.name === 'gemini-api-key' ? t('settings.keys.experimental') : undefined}>
          <SecretControl name={k.name} scope={k.scope} />
        </Row>
      ))}
    </Group>
  );
}
