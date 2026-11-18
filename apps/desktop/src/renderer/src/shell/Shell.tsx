import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Lazy, lazyView } from '../components/Lazy';
import { NoticeBanner } from '../components/NoticeBanner';
import { IconButton } from '../components/IconButton';
import { useAiUi } from '../lib/aiUi';
import { InShellContext } from '../lib/history';
import { useInbox } from '../lib/inbox';
import type { NavView } from '../lib/nav';
import { useNotify } from '../lib/notify';
import { useLocalFlag } from '../lib/useLocalFlag';
import { useApp } from '../state/app-context';
import { useScanStatus } from '../views/library/useScanStatus';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Icon } from './shellIcons';

// The chat and the command palette (and all the AI code with them) load the first time they are shown.
const ChatPanel = lazyView(() => import('../views/chat/ChatPanel').then((m) => ({ default: m.ChatPanel })), ['chat', 'chat-preview']);
const Palette = lazyView(() => import('../views/chat/Palette').then((m) => ({ default: m.Palette })), ['palette']);
// The second-brain export dialog loads when an entry point (project, cluster, selection, palette) opens it.
const ExportDialog = lazyView(() => import('../views/export/ExportDialog').then((m) => ({ default: m.ExportDialog })), ['export']);

// The usage guide and the shortcut list (F1, Ctrl+/) load when first opened.
const GuideDialog = lazyView(() => import('../views/guide/GuideDialog').then((m) => ({ default: m.GuideDialog })), ['guide', 'shortcuts']);

/** The main views of the sidebar, in its order, then Settings (the order of Alt+1..5 and Ctrl+,). */
export const SECTIONS = ['library', 'review', 'projects', 'discover', 'map', 'settings'] as const satisfies readonly NavView[];
export type SectionId = NavView;

interface Props {
  section: SectionId;
  onSection(s: SectionId): void;
  onNewLibrary(): void;
  /** Documents with a proposal of Claude waiting: the dot of "To review". */
  reviewDocs?: number;
  /** The reader is open: the sidebar shrinks to its icons to give it room (the prototype does the same). */
  reading?: boolean;
  /** Optional block above the main area (in the layout flow, never over other controls). */
  banner?: ReactNode;
  children: ReactNode;
}

/** `true` while the window is narrow enough for the Claude panel to float over the content (below 1180 px, D-335). */
const floating = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1179px)').matches === true;

/** Window layout (4.1): sidebar, top bar, banners, the view, and the Claude panel (no space when closed). */
export function Shell({ section, onSection, onNewLibrary, reviewDocs = 0, reading = false, banner, children }: Props) {
  const { t } = useTranslation();
  const { chatOpen, setChatOpen, paletteOpen, setPaletteOpen, exportInit, closeExport, guide, closeGuide } = useAiUi();
  const app = useApp();
  const notify = useNotify();
  const chatId = useId();
  const inbox = useInbox();
  const scan = useScanStatus();
  const [collapsed, setCollapsed] = useLocalFlag('rl.sidebarCollapsed', false);
  const panel = useRef<HTMLElement>(null);
  // The chat is mounted the first time the panel opens and then kept (hidden when closed), so a running answer goes on.
  const [chatLoaded, setChatLoaded] = useState(chatOpen);
  useEffect(() => {
    if (chatOpen) setChatLoaded(true);
  }, [chatOpen]);
  // Toasts belong to the view that made them.
  useEffect(() => notify.setView(section), [notify, section]);

  // Floating Claude panel: Escape or a click outside closes it and the focus goes back to its button.
  useEffect(() => {
    if (!chatOpen) return;
    const close = () => {
      setChatOpen(false);
      document.querySelector<HTMLElement>('[data-testid="chat-toggle"]')?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && floating() && panel.current?.contains(document.activeElement) && !document.querySelector('[role="dialog"][aria-modal="true"]')) close();
    };
    const onDown = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (floating() && el && !panel.current?.contains(el) && !el.closest('[data-testid="chat-toggle"], [role="dialog"], .rl-popover, [data-testid="palette-open"]')) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [chatOpen, setChatOpen]);

  const aiCount = app.config?.aiEnabledFolders.length ?? 0;
  return (
    <InShellContext.Provider value={true}>
      <div className="shell" data-testid="shell" data-collapsed={collapsed || reading ? 'true' : undefined} data-chat={chatOpen ? 'open' : 'closed'}>
        <a className="skip-link" href="#main">
          {t('shell.skip')}
        </a>
        <Sidebar view={section} onSection={onSection} onNewLibrary={onNewLibrary} proposals={reviewDocs} documents={scan.status && app.activeProfile ? scan.status.indexed : null} collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} chatId={chatId} />
        <Topbar scan={scan} />
        <div className="banner-slot" data-testid="banner-slot">
          <NoticeBanner />
          {banner}
        </div>
        <main id="main" className="main" tabIndex={-1}>
          {children}
        </main>

        <aside ref={panel} id={chatId} className="claude-panel" aria-label={t('chat.title')} data-testid="chat-panel" hidden={!chatOpen}>
          <div className="chat-head">
            <span className="chat-head__title">
              <Icon name="claude" className="chat-head__ai" />
              <h2>{t('chat.title')}</h2>
            </span>
            {app.config && (
              <span className="chat-head__status" data-testid="status-ai">
                {aiCount === 0 ? t('status.aiNone') : t('status.aiFolders', { count: aiCount })}
              </span>
            )}
            <IconButton label={t('chat.collapse')} keys="Ctrl+J" size="sm" onClick={() => setChatOpen(false)} data-testid="chat-close">
              <Icon name="close" size={16} />
            </IconButton>
          </div>
          <div className="chat-body">
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

        {guide && (
          <Lazy>
            <GuideDialog kind={guide} onClose={closeGuide} />
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
      </div>
    </InShellContext.Provider>
  );
}
