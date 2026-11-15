import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DESKTOP_DIR = path.resolve(import.meta.dirname, '../../apps/desktop');

export interface LaunchedApp {
  app: ElectronApplication;
  window: Page;
  /** Temporary dirs handed to the app through RL_USER_DATA_DIR / RL_LOCAL_DATA_DIR. */
  userDataDir: string;
  localDataDir: string;
  close(): Promise<void>;
}

/**
 * Launches the BUILT app (run `npm run build` first; `npm run test:e2e` does it) with throw-away
 * user-data and local-data folders, so tests never touch real settings, secrets or indexes.
 */
export async function launchApp(extraEnv: Record<string, string> = {}): Promise<LaunchedApp> {
  const base = await mkdtemp(path.join(os.tmpdir(), 'rl-e2e-'));
  const userDataDir = path.join(base, 'user');
  const localDataDir = path.join(base, 'local');
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.ELECTRON_RENDERER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(env, { RL_USER_DATA_DIR: userDataDir, RL_LOCAL_DATA_DIR: localDataDir, NODE_ENV: 'production' }, extraEnv);

  const app = await electron.launch({ args: [DESKTOP_DIR], env });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return {
    app,
    window,
    userDataDir,
    localDataDir,
    async close() {
      await app.close().catch(() => {});
      await rm(base, { recursive: true, force: true }).catch(() => {});
    },
  };
}
