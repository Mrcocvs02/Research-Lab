import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron';
import path from 'node:path';
import { backupDataDir, createLegacyImporter } from '@rl/data';
import {
  AppError,
  createDispatcher,
  events,
  IPC_EVENT_CHANNEL,
  IPC_INVOKE_CHANNEL,
  channels,
  type EventName,
} from '@rl/core';
import { createFileLogger } from '@rl/core/node';
import { APP_NAME } from './app-info.js';
import { ApprovedPaths } from './approved-paths.js';
import { e2eDialogOverride } from './dialog-override.js';
import { resolveAppDirs } from './dirs.js';
import { buildHandlers, type MainServices } from './ipc/handlers/index.js';
import { LibraryService } from './library-service.js';
import { FileSecretStore } from './secret-store.js';
import { installGlobalSecurity, isTrustedUrl, registerPrivilegedSchemes, serveRenderer } from './security.js';
import { SettingsStore } from './settings-store.js';
import { createMainWindow } from './window.js';

// Name and paths must be fixed before `ready`. Env overrides keep tests off real data.
app.setName(APP_NAME);
const dirs = resolveAppDirs(process.env, { userData: app.getPath('userData') });
app.setPath('userData', dirs.userData);
app.setPath('sessionData', path.join(dirs.localData, 'session'));
registerPrivilegedSchemes();

const log = createFileLogger({ dir: path.join(dirs.localData, 'logs'), name: 'main', console: !app.isPackaged });

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
  if (!process.env.ELECTRON_RENDERER_URL) {
    const { session } = await import('electron');
    serveRenderer(session.defaultSession, path.join(import.meta.dirname, '../renderer'));
  }

  const settings = SettingsStore.forDir(dirs.userData, log);
  const approved = new ApprovedPaths();
  const services: MainServices = {
    log,
    emit,
    settings,
    approved,
    libraries: new LibraryService(settings, approved),
    secrets: new FileSecretStore(dirs.userData, {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plain) => safeStorage.encryptString(plain),
      decrypt: (data) => safeStorage.decryptString(data),
    }),
    async pickFolder(purpose, title) {
      // Test hook: only honoured when RL_E2E=1 (see dialog-override.ts).
      const override = e2eDialogOverride(process.env);
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
    appInfo: () => ({ name: APP_NAME, version: app.getVersion(), platform: process.platform, electron: process.versions.electron ?? '' }),
    createImporter: () => createLegacyImporter(),
    backupDataDir: (libraryId, dataDir) => backupDataDir(dataDir, path.join(dirs.localData, 'backups', libraryId)),
  };

  const dispatch = createDispatcher(channels, buildHandlers(services), log);
  ipcMain.handle(IPC_INVOKE_CHANNEL, async (event, channel: unknown, payload: unknown) => {
    // Only our own window, only our own origin.
    if (!event.senderFrame || !isTrustedUrl(event.senderFrame.url) || event.senderFrame !== event.sender.mainFrame) {
      log.warn('rejected IPC from untrusted frame');
      return { ok: false, error: new AppError('PERMISSION_DENIED', 'Untrusted sender').toJSON() };
    }
    return dispatch(channel, payload);
  });

  createMainWindow();
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
