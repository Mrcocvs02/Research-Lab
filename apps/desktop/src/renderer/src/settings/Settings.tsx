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
    </div>
  );
}
