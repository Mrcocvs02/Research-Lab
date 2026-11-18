import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../components/IconButton';
import { useAiUi } from '../lib/aiUi';
import { useEffectiveShortcuts } from '../lib/keymap';
import { useNav, type NavLocation, type NavView } from '../lib/nav';
import { ActivityChip } from './ActivityChip';
import { HistoryButtons } from './HistoryButtons';
import type { useScanStatus } from '../views/library/useScanStatus';
import { Icon } from './shellIcons';
import { TopSearch } from './TopSearch';

export interface Crumb {
  label: string;
  /** Where a click goes; the last crumb (the place itself) has none. */
  to?: NavLocation;
}

/** The crumbs of a place (3): `Library › Title`, `To review › New files`, `Settings`. Pure, so it is tested. */
export function crumbsOf(loc: NavLocation, title: string | null, label: (key: string) => string): Crumb[] {
  const view: NavView = loc.view === 'reader' ? 'library' : loc.view;
  const root: Crumb = { label: label(`sections.${view}`) };
  if (loc.view === 'reader') return [{ ...root, to: { view: 'library' } }, { label: title ?? label('shell.crumbReader') }];
  if (loc.view === 'review') return [{ ...root, to: { view: 'review', tab: loc.tab ?? 'files' } }, { label: label(loc.tab === 'proposals' ? 'shell.crumbProposals' : 'shell.crumbFiles') }];
  // Settings: the title is the section; the first crumb is not a link (a click would forget the title).
  if (title) return [view === 'settings' ? root : { ...root, to: { ...loc } }, { label: title }];
  return [root];
}

/** Top bar (4.1, 48 px): Back/Forward, crumbs, search, Undo/Redo/History, Commands, and the Activity chip. */
export function Topbar({ scan }: { scan: ReturnType<typeof useScanStatus> }) {
  const { t } = useTranslation();
  const nav = useNav();
  const { setPaletteOpen } = useAiUi();
  const keys = useEffectiveShortcuts();
  const crumbs = crumbsOf(nav.loc, nav.title, (k) => t(k));
  const cmd = keys['palette.open'];
  return (
    <header className="topbar" data-testid="topbar">
      <IconButton label={t('shell.back')} keys="Alt+←" disabled={!nav.canBack} disabledReason={t('shell.nothingBack')} onClick={nav.back} data-testid="nav-back">
        <Icon name="back" />
      </IconButton>
      <IconButton label={t('shell.forward')} keys="Alt+→" disabled={!nav.canForward} disabledReason={t('shell.nothingForward')} onClick={nav.forward} data-testid="nav-forward">
        <Icon name="forward" />
      </IconButton>
      <nav className="crumbs" aria-label={t('shell.crumbs')} data-testid="crumbs">
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <span className="crumbs__sep" aria-hidden="true">
                ›
              </span>
            )}
            {c.to ? (
              <button type="button" className="crumbs__link" onClick={() => nav.navigate(c.to!)}>
                {c.label}
              </button>
            ) : (
              <span className="crumbs__here" aria-current="page">
                {c.label}
              </span>
            )}
          </Fragment>
        ))}
      </nav>
      <TopSearch />
      <HistoryButtons />
      <button type="button" className="top-cmd" aria-label={t('chat.palette')} title={cmd ? `${t('chat.palette')} (${cmd})` : t('chat.palette')} onClick={() => setPaletteOpen(true)} data-testid="palette-open">
        <Icon name="command" />
        <span className="top-cmd__text">{t('chat.palette')}</span>
      </button>
      <ActivityChip scan={scan} />
    </header>
  );
}
