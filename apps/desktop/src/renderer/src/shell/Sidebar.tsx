import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../components/IconButton';
import { Kbd } from '../components/Kbd';
import { Lazy, lazyView } from '../components/Lazy';
import { useAiUi } from '../lib/aiUi';
import { useInbox } from '../lib/inbox';
import { useEffectiveShortcuts } from '../lib/keymap';
import { NAV_ORDER, type NavView } from '../lib/nav';
import { useWatchCount } from '../lib/watch';
import { useApp } from '../state/app-context';
import { libraryTint } from './libraryModel';
import { Icon } from './shellIcons';

// The list of libraries is only needed when the switcher is opened.
const LibraryPopover = lazyView(() => import('./LibraryPopover').then((m) => ({ default: m.LibraryPopover })), []);
const ICON = { library: 'library', review: 'review', projects: 'project', discover: 'discover', map: 'map', settings: 'settings' } as const;
const count = (n: number) => (n > 99 ? '99+' : String(n));
interface Props {
  view: NavView;
  onSection(v: NavView): void;
  onNewLibrary(): void;
  /** Documents with a proposal of Claude waiting (the dot of "To review"). */
  proposals: number;
  /** Documents of the active library when known (from the scan status, no request of its own). */
  documents: number | null;
  collapsed: boolean;
  onToggle(): void;
  chatId: string;
}

/** Sidebar (4.1): library switcher, the five sections in the order of Alt+1..5, then Claude, Help and Settings. */
export function Sidebar({ view, onSection, onNewLibrary, proposals, documents, collapsed, onToggle, chatId }: Props) {
  const { t } = useTranslation();
  const keys = useEffectiveShortcuts();
  const { chatOpen, setChatOpen, openGuide } = useAiUi();
  const inbox = useInbox();
  const discoverCount = useWatchCount();

  const reviewDetail = [inbox.count > 0 ? t('shell.badgeFiles', { count: inbox.count }) : '', proposals > 0 ? t('shell.badgeDocs', { count: proposals }) : ''].filter(Boolean).join(' · ');
  const item = (id: (typeof NAV_ORDER)[number]['id'] | 'nav.settings', v: NavView) => {
    const label = t(`sections.${v}`);
    const detail = v === 'review' ? reviewDetail : v === 'discover' && discoverCount > 0 ? t('discover.badge', { count: discoverCount }) : '';
    const tip = [detail ? `${label}: ${detail}` : label, keys[id]].filter(Boolean).join(' · ');
    return (
      <li key={v}>
        <button
          type="button"
          className="nav-item"
          aria-current={view === v ? 'page' : undefined}
          aria-label={detail ? `${label}: ${detail}` : label}
          title={tip}
          onClick={() => onSection(v)}
          data-testid={`nav-${v}`}
        >
          <Icon name={ICON[v]} />
          <span className="nav-item__label">{label}</span>
          {v === 'review' && inbox.count > 0 && (
            <span className="rl-badge rl-badge--count nav-badge" data-testid="inbox-badge">
              {count(inbox.count)}
            </span>
          )}
          {v === 'review' && proposals > 0 && <span className="nav-dot" data-testid="review-dot" aria-hidden="true" />}
          {v === 'discover' && discoverCount > 0 && (
            <span className="rl-badge rl-badge--count nav-badge" data-testid="discover-badge" aria-label={t('discover.badge', { count: discoverCount })}>
              {count(discoverCount)}
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <aside className="app-sidebar" aria-label={t('shell.sidebar')}>
      <div className="sidebar-head">
        <div className="brand" data-testid="app-title">
          <span className="brand__logo" aria-hidden="true">
            <Icon name="library" size={16} />
          </span>
          <span className="brand__name">{t('app.title')}</span>
        </div>
        <IconButton label={collapsed ? t('shell.expand') : t('shell.collapse')} pressed={collapsed} onClick={onToggle} data-testid="sidebar-toggle" className="sidebar-toggle">
          <Icon name="sidebar" />
        </IconButton>
      </div>
      <LibrarySwitcher onNewLibrary={onNewLibrary} documents={documents} />
      <nav aria-label={t('shell.navigation')}>
        <ul>{NAV_ORDER.map((n) => item(n.id, n.view))}</ul>
      </nav>
      <div className="sidebar-foot">
        <ul>
          <li>
            <button
              type="button"
              className="nav-item"
              aria-expanded={chatOpen}
              aria-controls={chatId}
              aria-label={t('chat.title')}
              title={`${chatOpen ? t('chat.collapse') : t('chat.expand')} · ${keys['chat.toggle'] ?? ''}`}
              onClick={() => setChatOpen(!chatOpen)}
              data-testid="chat-toggle"
            >
              <Icon name="claude" className="nav-item__ai" />
              <span className="nav-item__label">{t('chat.title')}</span>
              {keys['chat.toggle'] && <Kbd className="nav-item__keys">{keys['chat.toggle']}</Kbd>}
            </button>
          </li>
          <li>
            <button type="button" className="nav-item" aria-label={t('shell.help')} title={`${t('shell.help')} · ${keys['guide.open'] ?? ''}`} onClick={() => openGuide('guide')} data-testid="nav-help">
              <Icon name="help" />
              <span className="nav-item__label">{t('shell.help')}</span>
              {keys['guide.open'] && <Kbd className="nav-item__keys">{keys['guide.open']}</Kbd>}
            </button>
          </li>
          {item('nav.settings', 'settings')}
        </ul>
      </div>
    </aside>
  );
}

function LibrarySwitcher({ onNewLibrary, documents }: { onNewLibrary(): void; documents: number | null }) {
  const { t } = useTranslation();
  const app = useApp();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const active = app.activeProfile;
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="lib-switch"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('shell.activeLibrary')}
        title={active ? `${t('shell.activeLibrary')}: ${active.name}` : t('shell.noLibrary')}
        onClick={() => setOpen(!open)}
        data-testid="library-switcher"
        data-library-id={app.activeLibraryId ?? ''}
      >
        <span className="lib-switch__sq" style={{ background: `var(--lib-${libraryTint(active?.name ?? '')})` }} aria-hidden="true" />
        <span className="lib-switch__text">
          <b data-testid="status-library">{active ? active.name : t('shell.noLibrary')}</b>
          {active && documents !== null && <small>{t('shell.documents', { count: documents })}</small>}
        </span>
        <Icon name="chevron" size={16} className="lib-switch__chev" />
      </button>
      {open && (
        <Lazy>
          <LibraryPopover anchor={anchor} onClose={() => setOpen(false)} onNewLibrary={onNewLibrary} />
        </Lazy>
      )}
    </>
  );
}
