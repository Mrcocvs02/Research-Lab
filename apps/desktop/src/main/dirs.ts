import os from 'node:os';
import path from 'node:path';
import { APP_DIR_NAME } from './app-info.js';
import { resolveRuntimeConfig } from './runtime.js';

export interface AppDirs {
  /** Roaming per-user app data: settings, encrypted secrets. May be synced by the OS profile. */
  userData: string;
  /** Machine-local data: search indexes, caches, logs. Never in a synced folder. */
  localData: string;
}

/**
 * `RL_USER_DATA_DIR` and `RL_LOCAL_DATA_DIR` override the locations so that tests never
 * touch real data, but ONLY in a development run: with `isPackaged` they are ignored.
 * Pure function: pass the defaults in.
 */
export function resolveAppDirs(env: NodeJS.ProcessEnv, defaults: { userData: string }, isPackaged: boolean): AppDirs {
  const rt = resolveRuntimeConfig(env, isPackaged);
  const localBase = env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  return {
    userData: rt.userDataDir ?? defaults.userData,
    localData: rt.localDataDir ?? path.join(localBase, APP_DIR_NAME),
  };
}
