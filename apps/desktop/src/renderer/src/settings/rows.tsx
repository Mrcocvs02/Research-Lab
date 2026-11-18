import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiAccount, BackupSettings, LibraryConfigPatch } from '@rl/core';
import { errorMessage } from '../lib/errors';
import { rl } from '../lib/rl';
import { useApp } from '../state/app-context';
import { useAutoText, type Save } from './useAutoSave';
import './settings.css';

/** What the page shares with its sections: where the search or the palette pointed, and the Claude account (one `claude auth status` for the page). */
export interface SettingsContextValue {
  /** The control to reach: its row id (`data-set`) and, in Advanced, the group to open. `nonce` changes at every request. */
  target: { id: string; fold?: string | undefined; nonce: number } | null;
  account: AiAccount | null;
  accountError: unknown;
  reloadAccount(): Promise<void>;
  /** Replaces the account the page knows (after a mode change, a login or a logout). */
  setAccount(a: AiAccount): void;
  /** Backup settings (for the warning of the navigation) and a reload after a backup or a change. */
  backup: BackupSettings | null;
  reloadBackup(): Promise<void>;
  goTo(sectionId: string, rowId?: string): void;
}

export const SettingsContext = createContext<SettingsContextValue>({ target: null, account: null, accountError: null, reloadAccount: async () => {}, setAccount() {}, backup: null, reloadBackup: async () => {}, goTo() {} });
export const useSettings = () => useContext(SettingsContext);

/** "✓ Saved" for 2 s after a save (polite live region), nothing otherwise. */
export function SavedMark({ save, text }: { save: Save | undefined; text?: string | undefined }) {
  const { t } = useTranslation();
  return (
    <span className="saved" role="status">
      {save?.state === 'saved' ? `✓ ${text ?? t('common.saved')}` : ''}
    </span>
  );
}

/** The error of a failed save, under its control. */
export function SaveError({ save }: { save: Save | undefined }) {
  const { t } = useTranslation();
  return save?.state === 'error' ? (
    <p className="field-error" role="alert">
      {errorMessage(save.error, t)}
    </p>
  ) : null;
}

/** A setting: name and help on the left (220 px), the control on the right, "✓ Saved" and the error next to it (4.6). `sid` is the id the search points at. */
export function Row({ sid, label, help, save, savedText, htmlFor, error, children }: { sid: string; savedText?: string | undefined; label: string; help?: string | undefined; save?: Save | undefined; htmlFor?: string | undefined; error?: string | undefined; children: ReactNode }) {
  return (
    <div className="srow" data-set={sid}>
      <div className="srow__l">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="srow__t">{label}</span>}
        {help && <p className="help">{help}</p>}
      </div>
      <div className="srow__c">
        <div className="srow__ctl">
          {children}
          <SavedMark save={save} text={savedText} />
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <SaveError save={save} />
      </div>
    </div>
  );
}

/** A group of rows: a card with a small capital title (4.6). */
export function Group({ title, children, testId, sid }: { title?: string | undefined; children: ReactNode; testId?: string | undefined; sid?: string | undefined }) {
  return (
    <section className="card set-group" data-testid={testId} data-set={sid}>
      {title && <h3 className="caption">{title}</h3>}
      {children}
    </section>
  );
}

/** A closed `<details>` of Advanced (4.8): its content is only built once it is open; the search and the palette open it. */
export function Fold({ fold, title, children }: { fold: string; title: string; children: ReactNode }) {
  const { target } = useSettings();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (target?.fold === fold) setOpen(true);
  }, [target, fold]);
  return (
    <details className="set-fold" open={open} onToggle={(e) => setOpen(e.currentTarget.open)} data-fold={fold} data-testid={`settings-fold-${fold}`}>
      <summary>{title}</summary>
      {open && <div className="set-fold__body">{children}</div>}
    </details>
  );
}

/** A section's title and its one-line purpose. */
export function SectionHead({ title, intro }: { title: string; intro?: string | undefined }) {
  return (
    <header className="set-head">
      <h2>{title}</h2>
      {intro && <p className="muted">{intro}</p>}
    </header>
  );
}

/** A text setting that saves by itself (see `useAutoText`); `validate` returns the notice to show for an invalid value. */
export function TextRow({
  sid,
  label,
  help,
  value,
  commit,
  validate,
  multiline,
  short,
  placeholder,
  type,
  inputMode,
  testId,
  maxLength,
  disabled,
}: {
  sid: string;
  label: string;
  help?: string | undefined;
  value: string;
  commit(v: string): Promise<unknown>;
  validate?: ((v: string) => string | undefined) | undefined;
  multiline?: boolean | undefined;
  short?: boolean | undefined;
  placeholder?: string | undefined;
  type?: 'text' | 'email' | undefined;
  inputMode?: 'decimal' | 'numeric' | undefined;
  testId?: string | undefined;
  maxLength?: number | undefined;
  disabled?: boolean | undefined;
}) {
  const id = useId();
  const a = useAutoText(value, commit, validate);
  const common = { id, value: a.draft, placeholder, disabled, 'aria-invalid': a.problem ? true : undefined, 'data-testid': testId, onBlur: a.flush };
  return (
    <Row sid={sid} label={label} help={help} htmlFor={id} save={a.save} error={a.problem}>
      {multiline ? (
        <textarea {...common} rows={3} onChange={(e) => a.change(e.target.value)} />
      ) : (
        <input {...common} type={type ?? 'text'} inputMode={inputMode} maxLength={maxLength} className={short ? 'is-short' : undefined} onChange={(e) => a.change(e.target.value)} />
      )}
    </Row>
  );
}

/** Saves a patch of library.json of the active library, then reads the app state again (the settings are the source of what is shown). */
export function useLibraryPatch(): (patch: LibraryConfigPatch) => Promise<void> {
  const app = useApp();
  const libraryId = app.activeLibraryId;
  const { refresh } = app;
  return useCallback(
    async (patch) => {
      if (!libraryId) return;
      await rl.invoke('library:setConfig', { libraryId, patch });
      await refresh();
    },
    [libraryId, refresh],
  );
}

/** Shown instead of a section's library settings while no library is active. */
export function NeedsLibrary() {
  const { t } = useTranslation();
  return <p className="set-help">{t('settings.needsLibrary')}</p>;
}

/** The page-level state of the sections: the target of a search and the Claude account (one `claude auth status` at open, then the `ai:accountChanged` event). */
export function SettingsProvider({ children, target = null, goTo = () => {} }: { children: ReactNode; target?: SettingsContextValue['target']; goTo?: SettingsContextValue['goTo'] }) {
  const [account, setAccount] = useState<AiAccount | null>(null);
  const [accountError, setAccountError] = useState<unknown>(null);
  const reloadAccount = useCallback(async () => {
    try {
      setAccount(await rl.invoke('ai:account', {}));
      setAccountError(null);
    } catch (e) {
      setAccountError(e);
    }
  }, []);
  const [backup, setBackup] = useState<BackupSettings | null>(null);
  const reloadBackup = useCallback(async () => {
    try {
      setBackup(await rl.invoke('backup:settings', {}));
    } catch {
      setBackup(null);
    }
  }, []);
  useEffect(() => {
    void reloadAccount();
    void reloadBackup();
    return rl.on('ai:accountChanged', setAccount);
  }, [reloadAccount, reloadBackup]);
  // W4: the user may sign out of Claude Code in a terminal; the account is read again when the window gets the focus back (at most once every 30 s).
  useEffect(() => {
    let last = Date.now();
    const again = () => {
      if (document.visibilityState === 'hidden' || Date.now() - last < 30_000) return;
      last = Date.now();
      void reloadAccount();
    };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, [reloadAccount]);
  const value = useMemo(() => ({ target, account, accountError, reloadAccount, setAccount, backup, reloadBackup, goTo }), [target, account, accountError, reloadAccount, backup, reloadBackup, goTo]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
