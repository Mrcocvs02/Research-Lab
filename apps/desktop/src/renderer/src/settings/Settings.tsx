import { useTranslation } from 'react-i18next';
import { Lazy, lazyView } from '../components/Lazy';
import { LibrariesSection } from './LibrariesSection';
import { LibraryConfigSection } from './LibraryConfigSection';
import { NetworkSection } from './NetworkSection';
import { ProfileSection } from './ProfileSection';
import { SecretsSection } from './SecretsSection';

// The AI settings (and the log viewer) load when the Settings page opens, not with the first screen.
const AiSection = lazyView(() => import('./AiSection').then((m) => ({ default: m.AiSection })), ['aiSettings']);
// Likewise the MCP server settings (and the log of its calls).
const McpSection = lazyView(() => import('./McpSection').then((m) => ({ default: m.McpSection })), ['mcp']);
// Backup and restore, maintenance, and the shortcuts editor (phase 8) load with the page, as their own chunks.
const BackupSection = lazyView(() => import('./BackupSection').then((m) => ({ default: m.BackupSection })), ['backup']);
const MaintenanceSection = lazyView(() => import('./MaintenanceSection').then((m) => ({ default: m.MaintenanceSection })), ['backup']);
const ShortcutsSection = lazyView(() => import('./ShortcutsSection').then((m) => ({ default: m.ShortcutsSection })), ['shortcuts']);

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
      <Lazy>
        <McpSection />
      </Lazy>
      <SecretsSection />
      <Lazy>
        <BackupSection />
      </Lazy>
      <Lazy>
        <ShortcutsSection />
      </Lazy>
      <Lazy>
        <MaintenanceSection />
      </Lazy>
    </div>
  );
}
