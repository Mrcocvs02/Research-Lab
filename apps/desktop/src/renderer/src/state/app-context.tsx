import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppSettings, Language, LibraryConfig, LibraryProfile } from '@rl/core';
import i18n from '../i18n';
import { rl } from '../lib/rl';

export interface AppState {
  /** False until the first load finished. */
  ready: boolean;
  /** Set when the first load failed (main process unreachable). */
  loadError: unknown;
  settings: AppSettings | null;
  profiles: LibraryProfile[];
  activeLibraryId: string | null;
  activeProfile: LibraryProfile | null;
  /** library.json of the active library, null when none or unreadable. */
  config: LibraryConfig | null;
  version: string;
  refresh(): Promise<void>;
  setUiLanguage(language: Language): Promise<void>;
  setActiveLibrary(libraryId: string): Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}

function applyLanguage(language: Language): Promise<unknown> {
  document.documentElement.lang = language;
  return i18n.changeLanguage(language);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [profiles, setProfiles] = useState<LibraryProfile[]>([]);
  const [activeLibraryId, setActiveId] = useState<string | null>(null);
  const [config, setConfig] = useState<LibraryConfig | null>(null);
  const [version, setVersion] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([rl.invoke('settings:get', {}), rl.invoke('library:list', {})]);
      setSettings(s);
      setProfiles(list.profiles);
      setActiveId(list.activeLibraryId);
      void applyLanguage(s.uiLanguage);
      if (list.activeLibraryId) {
        setConfig(await rl.invoke('library:getConfig', {}).catch(() => null));
      } else {
        setConfig(null);
      }
      setLoadError(null);
    } catch (e) {
      setLoadError(e);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    rl.invoke('app:info', {}).then(
      (i) => setVersion(i.version),
      () => {},
    );
  }, [refresh]);

  const setUiLanguage = useCallback(async (language: Language) => {
    await applyLanguage(language);
    await rl.invoke('settings:set', { uiLanguage: language });
    setSettings((s) => (s ? { ...s, uiLanguage: language } : s));
  }, []);

  const setActiveLibrary = useCallback(
    async (libraryId: string) => {
      await rl.invoke('library:setActive', { libraryId });
      await refresh();
    },
    [refresh],
  );

  const value = useMemo<AppState>(
    () => ({
      ready,
      loadError,
      settings,
      profiles,
      activeLibraryId,
      activeProfile: profiles.find((p) => p.id === activeLibraryId) ?? null,
      config,
      version,
      refresh,
      setUiLanguage,
      setActiveLibrary,
    }),
    [ready, loadError, settings, profiles, activeLibraryId, config, version, refresh, setUiLanguage, setActiveLibrary],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
