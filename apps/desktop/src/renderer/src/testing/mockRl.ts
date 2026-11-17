import { AppError, defaultAppSettings, type AppSettings, type LibraryProfile } from '@rl/core';

type Handler = (payload: any) => unknown;

export const calls: Array<{ channel: string; payload: unknown }> = [];
let handlers: Record<string, Handler> = {};
const listeners = new Map<string, Set<(payload: unknown) => void>>();

/** Replaces the channel handlers and clears the call log and event listeners. */
export function setHandlers(next: Record<string, Handler>): void {
  handlers = next;
  calls.length = 0;
  listeners.clear();
}

export function emitEvent(name: string, payload: unknown): void {
  for (const l of listeners.get(name) ?? []) l(payload);
}

export const callsTo = (channel: string) => calls.filter((c) => c.channel === channel).map((c) => c.payload as any);

/** Stand-in for `../lib/rl`: same shape, no Electron. */
export const rlModule = {
  rl: {
    invoke: async (channel: string, payload: unknown) => {
      calls.push({ channel, payload });
      const h = handlers[channel];
      if (!h) throw new AppError('NOT_FOUND', `no mock handler for ${channel}`);
      return h(payload);
    },
    on: (event: string, cb: (payload: unknown) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(cb);
      listeners.set(event, set);
      return () => set.delete(cb);
    },
  },
};

/** A small in-memory main process: settings and library list, enough for the shell and the wizard. */
export function memoryBackend(init: { settings?: Partial<AppSettings>; profiles?: LibraryProfile[] } = {}) {
  const state = {
    settings: { ...defaultAppSettings(), uiLanguage: 'en', ...init.settings } as AppSettings,
    profiles: init.profiles ?? [],
    active: init.profiles?.[0]?.id ?? (null as string | null),
  };
  const handlers: Record<string, Handler> = {
    'app:info': () => ({ name: 'Research Lab', version: '0.0.0', platform: 'test', electron: 'x' }),
    'settings:get': () => ({ ...state.settings, libraries: state.profiles, activeLibraryId: state.active }),
    'settings:set': (p: any) => {
      if (p.uiLanguage) state.settings.uiLanguage = p.uiLanguage;
      if (p.firstRunDone !== undefined) state.settings.firstRunDone = p.firstRunDone;
      if (p.user) state.settings.user = { ...state.settings.user, ...p.user };
      if (p.appearance) state.settings.appearance = { ...state.settings.appearance, ...p.appearance };
      if (p.shortcuts) state.settings.shortcuts = p.shortcuts;
      if (p.guide) state.settings.guide = { ...state.settings.guide, ...p.guide };
      if (p.network) state.settings.network = { ...state.settings.network, ...p.network };
      return { ...state.settings, libraries: state.profiles, activeLibraryId: state.active };
    },
    'library:list': () => ({ profiles: state.profiles, activeLibraryId: state.active }),
    'library:setActive': (p: any) => {
      state.active = p.libraryId;
      return { activeLibraryId: p.libraryId };
    },
    'library:getConfig': () => {
      throw new AppError('NOT_FOUND', 'none');
    },
    'library:create': (p: any) => {
      const profile: LibraryProfile = { id: 'lib-test', name: p.name, rootPath: p.rootPath, dataDirName: p.dataDirName ?? '.lab', createdAt: '2026-01-01T00:00:00.000Z' };
      state.profiles.push(profile);
      state.active ??= profile.id;
      return profile;
    },
    'library:listFolders': () => ({ folders: [] }),
  };
  return { state, handlers };
}
