import { BrowserWindow } from 'electron';
import path from 'node:path';
import { APP_NAME, APP_ORIGIN } from './app-info.js';
import { getRuntime } from './runtime.js';

/** Creates the one main window with the locked-down web preferences. */
export function createMainWindow(): BrowserWindow {
  const hidden = getRuntime().hiddenWindow;
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // Test runs (RL_E2E_HIDDEN, see runtime.ts): the window is shown far off screen, without focus
    // and without a taskbar entry. A never-shown window would have its frames throttled by Chromium,
    // which makes UI tests several times slower.
    ...(hidden ? { x: -32000, y: -32000, skipTaskbar: true } : {}),
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
      // A hidden test window must not have its timers and rendering throttled.
      backgroundThrottling: !hidden,
      // e2e runs only: the preload exposes `window.rlE2E` when it sees this flag.
      ...(getRuntime().e2e ? { additionalArguments: ['--rl-e2e'] } : {}),
    },
  });
  win.once('ready-to-show', () => (hidden ? win.showInactive() : win.show()));

  const dev = getRuntime().rendererDevUrl;
  void win.loadURL(dev ? `${dev}/` : `${APP_ORIGIN}/index.html`);
  return win;
}
