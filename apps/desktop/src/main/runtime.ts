import path from 'node:path';

/**
 * Environment-driven switches (test hooks and the dev server), resolved ONCE and only honoured
 * in a development run. An installed app (`app.isPackaged`) ignores all of them, so a stray or
 * malicious environment variable can never redirect user data, bypass the folder dialog or make
 * the window load a remote page. Pure: no Electron import, so it is tested without Electron.
 */
export interface RuntimeConfig {
  /** Absolute override of the roaming user-data folder (tests). */
  userDataDir: string | null;
  /** Absolute override of the machine-local data folder (tests). */
  localDataDir: string | null;
  /** Path the folder dialog returns without opening (tests; needs RL_E2E=1). */
  dialogPath: string | null;
  /** Tests: keep the window hidden (still rendered, not throttled) so test runs do not pop up on screen. */
  hiddenWindow: boolean;
  /** Tests and development: `'mock'` makes the AI layer use the deterministic mock provider (never a real Claude call). */
  aiProvider: 'mock' | null;
  /** Origin (`http://localhost:<port>`) of the Vite dev server, or null: load the built renderer. */
  rendererDevUrl: string | null;
  /** Human-readable notes about variables that were present but not honoured. */
  warnings: string[];
}

const HOOK_VARIABLES = ['RL_E2E', 'RL_E2E_DIALOG_PATH', 'RL_E2E_OFFLINE', 'RL_E2E_HIDDEN', 'RL_USER_DATA_DIR', 'RL_LOCAL_DATA_DIR', 'RL_AI_PROVIDER', 'ELECTRON_RENDERER_URL'] as const;

/**
 * Accepts only `http://localhost:<port>` or `http://127.0.0.1:<port>` (no credentials, no
 * query or fragment, path `/` only) and returns its origin; anything else is null.
 */
export function parseDevServerUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:') return null;
  if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return null;
  if (!/^[1-9]\d{0,4}$/.test(u.port) || Number(u.port) > 65535) return null;
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/') return null;
  return u.origin;
}

const absolute = (v: string | undefined) => (v && path.isAbsolute(v) ? path.resolve(v) : null);

export function resolveRuntimeConfig(env: NodeJS.ProcessEnv, isPackaged: boolean): RuntimeConfig {
  const warnings: string[] = [];
  const present = HOOK_VARIABLES.filter((k) => env[k] !== undefined && env[k] !== '');
  if (isPackaged) {
    if (present.length) warnings.push(`Ignored development/test variables in the installed app: ${present.join(', ')}`);
    return { userDataDir: null, localDataDir: null, dialogPath: null, hiddenWindow: false, aiProvider: null, rendererDevUrl: null, warnings };
  }
  const rendererDevUrl = parseDevServerUrl(env.ELECTRON_RENDERER_URL);
  if (env.ELECTRON_RENDERER_URL && !rendererDevUrl) {
    warnings.push('Ignored ELECTRON_RENDERER_URL: only http://localhost:<port> or http://127.0.0.1:<port> is accepted');
  }
  if (env.RL_AI_PROVIDER && env.RL_AI_PROVIDER !== 'mock') warnings.push('Ignored RL_AI_PROVIDER: only "mock" is accepted');
  return {
    userDataDir: absolute(env.RL_USER_DATA_DIR),
    localDataDir: absolute(env.RL_LOCAL_DATA_DIR),
    // The dialog path variable alone never does anything: RL_E2E=1 must be set as well.
    dialogPath: env.RL_E2E === '1' ? absolute(env.RL_E2E_DIALOG_PATH) : null,
    hiddenWindow: env.RL_E2E_HIDDEN === '1',
    aiProvider: env.RL_AI_PROVIDER === 'mock' ? 'mock' : null,
    rendererDevUrl,
    warnings,
  };
}

let current: RuntimeConfig = { userDataDir: null, localDataDir: null, dialogPath: null, hiddenWindow: false, aiProvider: null, rendererDevUrl: null, warnings: [] };

/** Called once, first thing in the main entry point. */
export function configureRuntime(config: RuntimeConfig): RuntimeConfig {
  current = config;
  return current;
}

export function getRuntime(): RuntimeConfig {
  return current;
}
