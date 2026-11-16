import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary, Lazy, lazyRetry } from './components/Lazy';
import { NoticeBanner } from './components/NoticeBanner';
import { ErrorNote } from './components/ui';
import { errorMessage } from './lib/errors';
import { installWindowGuard } from './lib/dirtyEditors';
import { AiUiProvider, useAiUi } from './lib/aiUi';
import { LibraryEventsProvider } from './lib/events';
import { HistoryProvider } from './lib/history';
import { NotifyProvider } from './lib/notify';
import { ReaderProvider, useReader } from './lib/reader';
import { LibraryView } from './views/library/LibraryView';
import { Shell, type SectionId } from './shell/Shell';
import { AppProvider, useApp } from './state/app-context';

// Only the Library view is part of the first screen; the others load when they are opened (docs/RULES.md, lightness).
const Settings = lazyRetry(() => import('./settings/Settings').then((m) => ({ default: m.Settings })));
const ProjectsView = lazyRetry(() => import('./views/projects/ProjectsView').then((m) => ({ default: m.ProjectsView })));
// The reader (and pdf.js with it) loads the first time a document is opened in it.
const ReaderView = lazyRetry(() => import('./views/reader/ReaderView').then((m) => ({ default: m.ReaderView })));
const Wizard = lazyRetry(() => import('./wizard/Wizard').then((m) => ({ default: m.Wizard })));

export function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <LibraryEventsProvider>
          <NotifyProvider>
            <HistoryProvider>
              <ReaderProvider>
                <AiUiProvider>
                  <Root />
                </AiUiProvider>
              </ReaderProvider>
            </HistoryProvider>
          </NotifyProvider>
        </LibraryEventsProvider>
      </AppProvider>
    </ErrorBoundary>
  );
}

function Root() {
  const { t } = useTranslation();
  const app = useApp();
  const [section, setSection] = useState<SectionId>('library');
  const [wizardOpen, setWizardOpen] = useState(false);
  const reader = useReader();
  const { navigation } = useAiUi();
  // A document id belongs to one library: the reader does not outlive a switch. The unsaved notes were already saved
  // before the switch (`setActiveLibrary`, the library list, the wizard), so by now there is nothing left to wait for.
  const libraryId = app.activeLibraryId;
  const { closeReader, dropReader } = reader;
  useEffect(() => dropReader(), [libraryId, dropReader]);
  // A link of the chat to a project or to the settings, and a document opened from anywhere (the chat, say), show their section.
  const navNonce = navigation?.nonce;
  useEffect(() => {
    if (!navigation) return;
    closeReader();
    setSection(navigation.to === 'settings' ? 'settings' : 'projects');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navNonce]);
  const readerNonce = reader.target?.nonce;
  useEffect(() => {
    if (reader.target) setSection('library');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readerNonce]);
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
    setSection('library');
  };

  const readerOpen = reader.target !== null && section === 'library' && app.activeProfile !== null && !showWizard;

  return (
    <>
      <NoticeBanner />
      <Shell
        section={section}
        onSection={(s) => {
          closeReader();
          setSection(s);
        }}
        onNewLibrary={() => setWizardOpen(true)}
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
        ) : (
          <Placeholder section={section} />
        )}
        </Lazy>
        {readerOpen && reader.target && (
          <Lazy>
            <ReaderView key={reader.target.docId} target={reader.target} onClose={closeReader} />
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
    <div className="page" data-testid={`section-${section}`}>
      <h1>{t(`sections.${section}`)}</h1>
      {section === 'library' && !app.activeProfile ? <p data-testid="shell-empty">{t('shell.empty')}</p> : <p>{t(`placeholders.${section}`)}</p>}
      {section === 'library' && app.activeProfile && (
        <p className="callout" data-testid="active-library-note">
          {t('placeholders.libraryActive', { name: app.activeProfile.name })}
        </p>
      )}
    </div>
  );
}
