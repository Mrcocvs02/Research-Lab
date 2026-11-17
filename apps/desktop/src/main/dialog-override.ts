import { resolveRuntimeConfig } from './runtime.js';

/**
 * Test hook for the folder dialog: with `RL_E2E=1` and an absolute `RL_E2E_DIALOG_PATH`,
 * `dialog:chooseFolder` returns that path without opening the native dialog. Without
 * `RL_E2E=1` the path variable is ignored, and in an installed app (`isPackaged`) the hook
 * does not exist at all, so a stray variable can never bypass the dialog. `RL_E2E_EXPORT_DIALOG_PATH` does the same for
 * the export destination only, so a test can export outside the library root.
 */
export function e2eDialogOverride(env: NodeJS.ProcessEnv, isPackaged: boolean, purpose?: string): string | null {
  const c = resolveRuntimeConfig(env, isPackaged);
  return (purpose === 'export-destination' ? c.exportDialogPath : null) ?? c.dialogPath;
}
