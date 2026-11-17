import { useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Lazy, lazyView } from '../components/Lazy';
import { useAiUi } from '../lib/aiUi';
import { CitationIndicator } from '../lib/citationJobs';
import { useInbox } from '../lib/inbox';
import { JobIndicator } from '../lib/jobs';
import { useNotify } from '../lib/notify';
import { useWatchCount } from '../lib/watch';
import { useApp } from '../state/app-context';
import { scanText } from '../views/library/ScanStatusText';
import { useScanStatus } from '../views/library/useScanStatus';

// The chat and the command palette (and all the AI code with them) load the first time they are shown.
const ChatPanel = lazyView(() => import('../views/chat/ChatPanel').then((m) => ({ default: m.ChatPanel })), ['chat', 'chat-preview']);
const Palette = lazyView(() => import('../views/chat/Palette').then((m) => ({ default: m.Palette })), ['palette']);
// The second-brain export dialog loads when an entry point (project, cluster, selection, palette) opens it.
const ExportDialog = lazyView(() => import('../views/export/ExportDialog').then((m) => ({ default: m.ExportDialog })), ['export']);

export const SECTIONS = ['library', 'projects', 'discover', 'network', 'inbox', 'settings'] as const;
export type SectionId = (typeof SECTIONS)[number];

interface Props {
  section: SectionId;
  onSection(s: SectionId): void;
  onNewLibrary(): void;
  children: ReactNode;
}

/** Window layout: sidebar, main area, collapsible chat panel, status bar. */
export function Shell({ section, onSection, onNewLibrary, children }: Props) {
  const { t } = useTranslation();
  const { chatOpen, setChatOpen, paletteOpen, setPaletteOpen, exportInit, closeExport } = useAiUi();
  const app = useApp();
  const chatCollapsed = !chatOpen;
  const chatId = useId();
  const inbox = useInbox();
  const discoverCount = useWatchCount();
  // The chat is mounted the first time the panel opens and then kept (hidden when collapsed), so a running answer goes on.
  const [chatLoaded, setChatLoaded] = useState(chatOpen);
  useEffect(() => {
    if (chatOpen) setChatLoaded(true);
  }, [chatOpen]);

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
                  {id === 'inbox' && inbox.count > 0 && (
                    <span className="nav-badge" data-testid="inbox-badge" aria-label={t('inbox.badge', { count: inbox.count })}>
                      {inbox.count}
                    </span>
                  )}
                  {id === 'discover' && discoverCount > 0 && (
                    <span className="nav-badge" data-testid="discover-badge" aria-label={t('discover.badge', { count: discoverCount })}>
                      {discoverCount}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <SidebarLanguage />
      </aside>

      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>

      <aside className={chatCollapsed ? 'chat collapsed' : 'chat'} aria-label={t('chat.title')} data-testid="chat-panel">
        <div className="chat-head">
          {!chatCollapsed && <h2>{t('chat.title')}</h2>}
          {!chatCollapsed && (
            <button type="button" className="link chat-palette-button" onClick={() => setPaletteOpen(true)} title={t('chat.paletteShortcut')} data-testid="palette-open">
              {t('chat.palette')}
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-expanded={!chatCollapsed}
            aria-controls={chatId}
            aria-label={chatCollapsed ? t('chat.expand') : t('chat.collapse')}
            title={chatCollapsed ? t('chat.expand') : t('chat.collapse')}
            onClick={() => setChatOpen(!chatOpen)}
            data-testid="chat-toggle"
          >
            <span aria-hidden="true">{chatCollapsed ? '‹' : '›'}</span>
          </button>
        </div>
        <div id={chatId} className="chat-body" hidden={chatCollapsed}>
          {chatLoaded && app.activeProfile ? (
            <Lazy>
              <ChatPanel key={app.activeProfile.id} />
            </Lazy>
          ) : (
            <p className="hint">{app.activeProfile ? t('chat.loading') : t('chat.needsLibrary')}</p>
          )}
        </div>
      </aside>
      {paletteOpen && (
        <Lazy>
          <Palette onClose={() => setPaletteOpen(false)} />
        </Lazy>
      )}

      {exportInit && app.activeProfile && (
        <Lazy>
          <ExportDialog key={app.activeProfile.id} init={exportInit} onClose={closeExport} />
        </Lazy>
      )}

      {inbox.dragging && (
        <div className="drop-hint" data-testid="drop-hint" role="status">
          <p>{t('inbox.dropHint')}</p>
        </div>
      )}
      <StatusBar />
    </div>
  );
}

function SidebarLanguage() {
  const { t } = useTranslation();
  const app = useApp();
  const id = useId();
  return (
    <div className="switcher">
      <label htmlFor={id}>{t('shell.language')}</label>
      <select id={id} value={app.settings?.uiLanguage ?? 'it'} onChange={(e) => void app.setUiLanguage(e.target.value as 'it' | 'en')} data-testid="language-select">
        <option value="it">{t('languages.it')}</option>
        <option value="en">{t('languages.en')}</option>
      </select>
    </div>
  );
}

function LibrarySwitcher({ onNewLibrary }: { onNewLibrary(): void }) {
  const { t } = useTranslation();
  const app = useApp();
  const { reportError } = useNotify();
  const id = useId();
  return (
    <div className="switcher">
      <label htmlFor={id}>{t('shell.activeLibrary')}</label>
      <select id={id} value={app.activeLibraryId ?? ''} onChange={(e) => e.target.value && void app.setActiveLibrary(e.target.value).catch(reportError)} data-testid="library-switcher">
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
  const { status: scan } = useScanStatus();
  return (
    <footer className="statusbar" data-testid="statusbar">
      <span data-testid="status-library">{app.activeProfile ? t('status.library', { name: app.activeProfile.name }) : t('status.noLibrary')}</span>
      {app.config && <span>{t('status.docLanguage', { language: t(`languages.${app.config.language}`) })}</span>}
      {app.config && <span data-testid="status-ai">{aiCount === 0 ? t('status.aiNone') : t('status.aiFolders', { count: aiCount })}</span>}
      {scan && (
        <span data-testid="scan-status" data-state={scan.state} data-phase={scan.phase} role="status" aria-label={t('scan.label')}>
          {scanText(scan, t)}
        </span>
      )}
      <JobIndicator />
      <CitationIndicator />
      <span className="spacer" />
      {app.version && <span>{t('status.version', { version: app.version })}</span>}
    </footer>
  );
}
