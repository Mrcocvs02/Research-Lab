import os from 'node:os';
import path from 'node:path';
import { APP_DIR_NAME } from './app-info.js';

export interface AppDirs {
  /** Roaming per-user app data: settings, encrypted secrets. May be synced by the OS profile. */
  userData: string;
  /** Machine-local data: search indexes, caches, logs. Never in a synced folder. */
  localData: string;
}

/**
 * `RL_USER_DATA_DIR` and `RL_LOCAL_DATA_DIR` override the locations so that tests never
 * touch real data. Pure function: pass the defaults in.
 */
export function resolveAppDirs(env: NodeJS.ProcessEnv, defaults: { userData: string }): AppDirs {
  const pick = (v: string | undefined) => (v && path.isAbsolute(v) ? path.resolve(v) : undefined);
  const localBase = env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  return {
    userData: pick(env.RL_USER_DATA_DIR) ?? defaults.userData,
    localData: pick(env.RL_LOCAL_DATA_DIR) ?? path.join(localBase, APP_DIR_NAME),
  };
}
