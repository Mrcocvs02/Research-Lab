import { useTranslation } from 'react-i18next';
import { Lazy, lazyRetry } from '../components/Lazy';
import { LibrariesSection } from './LibrariesSection';
import { LibraryConfigSection } from './LibraryConfigSection';
import { NetworkSection } from './NetworkSection';
import { ProfileSection } from './ProfileSection';
import { SecretsSection } from './SecretsSection';

// The AI settings (and the log viewer) load when the Settings page opens, not with the first screen.
const AiSection = lazyRetry(() => import('./AiSection').then((m) => ({ default: m.AiSection })));

/** All settings in one scrollable page. */
export function Settings({ onNewLibrary }: { onNewLibrary: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="page" data-testid="settings-page">
      <h1>{t('sections.settings')}</h1>
      <ProfileSection />
      <LibrariesSection onNew={onNewLibrary} />
      <LibraryConfigSection />
      <NetworkSection />
      <Lazy>
        <AiSection />
      </Lazy>
      <SecretsSection />
    </div>
  );
}
