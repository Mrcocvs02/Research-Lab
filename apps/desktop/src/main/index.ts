import { app, BrowserWindow, dialog, ipcMain, nativeImage, net, safeStorage, session, shell } from 'electron';
import path from 'node:path';
import { backupDataDir, createLegacyImporter, createLibraryStore, createWatcher } from '@rl/data';
import { createSearchIndex } from '@rl/search';
import {
  AppError,
  createDispatcher,
  events,
  IPC_EVENT_CHANNEL,
  IPC_INVOKE_CHANNEL,
  channels,
  type DocumentId,
  type EventName,
} from '@rl/core';
import { createFileLogger } from '@rl/core/node';
import { APP_NAME } from './app-info.js';
import { createDocHandler } from './doc-protocol.js';
import { createThumbHandler } from './thumb-protocol.js';
import { thumbDir } from './thumbs.js';
import { ApprovedPaths } from './approved-paths.js';
import { e2eDialogOverride } from './dialog-override.js';
import { resolveAppDirs } from './dirs.js';
import { presentPdf } from './ipc/handlers/doc-files.js';
import { buildHandlers, type MainServices } from './ipc/handlers/index.js';
import { createProviderFactory } from './ai/provider-factory.js';
import { abortAllChatTurns } from './ai/service.js';
import { abortAllJobs } from './ai/jobs.js';
import { createBackupPolicy } from './library/backup-policy.js';
import { RuntimeManager } from './library/runtime-manager.js';
import { spawnScanWorker, watchdogFromEnv } from './library/worker-host.js';
import { LibraryService } from './library-service.js';
import { applyResourceSwitches } from './resources.js';
import { configureRuntime, resolveRuntimeConfig } from './runtime.js';
import { FileSecretStore } from './secret-store.js';
import { installGlobalSecurity, isTrustedUrl, registerPrivilegedSchemes, rendererOrigin, serveDocuments, serveRenderer, serveThumbnails } from './security.js';
import { SettingsStore } from './settings-store.js';
import { createMainWindow } from './window.js';

// Name and paths must be fixed before `ready`. Env overrides keep tests off real data, but only in a
// development run: the installed app (`app.isPackaged`) ignores every RL_* / ELECTRON_RENDERER_URL variable.
app.setName(APP_NAME);
applyResourceSwitches(app.commandLine);
const runtime = configureRuntime(resolveRuntimeConfig(process.env, app.isPackaged));
const dirs = resolveAppDirs(process.env, { userData: app.getPath('userData') }, app.isPackaged);
app.setPath('userData', dirs.userData);
app.setPath('sessionData', path.join(dirs.localData, 'session'));
registerPrivilegedSchemes();

const log = createFileLogger({ dir: path.join(dirs.localData, 'logs'), name: 'main', console: !app.isPackaged });
for (const warning of runtime.warnings) log.warn(warning);

function emit<K extends EventName>(event: K, payload: unknown): void {
  const parsed = events[event].safeParse(payload);
  if (!parsed.success) {
    log.error('invalid event payload', { event });
    return;
  }
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC_EVENT_CHANNEL, event, parsed.data);
}

async function main(): Promise<void> {
  await app.whenReady();
  installGlobalSecurity();
  if (!runtime.rendererDevUrl) {
    serveRenderer(session.defaultSession, path.join(import.meta.dirname, '../renderer'));
  }

  const settings = SettingsStore.forDir(dirs.userData, log);
  const approved = new ApprovedPaths();
  const secrets = new FileSecretStore(dirs.userData, {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data),
  });
  const libraries = new LibraryService(settings, approved, secrets);
  // At most one backup per library per day, the last five kept (D-074); an import asks for its own (force).
  const backupPolicy = createBackupPolicy({ backup: (dataDir, root) => backupDataDir(dataDir, root), backupsDir: path.join(dirs.localData, 'backups') });
  const backupLibraryData = (libraryId: string, dataDir: string) => backupPolicy(libraryId, dataDir);
  // Scan, text extraction and index writes run in a worker thread (bundled next to this file, see electron.vite.config.ts).
  const runtimeManager = new RuntimeManager({
    libraries,
    settings,
    localDataDir: dirs.localData,
    // Windows and macOS have a shell thumbnail API (the PDF app's handler plus the system cache); elsewhere the renderer draws.
    ...(typeof nativeImage.createThumbnailFromPath === 'function' && (process.platform === 'win32' || process.platform === 'darwin')
      ? { nativeThumbnail: (abs: string, size: number) => nativeImage.createThumbnailFromPath(abs, { width: size, height: size }) }
      : {}),
    log,
    emit: (status) => emit('scan:progress', status),
    emitDocumentsChanged: () => emit('library:changed', { kind: 'documents' }),
    emitProjectsChanged: (ids) => emit('library:changed', ids.length <= 500 ? { kind: 'projects', ids } : { kind: 'projects' }),
    backupDataDir: backupLibraryData,
    createStore: ({ rootPath, dataDir, deviceId }) => createLibraryStore({ rootPath, dataDir, deviceId, logger: log }),
    createIndex: createSearchIndex,
    spawnWorker: () => spawnScanWorker(path.join(import.meta.dirname, 'scan-worker.js'), { log, watchdog: watchdogFromEnv(process.env, app.isPackaged) }),
    watch: (o) => createWatcher({ rootPath: o.rootPath, dataDir: o.dataDir, config: o.config, onBatch: o.onBatch, onTaxonomyChange: o.onTaxonomyChange, onError: o.onError }),
  });
  const services: MainServices = {
    log,
    localDataDir: dirs.localData,
    emit,
    settings,
    approved,
    runtime: runtimeManager,
    libraries,
    secrets,
    shell: { openPath: (p) => shell.openPath(p), showItemInFolder: (p) => shell.showItemInFolder(p), openExternal: (u) => shell.openExternal(u) },
    async pickFolder(purpose, title) {
      // Test hook: only in a development run with RL_E2E=1 (see runtime.ts, dialog-override.ts).
      const override = e2eDialogOverride(process.env, app.isPackaged);
      if (override) return override;
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const options: Electron.OpenDialogOptions = {
        title,
        properties: purpose === 'export-destination' ? ['openDirectory', 'createDirectory'] : ['openDirectory'],
      };
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    async pickFile(_purpose, title) {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const options: Electron.OpenDialogOptions = {
        title,
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      };
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    async pickPdfFiles() {
      // Same test hook as the folder dialog: one path instead of the dialog.
      const override = e2eDialogOverride(process.env, app.isPackaged);
      if (override) return [override];
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const options: Electron.OpenDialogOptions = { properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF', extensions: ['pdf'] }] };
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return result.canceled ? [] : result.filePaths;
    },
    async pickExecutable() {
      const override = e2eDialogOverride(process.env, app.isPackaged);
      if (override) return override;
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const options: Electron.OpenDialogOptions = { properties: ['openFile'], ...(process.platform === 'win32' ? { filters: [{ name: 'Executable', extensions: ['exe'] }] } : {}) };
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    appInfo: () => ({ name: APP_NAME, version: app.getVersion(), platform: process.platform, electron: process.versions.electron ?? '' }),
    createImporter: (options) => createLegacyImporter(options),
    backupDataDir: (libraryId, dataDir) => backupPolicy(libraryId, dataDir, { force: true }),
    // RL_AI_PROVIDER=mock is honoured only in a development run (runtime.aiProvider is null when packaged).
    aiProvider: createProviderFactory({ forceMock: runtime.aiProvider === 'mock', mockScript: { demo: true }, localDataDir: dirs.localData, secrets, clientApp: `research-lab/${app.getVersion()}`, onErrorDetail: (detail) => log.warn('Claude provider error', { detail }) }),
    isOnline: () => !runtime.offline && net.isOnline(),
    fetch: (input, init) => net.fetch(input as string, init as never) as Promise<Response>,
    metadataFile: runtime.metadataFile,
  };

  // The reader loads PDFs through rl-doc://; every request looks the document up in the active library again.
  serveDocuments(session.defaultSession, createDocHandler({ resolve: (id) => presentPdf(services, id as DocumentId), allowedOrigin: rendererOrigin }));

  // Grid thumbnails through rl-thumb://: only files of the cache folder of the active library (D-196).
  serveThumbnails(
    session.defaultSession,
    createThumbHandler({
      dir: async () => thumbDir(dirs.localData, (await runtimeManager.require()).libraryId),
      allowedOrigin: rendererOrigin,
    }),
  );

  const dispatch = createDispatcher(channels, buildHandlers(services), log);
  ipcMain.handle(IPC_INVOKE_CHANNEL, async (event, channel: unknown, payload: unknown) => {
    // Only our own window, only our own origin.
    if (!event.senderFrame || !isTrustedUrl(event.senderFrame.url) || event.senderFrame !== event.sender.mainFrame) {
      log.warn('rejected IPC from untrusted frame');
      return { ok: false, error: new AppError('PERMISSION_DENIED', 'Untrusted sender').toJSON() };
    }
    return dispatch(channel, payload);
  });

  // Load the settings now so that problems found while loading (corrupt or newer file) are known
  // before the window opens. A failure here is reported by the first `settings:get` too.
  await settings.get().catch((e: unknown) => log.error('settings could not be loaded', { error: e }));
  const win = createMainWindow();
  // The renderer also pulls `app:notices` on start; the event covers a window that is already listening.
  win.webContents.once('did-finish-load', () => {
    for (const notice of settings.notices()) emit('app:notice', notice);
  });
  // Open the active library: index, worker thread and the first incremental scan, off the main thread.
  void runtimeManager.sync({ autoScan: true });
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    // A running chat turn owns a Claude Code process: it ends with the app.
    abortAllChatTurns();
    abortAllJobs();
    // A worker stuck in a synchronous loop must not keep the app from quitting: after a limit it is killed.
    const limit = new Promise<void>((resolve) => setTimeout(resolve, 15_000).unref());
    void Promise.race([runtimeManager.closeAll(), limit])
      .then(() => runtimeManager.terminateAll())
      .catch((e: unknown) => log.warn('closing the library runtime failed', { error: e }))
      .finally(() => app.quit());
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
  app.on('window-all-closed', () => app.quit());
  log.info('app started', { version: app.getVersion() });
}

main().catch((e: unknown) => {
  log.error('fatal startup error', { error: e });
  app.exit(1);
});
