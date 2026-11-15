import path from 'node:path';

/**
 * Test hook for the folder dialog: with `RL_E2E=1` and an absolute `RL_E2E_DIALOG_PATH`,
 * `dialog:chooseFolder` returns that path without opening the native dialog. Without
 * `RL_E2E=1` the path variable is ignored, so a stray variable can never bypass the dialog.
 */
export function e2eDialogOverride(env: NodeJS.ProcessEnv): string | null {
  if (env.RL_E2E !== '1') return null;
  const p = env.RL_E2E_DIALOG_PATH;
  return p && path.isAbsolute(p) ? path.resolve(p) : null;
}
