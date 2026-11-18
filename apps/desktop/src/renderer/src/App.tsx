import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary, Lazy, lazyView } from './components/Lazy';
import { loadStrings } from './i18n';
import { ErrorNote } from './components/ui';
import { errorMessage } from './lib/errors';
import { installWindowGuard } from './lib/dirtyEditors';
import { AiUiProvider, useAiUi } from './lib/aiUi';
import { LibraryEventsProvider } from './lib/events';
import { KeymapProvider } from './lib/keymap';
import { NavProvider, useNav } from './lib/nav';
import { CitationJobsProvider } from './lib/citationJobs';
import { HistoryProvider } from './lib/history';
import { InboxProvider, useInbox } from './lib/inbox';
import { JobsProvider } from './lib/jobs';
import { NotifyProvider } from './lib/notify';
import { ReaderProvider, useReader } from './lib/reader';
import { WatchProvider } from './lib/watch';
import { Shell, type SectionId } from './shell/Shell';
import { useReviewDocs } from './shell/useReviewDocs';
import { AppProvider, useApp } from './state/app-context';

// No view is part of the first chunk (docs/RULES.md, lightness). The Library is the first screen: it starts loading with the app (see `App`).
const LibraryView = lazyView(() => import('./views/library/LibraryView').then((m) => ({ default: m.LibraryView })), ['library']);
const Settings = lazyView(() => import('./settings/Settings').then((m) => ({ default: m.Settings })), ['settings', 'settings-wizard']);
const ProjectsView = lazyView(() => import('./views/projects/ProjectsView').then((m) => ({ default: m.ProjectsView })), ['doc-projects-reader', 'projects']);
// The reader (and pdf.js with it) loads the first time a document is opened in it.
const ReaderView = lazyView(() => import('./views/reader/ReaderView').then((m) => ({ default: m.ReaderView })), ['doc-projects-reader', 'doc-reader', 'reader']);
const InboxView = lazyView(() => import('./views/inbox/InboxView').then((m) => ({ default: m.InboxView })), ['inbox']);
const DiscoverView = lazyView(() => import('./views/discover/DiscoverView').then((m) => ({ default: m.DiscoverView })), ['discover']);
const NetworkView = lazyView(() => import('./views/network/NetworkView').then((m) => ({ default: m.NetworkView })), ['network']);
// The welcome card of the first open after the wizard (D-262).
const WelcomeCard = lazyView(() => import('./views/guide/WelcomeCard').then((m) => ({ default: m.WelcomeCard })), ['guide']);
const Wizard = lazyView(() => import('./wizard/Wizard').then((m) => ({ default: m.Wizard })), ['settings-wizard', 'wizard']);

export function App() {
  // The Library chunk and its strings are fetched at once, while the app reads its settings: the first screen waits for neither alone.
  useEffect(() => {
    void import('./views/library/LibraryView').catch(() => {});
    void loadStrings(['library']).catch(() => {});
  }, []);
  return (
    <ErrorBoundary>
      <AppProvider>
        <KeymapProvider>
        <NavProvider>
        <LibraryEventsProvider>
          <NotifyProvider>
            <HistoryProvider>
              <ReaderProvider>
                <AiUiProvider>
                  <JobsProvider>
                    <InboxProvider>
                      <CitationJobsProvider>
                        <WatchProvider>
                          <Root />
                        </WatchProvider>
                      </CitationJobsProvider>
                    </InboxProvider>
                  </JobsProvider>
                </AiUiProvider>
              </ReaderProvider>
            </HistoryProvider>
          </NotifyProvider>
        </LibraryEventsProvider>
        </NavProvider>
        </KeymapProvider>
      </AppProvider>
    </ErrorBoundary>
  );
}

function Root() {
  const { t } = useTranslation();
  const app = useApp();
  const nav = useNav();
  const [wizardOpen, setWizardOpen] = useState(false);
  const reader = useReader();
  const { navigation } = useAiUi();
  const inbox = useInbox();
  const proposals = useReviewDocs();
  // A document id belongs to one library: the reader does not outlive a switch, and the places of the history either.
  // The unsaved notes were already saved before the switch (`setActiveLibrary`, the library list, the wizard), so by now
  // there is nothing left to wait for.
  const libraryId = app.activeLibraryId;
  const { closeReader, dropReader, openReader } = reader;
  const { navigate, reset } = nav;
  const first = useRef(true);
  useEffect(() => {
    dropReader();
    if (first.current) first.current = false;
    else reset();
  }, [libraryId, dropReader, reset]);

  // "To review" opens on the tab that has something to decide: new files first.
  const reviewTab = inbox.count > 0 || proposals === 0 ? 'files' : 'proposals';
  const section = nav.view;
  const go = (v: SectionId) => navigate(v === 'review' ? { view: 'review', tab: reviewTab } : { view: v });

  // A link of the chat to a project or to the settings, and a request of the palette or a shortcut, move the window here.
  const navNonce = navigation?.nonce;
  useEffect(() => {
    if (!navigation) return;
    if (navigation.to === 'newLibrary') {
      setWizardOpen(true);
      return;
    }
    const to = navigation.to;
    navigate(
      to === 'settings'
        ? { view: 'settings' }
        : to === 'project' || to === 'projects'
          ? { view: 'projects', ...(navigation.projectId ? { projectId: navigation.projectId } : {}) }
          : to === 'network' || to === 'map'
            ? { view: 'map' }
            : to === 'discover'
              ? { view: 'discover' }
              : to === 'library'
                ? { view: 'library' }
                : { view: 'review', tab: to === 'inbox' ? 'files' : (navigation.tab ?? reviewTab) },
    );
    // The focus target exists once the view is drawn.
    if (navigation.focus === 'search') setTimeout(() => document.querySelector<HTMLInputElement>('[data-testid="search-input"]')?.focus(), 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navNonce]);

  // The reader and the history. A document opened from anywhere is a place (`reader`); Back and Forward reopen or close the
  // reader to match the place they land on. Only a change of place moves the reader, so opening it never closes it.
  const readerNonce = reader.target?.nonce;
  useEffect(() => {
    const target = reader.target;
    if (target) navigate({ view: 'reader', docId: target.docId, ...(target.page !== undefined ? { page: target.page } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readerNonce]);
  const placeKey = JSON.stringify(nav.loc);
  useEffect(() => {
    const loc = nav.loc;
    if (loc.view === 'reader' && loc.docId) {
      if (reader.target?.docId !== loc.docId) openReader(loc.docId, loc.page);
    } else if (reader.target) closeReader();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey]);
  // Closing the window waits for unsaved notes (only while there are any).
  useEffect(() => installWindowGuard(), []);

  if (!app.ready) {
    return (
      <p className="boot" role="status">
        {t('common.loading', { defaultValue: '' })}
      </p>
    );
  }
  if (app.loadError) {
    return (
      <div className="boot">
        <ErrorNote>{errorMessage(app.loadError, t)}</ErrorNote>
        <button type="button" onClick={() => void app.refresh()}>
          {t('common.retry')}
        </button>
      </div>
    );
  }

  const hasLibraries = app.profiles.length > 0;
  const showWizard = !hasLibraries || wizardOpen;

  const finished = async () => {
    await app.refresh();
    setWizardOpen(false);
    navigate({ view: 'library' });
  };

  const showWelcome = hasLibraries && !showWizard && app.settings !== null && app.settings.firstRunDone && !app.settings.guide?.welcomeSeen;
  const readerOpen = reader.target !== null && section === 'library' && app.activeProfile !== null && !showWizard;

  return (
    <>
      <Shell
        section={section}
        onSection={go}
        onNewLibrary={() => setWizardOpen(true)}
        reviewDocs={proposals}
        banner={
          showWelcome && !wizardOpen ? (
            <Lazy>
              <WelcomeCard />
            </Lazy>
          ) : null
        }
      >
        <Lazy>
        {section === 'settings' ? (
          <Settings onNewLibrary={() => setWizardOpen(true)} />
        ) : section === 'library' && app.activeProfile && !showWizard ? (
          // Kept mounted (only hidden) while the reader is open, so closing it returns to the same list and selection.
          <div className="keep-alive" hidden={readerOpen}>
            <LibraryView key={app.activeProfile.id} />
          </div>
        ) : section === 'projects' && app.activeProfile && !showWizard ? (
          <ProjectsView key={app.activeProfile.id} />
        ) : section === 'discover' && app.activeProfile && !showWizard ? (
          <DiscoverView key={app.activeProfile.id} />
        ) : section === 'map' && app.activeProfile && !showWizard ? (
          <NetworkView key={app.activeProfile.id} />
        ) : section === 'review' && app.activeProfile && !showWizard ? (
          <InboxView key={app.activeProfile.id} tab={nav.loc.tab === 'proposals' ? 'proposals' : 'arrivals'} onTab={(tab) => navigate({ view: 'review', tab: tab === 'proposals' ? 'proposals' : 'files' }, { replace: true })} />
        ) : (
          <Placeholder section={section} />
        )}
        </Lazy>
        {readerOpen && reader.target && (
          <Lazy>
            <ReaderView key={reader.target.docId} target={reader.target} onClose={() => navigate({ view: 'library' })} />
          </Lazy>
        )}
      </Shell>
      {showWizard && (
        <Lazy>
          <Wizard key={wizardOpen ? 'new' : 'first'} onFinished={() => void finished()} onCancel={hasLibraries ? () => setWizardOpen(false) : undefined} />
        </Lazy>
      )}
    </>
  );
}

function Placeholder({ section }: { section: Exclude<SectionId, 'settings'> }) {
  const { t } = useTranslation();
  const app = useApp();
  return (
    <div className="view" data-testid={`section-${section}`}>
      <h1>{t(`sections.${section}`)}</h1>
      {section === 'library' && !app.activeProfile ? <p data-testid="shell-empty">{t('shell.empty')}</p> : <p>{t(`placeholders.${section === 'review' ? 'inbox' : section === 'map' ? 'network' : section}`)}</p>}
      {section === 'library' && app.activeProfile && (
        <p className="callout" data-testid="active-library-note">
          {t('placeholders.libraryActive', { name: app.activeProfile.name })}
        </p>
      )}
    </div>
  );
}
