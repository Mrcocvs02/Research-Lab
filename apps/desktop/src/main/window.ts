import { BrowserWindow } from 'electron';
import path from 'node:path';
import { APP_NAME, APP_ORIGIN } from './app-info.js';

/** Creates the one main window with the locked-down web preferences. */
export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: APP_NAME,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      enableBlinkFeatures: '',
      devTools: !!process.env.ELECTRON_RENDERER_URL,
    },
  });
  win.once('ready-to-show', () => win.show());

  const dev = process.env.ELECTRON_RENDERER_URL;
  void win.loadURL(dev ?? `${APP_ORIGIN}/index.html`);
  return win;
}
