import { resolveRuntimeConfig } from './runtime.js';

/**
 * Test hook for the folder dialog: with `RL_E2E=1` and an absolute `RL_E2E_DIALOG_PATH`,
 * `dialog:chooseFolder` returns that path without opening the native dialog. Without
 * `RL_E2E=1` the path variable is ignored, and in an installed app (`isPackaged`) the hook
 * does not exist at all, so a stray variable can never bypass the dialog.
 */
export function e2eDialogOverride(env: NodeJS.ProcessEnv, isPackaged: boolean): string | null {
  return resolveRuntimeConfig(env, isPackaged).dialogPath;
}
