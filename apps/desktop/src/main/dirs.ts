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

/** The folder of `--user-data-dir=<absolute path>` (a Chromium switch that works in an installed app), or null. */
function userDataDirFromArgv(argv: readonly string[]): string | null {
  const arg = argv.find((a) => a.startsWith('--user-data-dir='));
  const value = arg?.slice('--user-data-dir='.length).replace(/^"|"$/g, '');
  return value && path.isAbsolute(value) ? path.resolve(value) : null;
}

/**
 * `RL_USER_DATA_DIR` and `RL_LOCAL_DATA_DIR` override the locations so that tests never
 * touch real data, but ONLY in a development run: with `isPackaged` they are ignored.
 * `--user-data-dir=<absolute path>` (Chromium's own switch, honoured by Electron for the user-data folder) works in an
 * installed app too, for the test of the packaged build and for a second profile: the machine-local data then lives in
 * `<that folder>/local`, so one folder holds the whole profile and nothing reaches the real local data (D-291).
 * Pure function: pass the defaults in.
 */
export function resolveAppDirs(env: NodeJS.ProcessEnv, defaults: { userData: string }, isPackaged: boolean, argv: readonly string[] = []): AppDirs {
  const rt = resolveRuntimeConfig(env, isPackaged);
  const localBase = env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  const profile = userDataDirFromArgv(argv);
  return {
    userData: rt.userDataDir ?? profile ?? defaults.userData,
    localData: rt.localDataDir ?? (profile ? path.join(profile, 'local') : path.join(localBase, APP_DIR_NAME)),
  };
}
