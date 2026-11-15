import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocalFlag } from '../lib/useLocalFlag';
import { useApp } from '../state/app-context';

export const SECTIONS = ['library', 'projects', 'network', 'inbox', 'settings'] as const;
export type SectionId = (typeof SECTIONS)[number];

interface Props {
  section: SectionId;
  onSection(s: SectionId): void;
  onNewLibrary(): void;
  children: ReactNode;
}

/** Window layout: sidebar, main area, collapsible chat panel placeholder, status bar. */
export function Shell({ section, onSection, onNewLibrary, children }: Props) {
  const { t } = useTranslation();
  const [chatCollapsed, setChatCollapsed] = useLocalFlag('rl.chatCollapsed', false);
  const chatId = useId();

  return (
    <div className="shell" data-testid="shell">
      <a className="skip-link" href="#main">
        {t('shell.skip')}
      </a>
      <aside className="sidebar" aria-label={t('shell.sidebar')}>
        <div className="brand" data-testid="app-title">
          {t('app.title')}
        </div>
        <LibrarySwitcher onNewLibrary={onNewLibrary} />
        <nav aria-label={t('shell.navigation')}>
          <ul>
            {SECTIONS.map((id) => (
              <li key={id} className={id === 'settings' ? 'push-down' : undefined}>
                <button type="button" className="nav-item" aria-current={section === id ? 'page' : undefined} onClick={() => onSection(id)} data-testid={`nav-${id}`}>
                  {t(`sections.${id}`)}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>

      <aside className={chatCollapsed ? 'chat collapsed' : 'chat'} aria-label={t('chat.title')} data-testid="chat-panel">
        <div className="chat-head">
          {!chatCollapsed && <h2>{t('chat.title')}</h2>}
          <button
            type="button"
            className="icon-button"
            aria-expanded={!chatCollapsed}
            aria-controls={chatId}
            aria-label={chatCollapsed ? t('chat.expand') : t('chat.collapse')}
            title={chatCollapsed ? t('chat.expand') : t('chat.collapse')}
            onClick={() => setChatCollapsed(!chatCollapsed)}
            data-testid="chat-toggle"
          >
            <span aria-hidden="true">{chatCollapsed ? '‹' : '›'}</span>
          </button>
        </div>
        <div id={chatId} className="chat-body" hidden={chatCollapsed}>
          <p>{t('chat.placeholder')}</p>
          <p className="hint">{t('chat.note')}</p>
        </div>
      </aside>

      <StatusBar />
    </div>
  );
}

function LibrarySwitcher({ onNewLibrary }: { onNewLibrary(): void }) {
  const { t } = useTranslation();
  const app = useApp();
  const id = useId();
  return (
    <div className="switcher">
      <label htmlFor={id}>{t('shell.activeLibrary')}</label>
      <select id={id} value={app.activeLibraryId ?? ''} onChange={(e) => e.target.value && void app.setActiveLibrary(e.target.value)} data-testid="library-switcher">
        {app.profiles.length === 0 && <option value="">{t('shell.noLibrary')}</option>}
        {app.profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button type="button" className="link" onClick={onNewLibrary}>
        {t('library.new')}
      </button>
    </div>
  );
}

function StatusBar() {
  const { t } = useTranslation();
  const app = useApp();
  const aiCount = app.config?.aiEnabledFolders.length ?? 0;
  return (
    <footer className="statusbar" data-testid="statusbar">
      <span data-testid="status-library">{app.activeProfile ? t('status.library', { name: app.activeProfile.name }) : t('status.noLibrary')}</span>
      {app.config && <span>{t('status.docLanguage', { language: t(`languages.${app.config.language}`) })}</span>}
      {app.config && <span data-testid="status-ai">{aiCount === 0 ? t('status.aiNone') : t('status.aiFolders', { count: aiCount })}</span>}
      <span className="spacer" />
      {app.version && <span>{t('status.version', { version: app.version })}</span>}
    </footer>
  );
}
