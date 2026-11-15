import { BrowserWindow } from 'electron';
import path from 'node:path';
import { APP_NAME, APP_ORIGIN } from './app-info.js';
import { getRuntime } from './runtime.js';

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
      devTools: !!getRuntime().rendererDevUrl,
    },
  });
  win.once('ready-to-show', () => win.show());

  const dev = getRuntime().rendererDevUrl;
  void win.loadURL(dev ? `${dev}/` : `${APP_ORIGIN}/index.html`);
  return win;
}
