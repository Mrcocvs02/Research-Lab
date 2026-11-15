import { useTranslation } from 'react-i18next';
import { LibrariesSection } from './LibrariesSection';
import { LibraryConfigSection } from './LibraryConfigSection';
import { ProfileSection } from './ProfileSection';
import { SecretsSection } from './SecretsSection';

/** All settings in one scrollable page. */
export function Settings({ onNewLibrary }: { onNewLibrary: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="page" data-testid="settings-page">
      <h1>{t('sections.settings')}</h1>
      <ProfileSection />
      <LibrariesSection onNew={onNewLibrary} />
      <LibraryConfigSection />
      <SecretsSection />
    </div>
  );
}
