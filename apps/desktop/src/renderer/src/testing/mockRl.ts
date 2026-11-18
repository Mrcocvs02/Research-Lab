import { AppError, defaultAppSettings, effectiveShortcuts, findShortcutConflicts, type AiAccount, type AppSettings, type BackupInfo, type LibraryProfile, type ScanReport } from '@rl/core';

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
    backup: {
      destination: '/tmp/backups' as string | null,
      auto: 'off' as 'off' | 'daily' | 'weekly' | 'monthly',
      keep: 5,
      lastBackupAt: null as string | null,
      lastAutoError: null as string | null,
      items: [] as BackupInfo[],
      /** Refusal at start time (`details.reason`, plus `needed`/`free`) for the next create / verify / restore, or null. */
      startRefusal: null as { code?: 'CONFLICT' | 'INVALID_REQUEST'; reason: string; needed?: number; free?: number } | null,
      /** Error of the finished job (`{ code, message, reason }`), or null for a job that ends well. */
      jobError: null as { code: string; message: string; reason: string } | null,
      /** Fields of a finished job's result (`skipped`, `resetOnRestore`, `secretsToEnter`, ...). */
      resultExtra: {} as Record<string, unknown>,
    },
    /** The Claude account the card shows (`ai:account`): a logged-in Claude Code with a known identity. Tests edit it. */
    claudeCode: { loggedIn: true as boolean | null, account: { email: 'user@example.test', organization: 'Example Org', plan: 'pro' } as AiAccount['claudeCode']['account'], supportsAuthCommands: true, path: '/tmp/claude' as string | null },
    apiKeyStored: false,
    test: { ok: true, ms: 1200, model: 'claude-haiku-5-5', usd: 0.001 as number | null, error: undefined as { code: string } | undefined },
    scanReport: { finishedAt: null, summary: null, firstScan: false, added: [], changed: [], moved: [], missing: [], failed: [], truncated: false } as ScanReport,
    report: { documents: 0, dataBytes: 0, local: { index: 0, cache: 0, thumbs: 0, graph: 0, chats: 0, backups: 0 }, logsBytes: 0, process: { rssMb: 100, heapMb: 20, uptimeSec: 1, startupMs: 400 }, workers: 0 },
  };
  const jobs = new Map<string, Record<string, unknown>>();
  const startJob = (kind: 'create' | 'verify' | 'restore', extra: Record<string, unknown> = {}) => {
    const r = state.backup.startRefusal;
    if (r) throw new AppError(r.code ?? 'CONFLICT', `${r.reason}: refused`, { reason: r.reason, ...(r.needed !== undefined ? { needed: r.needed } : {}), ...(r.free !== undefined ? { free: r.free } : {}) });
    const jobId = `job-${jobs.size + 1}`;
    const e = state.backup.jobError;
    const result = { file: '/tmp/backups/x.rlbackup', bytes: 4096, files: 40, problemCount: 0, problems: [], restoredLibraryId: null, settingsRestored: false, secretsToEnter: [], ...extra, ...state.backup.resultExtra };
    jobs.set(jobId, { jobId, kind, state: e ? 'failed' : 'done', phase: e ? 'verify' : 'done', done: 0, total: 0, result: e ? null : result, error: e });
    return { jobId };
  };
  const backupSettings = () => ({ destination: state.backup.destination, auto: state.backup.auto, keep: state.backup.keep, lastBackupAt: state.backup.lastBackupAt, lastAutoError: state.backup.lastAutoError });
  const accountView = (): AiAccount => {
    const c = state.claudeCode;
    const mode = state.settings.ai.authMode;
    const key = state.apiKeyStored && mode !== 'claude-code';
    return {
      authMode: mode,
      effective: key ? 'api-key' : mode !== 'api-key' && c.loggedIn ? 'claude-code' : 'none',
      apiKey: { stored: state.apiKeyStored, envVar: false },
      claudeCode: { path: c.path, source: c.path ? 'path' : 'none', version: c.path ? '2.1.0' : null, loggedIn: c.loggedIn, account: c.loggedIn ? c.account : null, supportsAuthCommands: c.supportsAuthCommands },
    };
  };
  const handlers: Record<string, Handler> = {
    'app:info': () => ({ name: 'Research Lab', version: '0.0.0', platform: 'test', electron: 'x' }),
    'settings:get': () => ({ ...state.settings, libraries: state.profiles, activeLibraryId: state.active }),
    'settings:set': (p: any) => {
      if (p.uiLanguage) state.settings.uiLanguage = p.uiLanguage;
      if (p.firstRunDone !== undefined) state.settings.firstRunDone = p.firstRunDone;
      if (p.user) state.settings.user = { ...state.settings.user, ...p.user };
      if (p.appearance) state.settings.appearance = { ...state.settings.appearance, ...p.appearance };
      if (p.shortcuts) {
        // Same check as main: two commands on one key are refused, naming them (details.conflicts).
        const conflicts = findShortcutConflicts(effectiveShortcuts(p.shortcuts));
        if (conflicts.length > 0) throw new AppError('INVALID_REQUEST', 'Two shortcuts share a key', { reason: 'shortcut-conflict', conflicts });
        state.settings.shortcuts = p.shortcuts;
      }
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
    'backup:settings': backupSettings,
    'backup:configure': (p: any) => {
      if (p.auto) state.backup.auto = p.auto;
      if (p.keep) state.backup.keep = p.keep;
      if (p.clearDestination) state.backup.destination = null;
      return backupSettings();
    },
    'backup:chooseDestination': () => backupSettings(),
    'backup:preview': () => ({ dataFiles: 0, dataBytes: 0, localFiles: 0, localBytes: 0, freeBytes: null }),
    'backup:list': () => ({ items: state.backup.items }),
    'backup:inspect': (p: any) => {
      const found = state.backup.items.find((i) => i.file === p.file);
      if (!found) throw new AppError('INVALID_REQUEST', 'file-not-listed: not listed', { reason: 'file-not-listed' });
      return found;
    },
    'backup:create': () => startJob('create'),
    'backup:verify': () => startJob('verify'),
    'backup:restore': () => startJob('restore', { restoredLibraryId: 'lib-restored', secretsToEnter: [] }),
    'backup:status': (p: any) => {
      const j = jobs.get(p.jobId);
      if (!j) throw new AppError('NOT_FOUND', 'no such job');
      return j;
    },
    'backup:cancel': () => ({ cancelled: true }),
    'backup:reveal': () => ({ ok: true }),
    'backup:remove': (p: any) => {
      state.backup.items = state.backup.items.filter((i) => i.file !== p.file);
      return { ok: true };
    },
    'ai:account': accountView,
    'ai:setAuthMode': (p: any) => {
      state.settings.ai = { ...state.settings.ai, authMode: p.mode };
      return accountView();
    },
    'ai:login': () => ({ started: true }),
    'ai:loginDone': accountView,
    'ai:logout': () => {
      state.claudeCode.loggedIn = false;
      return accountView();
    },
    'ai:test': () => ({ ...state.test }),
    'ai:usageAll': () => ({ totalUsd: 0, sends: 0, libraries: state.profiles.map((p) => ({ libraryId: p.id, usd: 0, reachable: true })) }),
    'scan:report': () => state.scanReport,
    'maintenance:report': () => state.report,
    'maintenance:clean': () => ({ freedBytes: 0 }),
    'maintenance:openLogs': () => ({ ok: true }),
    'maintenance:copyDiagnostics': () => ({ text: 'app 0.0.0' }),
  };
  return { state, handlers };
}
