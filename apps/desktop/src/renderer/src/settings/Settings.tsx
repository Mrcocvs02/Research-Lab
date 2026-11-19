import { useCallback, useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Lazy, lazyView } from '../components/Lazy';
import { useAiUi } from '../lib/aiUi';
import { useNav } from '../lib/nav';
import { Icon } from '../shell/shellIcons';
import { daysSince, STALE_BACKUP_DAYS } from './backupAge';
import { GeneralSection } from './GeneralSection';
import { LibraryConfigSection } from './LibraryConfigSection';
import { ProfileSection } from './ProfileSection';
import { SettingsProvider, useSettings, type SettingsContextValue } from './rows';
import { entryById, searchSettings, SETTINGS_SECTIONS, type SettingsMatch, type SettingsSectionId } from './settingsIndex';
import './settings.css';

// Each of the big sections loads, with its own strings, when it is opened (and not before).
const ClaudeSection = lazyView(() => import('./ClaudeSection').then((m) => ({ default: m.ClaudeSection })), ['aiSettings']);
const AdvancedSection = lazyView(() => import('./AdvancedSection').then((m) => ({ default: m.AdvancedSection })), ['aiSettings', 'settings']);
const BackupSection = lazyView(() => import('./BackupSection').then((m) => ({ default: m.BackupSection })), ['backup']);
const ShortcutsSection = lazyView(() => import('./ShortcutsSection').then((m) => ({ default: m.ShortcutsSection })), ['shortcuts']);

/** Takes the focus to the control a search result points at: opens the Advanced group and any `<details>` above it, scrolls, focuses. */
function reach(id: string): boolean {
  const row = document.querySelector<HTMLElement>(`[data-set="${id}"], [data-fold="${id}"]`);
  if (!row) return false;
  for (let d = row.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
  row.scrollIntoView?.({ block: 'center' });
  const control = row.matches('details') ? row.querySelector<HTMLElement>('summary') : row.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea, button, [role="radio"][aria-checked="true"]');
  (control ?? row).focus?.();
  return true;
}

/** The search box of the settings: filters the index by label, synonyms, section and group; Enter opens the chosen result and focuses its control. */
function SettingsSearch({ onPick }: { onPick(m: SettingsMatch): void }) {
  const { t } = useTranslation();
  const id = useId();
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const results = useMemo(() => searchSettings(query, t), [query, t]);
  const pick = (m: SettingsMatch | undefined) => {
    if (!m) return;
    setQuery('');
    onPick(m);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAt((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAt((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(results[at]);
    } else if (e.key === 'Escape') setQuery('');
  };
  return (
    <div className="set-search">
      <Icon name="search" size={16} className="set-search__icon" />
      <input
        type="search"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={`${id}-list`}
        aria-label={t('settings.search.label')}
        placeholder={t('settings.search.placeholder')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setAt(0);
        }}
        onKeyDown={onKey}
        data-testid="settings-search"
      />
      {query.trim() !== '' && (
        <ul className="set-results" id={`${id}-list`} role="listbox" data-testid="settings-results">
          {results.length === 0 && (
            <li className="muted" role="presentation" style={{ padding: '6px 8px' }}>
              {t('settings.search.none')}
            </li>
          )}
          {results.map((m, i) => (
            <li key={m.entry.id} role="presentation">
              <button type="button" role="option" aria-selected={i === at} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m)} data-testid="settings-result" data-entry={m.entry.id}>
                {m.label}
                <small>{m.where}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Page({ section, setSection, onNewLibrary }: { section: SettingsSectionId; setSection(s: SettingsSectionId): void; onNewLibrary(): void }) {
  const { t } = useTranslation();
  const { account, backup, target, goTo } = useSettings();
  // W12: the crumbs say "Settings > Claude".
  const { setTitle } = useNav();
  useEffect(() => {
    setTitle(t(`settings.sec.${section}`));
    return () => setTitle(null);
  }, [section, setTitle, t]);

  // The control a search or a link points at is found once its section (and the group, in Advanced) has been drawn.
  useEffect(() => {
    if (!target) return;
    const until = Date.now() + 6000;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (reach(target.id) || Date.now() > until) return;
      timer = setTimeout(tick, 50);
    };
    tick();
    return () => clearTimeout(timer);
  }, [target, section]);

  const warn: Partial<Record<SettingsSectionId, string>> = {};
  if (backup && (backup.lastAutoError || (backup.lastBackupAt && (daysSince(backup.lastBackupAt) ?? 0) > STALE_BACKUP_DAYS))) warn.backup = t('settings.warn.backup');
  if (account && account.effective === 'none') warn.claude = t('settings.warn.claude');

  const body = (() => {
    switch (section) {
      case 'general':
        return <GeneralSection />;
      case 'profile':
        return <ProfileSection />;
      case 'library':
        return <LibraryConfigSection onNewLibrary={onNewLibrary} />;
      case 'claude':
        return <ClaudeSection />;
      case 'backup':
        return <BackupSection />;
      case 'shortcuts':
        return <ShortcutsSection />;
      case 'advanced':
        return <AdvancedSection />;
    }
  })();

  return (
    <div className="view set-page" data-testid="settings-page">
      <h1>{t('sections.settings')}</h1>
      <div className="set">
        <nav className="set-nav" aria-label={t('sections.settings')}>
          <SettingsSearch onPick={(m) => goTo(m.entry.section, m.entry.id)} />
          {SETTINGS_SECTIONS.map((s) => (
            <div key={s} style={{ display: 'contents' }}>
              {s === 'advanced' && <div className="set-nav__sep" role="separator" />}
              <button type="button" className="set-nav__item" aria-current={section === s ? 'page' : undefined} onClick={() => setSection(s)} data-testid={`settings-nav-${s}`}>
                {t(`settings.sec.${s}`)}
                {warn[s] && (
                  <span className="set-nav__warn" role="img" aria-label={warn[s]} title={warn[s]} data-testid={`settings-warn-${s}`}>
                    ⚠
                  </span>
                )}
              </button>
            </div>
          ))}
        </nav>
        <div className="set-body" data-testid={`settings-section-${section}`}>
          <Lazy>{body}</Lazy>
        </div>
      </div>
    </div>
  );
}

/**
 * The settings page (4.6): a sub-navigation with a search, and one section at a time. The palette and links open it at a section
 * or at a setting of the index (`navigation.focus`: `backup`, a section id, or an entry id of `settingsIndex.ts`).
 */
export function Settings({ onNewLibrary }: { onNewLibrary(): void }) {
  const { navigation } = useAiUi();
  const [section, setSection] = useState<SettingsSectionId>('general');
  const [target, setTarget] = useState<SettingsContextValue['target']>(null);

  const goTo = useCallback((sectionId: string, rowId?: string) => {
    setSection((SETTINGS_SECTIONS as readonly string[]).includes(sectionId) ? (sectionId as SettingsSectionId) : 'general');
    const fold = rowId ? entryById(rowId)?.fold : undefined;
    if (rowId) setTarget((cur) => ({ id: rowId, fold, nonce: (cur?.nonce ?? 0) + 1 }));
  }, []);

  const focus = navigation?.focus as string | undefined;
  useEffect(() => {
    if (navigation?.to !== 'settings' || !focus || focus === 'search') return;
    const entry = entryById(focus);
    if (entry) goTo(entry.section, entry.id);
    else if ((SETTINGS_SECTIONS as readonly string[]).includes(focus)) goTo(focus);
  }, [navigation?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SettingsProvider target={target} goTo={goTo}>
      <Page section={section} setSection={setSection} onNewLibrary={onNewLibrary} />
    </SettingsProvider>
  );
}
