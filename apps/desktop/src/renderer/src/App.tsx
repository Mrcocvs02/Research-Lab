import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary, Lazy, lazyRetry } from './components/Lazy';
import { NoticeBanner } from './components/NoticeBanner';
import { ErrorNote } from './components/ui';
import { errorMessage } from './lib/errors';
import { LibraryEventsProvider } from './lib/events';
import { HistoryProvider } from './lib/history';
import { NotifyProvider } from './lib/notify';
import { LibraryView } from './views/library/LibraryView';
import { Shell, type SectionId } from './shell/Shell';
import { AppProvider, useApp } from './state/app-context';

// Only the Library view is part of the first screen; the others load when they are opened (docs/RULES.md, lightness).
const Settings = lazyRetry(() => import('./settings/Settings').then((m) => ({ default: m.Settings })));
const ProjectsView = lazyRetry(() => import('./views/projects/ProjectsView').then((m) => ({ default: m.ProjectsView })));
const Wizard = lazyRetry(() => import('./wizard/Wizard').then((m) => ({ default: m.Wizard })));

export function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <LibraryEventsProvider>
          <NotifyProvider>
            <HistoryProvider>
              <Root />
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

  return (
    <>
      <NoticeBanner />
      <Shell section={section} onSection={setSection} onNewLibrary={() => setWizardOpen(true)}>
        <Lazy>
        {section === 'settings' ? (
          <Settings onNewLibrary={() => setWizardOpen(true)} />
        ) : section === 'library' && app.activeProfile && !showWizard ? (
          <LibraryView key={app.activeProfile.id} />
        ) : section === 'projects' && app.activeProfile && !showWizard ? (
          <ProjectsView key={app.activeProfile.id} />
        ) : (
          <Placeholder section={section} />
        )}
        </Lazy>
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
