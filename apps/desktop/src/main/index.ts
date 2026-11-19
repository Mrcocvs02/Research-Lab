import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, net, safeStorage, session, shell } from 'electron';
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
import { honoursDialogHooks, honoursProfileSwitch, mustRefuseDebugSwitches, PACKAGED_TEST_BUILD } from './debug-switches.js';
import { resolveAppDirs } from './dirs.js';
import { presentPdf } from './ipc/handlers/doc-files.js';
import { buildHandlers, type MainServices } from './ipc/handlers/index.js';
import { simulatedClaudeIo } from './ai/account.js';
import { createProviderFactory } from './ai/provider-factory.js';
import { abortAllChatTurns } from './ai/service.js';
import { abortAllJobs } from './ai/jobs.js';
import { closeOpenMark, initResume } from './study/resume.js';
import { fixtureFetch } from './net-fixtures.js';
import { createBackupPolicy } from './library/backup-policy.js';
import { RuntimeManager } from './library/runtime-manager.js';
import { spawnScanWorker, watchdogFromEnv } from './library/worker-host.js';
import { spawnGraphWorker, type GraphHost } from './graph/host.js';
import { cancelAllBackups, whenBackupDone } from './backup/registry.js';
import { closeGraph } from './graph/service.js';
import { reconcileMcp, stopMcp } from './mcp/service.js';
import { LibraryService } from './library-service.js';
import { applyResourceSwitches } from './resources.js';
import { configureRuntime, resolveRuntimeConfig } from './runtime.js';
import { PDF_WRITE_ENABLED } from '@rl/core';
import { flushPdfWrites } from './study/pdf-sync.js';
import { FileSecretStore } from './secret-store.js';
import { installGlobalSecurity, isTrustedUrl, registerPrivilegedSchemes, rendererOrigin, serveDocuments, serveRenderer, serveThumbnails } from './security.js';
import { SettingsStore } from './settings-store.js';
import { createMainWindow } from './window.js';

// Name and paths must be fixed before `ready`. Env overrides keep tests off real data, but only in a
// development run: the installed app (`app.isPackaged`) ignores every RL_* / ELECTRON_RENDERER_URL variable.
app.setName(APP_NAME);
// An installed build does not run with a remote debugging port or pipe (D-296): nothing below runs, no window opens.
const refusedDebugSwitches = mustRefuseDebugSwitches(app.isPackaged, PACKAGED_TEST_BUILD, process.argv, (n) => app.commandLine.hasSwitch(n));
if (refusedDebugSwitches) app.exit(1);
applyResourceSwitches(app.commandLine);
const runtime = configureRuntime(resolveRuntimeConfig(process.env, app.isPackaged));
// `--user-data-dir` is also read by Chromium itself, so the default user-data folder is rebuilt here when it is ignored.
const profileSwitch = honoursProfileSwitch(app.isPackaged, PACKAGED_TEST_BUILD);
const defaultUserData = profileSwitch || !process.argv.some((a) => a.startsWith('--user-data-dir')) ? app.getPath('userData') : path.join(app.getPath('appData'), APP_NAME);
const dirs = resolveAppDirs(process.env, { userData: defaultUserData }, app.isPackaged, profileSwitch ? process.argv : []);
// The e2e dialog hooks exist in a development run and in a test build of the packaged app, never in an installed one.
const dialogHooksPackaged = !honoursDialogHooks(app.isPackaged, PACKAGED_TEST_BUILD);
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
  // The mark of the reader the last run left open (Resume): read and removed before anything can write a new one.
  initResume(dirs.localData);
  if (refusedDebugSwitches) return;
  await app.whenReady();
  installGlobalSecurity();
  if (!runtime.rendererDevUrl) {
    serveRenderer(session.defaultSession, path.join(import.meta.dirname, '../renderer'));
  }

  const settings = SettingsStore.forDir(dirs.userData, log, app.getLocale());
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
  let graphHost: GraphHost | null = null;
  let startupMs: number | null = null;
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
      const override = e2eDialogOverride(process.env, dialogHooksPackaged, purpose);
      if (override) return override;
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const options: Electron.OpenDialogOptions = {
        title,
        properties: purpose === 'export-destination' || purpose === 'backup-destination' ? ['openDirectory', 'createDirectory'] : ['openDirectory'],
      };
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    async pickFile(purpose, title) {
      if (purpose === 'bib-source' || purpose === 'resource-file') {
        const override = e2eDialogOverride(process.env, dialogHooksPackaged, purpose);
        if (override) return override;
      }
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const options: Electron.OpenDialogOptions = {
        title,
        properties: ['openFile'],
        filters: purpose === 'backup-file' ? [{ name: 'Research Lab backup', extensions: ['rlbackup'] }] : purpose === 'bib-source' ? [{ name: 'BibTeX, CSL JSON, RDF, Zotero', extensions: ['bib', 'json', 'rdf', 'sqlite'] }] : purpose === 'resource-file' ? [] : [{ name: 'JSON', extensions: ['json'] }],
      };
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    async pickPdfFiles() {
      // Same test hook as the folder dialog: one path instead of the dialog.
      const override = e2eDialogOverride(process.env, dialogHooksPackaged);
      if (override) return [override];
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const options: Electron.OpenDialogOptions = { properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF', extensions: ['pdf'] }] };
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return result.canceled ? [] : result.filePaths;
    },
    async pickExecutable() {
      const override = e2eDialogOverride(process.env, dialogHooksPackaged);
      if (override) return override;
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const options: Electron.OpenDialogOptions = { properties: ['openFile'], ...(process.platform === 'win32' ? { filters: [{ name: 'Executable', extensions: ['exe'] }] } : {}) };
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    clipboard: { writeText: (text) => clipboard.writeText(text), readText: () => clipboard.readText() },
    appInfo: () => ({ name: APP_NAME, version: app.getVersion(), platform: process.platform, electron: process.versions.electron ?? '' }),
    createImporter: (options) => createLegacyImporter(options),
    backupDataDir: (libraryId, dataDir) => backupPolicy(libraryId, dataDir, { force: true }),
    // RL_AI_PROVIDER=mock is honoured only in a development run (runtime.aiProvider is null when packaged).
    aiProvider: createProviderFactory({ forceMock: runtime.aiProvider === 'mock', mockScript: { demo: true }, localDataDir: dirs.localData, secrets, clientApp: `research-lab/${app.getVersion()}`, onErrorDetail: (detail) => log.warn('Claude provider error', { detail }) }),
    // With canned answers (tests) the machine's connection does not matter; the offline switch still does.
    isOnline: () => !runtime.offline && (runtime.netFixturesFile !== null || net.isOnline()),
    // Test hook: canned answers instead of the network (development run with RL_E2E=1 only).
    fetch: runtime.netFixturesFile ? fixtureFetch(runtime.netFixturesFile) : (input, init) => net.fetch(input as string, init as never) as Promise<Response>,
    metadataFile: runtime.metadataFile,
    // Writing into the PDFs is on (D-473). An e2e development run keeps it off unless the spec asks for it (RL_E2E_PDF_WRITE=1),
    // so specs that check the library is untouched stay valid.
    pdfWriteEnabled: !app.isPackaged && process.env['RL_E2E'] === '1' ? process.env['RL_E2E_PDF_WRITE'] === '1' : PDF_WRITE_ENABLED,
    // Test hook: a simulated Claude Code instead of the real program and account (development run with RL_E2E=1 only).
    ...(runtime.claudeSimDir ? { claudeIo: simulatedClaudeIo(runtime.claudeSimDir) } : {}),
    // The graph worker thread (build, similarity on the fly): started by the first call, closed when idle.
    graphEngine: () => (graphHost ??= spawnGraphWorker(path.join(import.meta.dirname, 'graph-worker.js'), { log })),
    // Maintenance report (D-258): time to the first window content, and the worker threads alive right now.
    startupMs: () => startupMs,
    workers: () => (runtimeManager.workerAlive() ? 1 : 0) + (graphHost?.alive() ? 1 : 0),
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
    startupMs = Math.round(performance.now());
    for (const notice of settings.notices()) emit('app:notice', notice);
  });
  // Open the active library: index, worker thread and the first incremental scan, off the main thread.
  // The automatic backup is checked once here (D-256), after the library is open; never by a timer.
  void runtimeManager
    .sync({ autoScan: true })
    .then(() => reconcileMcp(services))
    // The automatic backup waits for the first scan to end: both read the same folder, and one heavy job at a time.
    .then(() => runtimeManager.require().then((rt) => rt.whenIdle()).catch(() => undefined))
    .then(async () => {
      // The backup code is loaded only when the automatic backup is on.
      const app = await settings.get();
      if (app.backup.auto !== 'off' && app.activeLibraryId !== null) await (await import('./backup/service.js')).autoBackupOnStart(services);
    })
    .catch((e: unknown) => log.warn('start-up tasks failed', { error: e }));
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    // A normal quit: the reader's open mark goes, so the next start does not read it as an unclean close (Resume, D-414).
    closeOpenMark(dirs.localData);
    // A running chat turn owns a Claude Code process: it ends with the app.
    abortAllChatTurns();
    abortAllJobs();
    // A running backup is cancelled and waited for below, so no partial file or restore folder outlives the app.
    cancelAllBackups(services);
    void closeGraph(services);
    // A worker stuck in a synchronous loop must not keep the app from quitting: after a limit it is killed.
    const limit = new Promise<void>((resolve) => setTimeout(resolve, 15_000).unref());
    // The pending annotations are written into their PDFs first (at most 5 s, D-349); the worker must still be alive for it.
    void Promise.race([flushPdfWrites(services).then(() => Promise.all([runtimeManager.closeAll(), stopMcp(services), whenBackupDone(services)])), limit])
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
