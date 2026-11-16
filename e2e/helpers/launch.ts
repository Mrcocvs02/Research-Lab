import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import {
  createFixtureLibrary,
  generateCorpus,
  diffSnapshots,
  formatDiff,
  fsPath,
  removeTree,
  snapshotTree,
  withRealFixtureCopy,
  type CorpusManifest,
  type CorpusOptions,
  type FixtureKind,
  type FixtureManifest,
  type FixtureOptions,
  type Snapshot,
  type SnapshotDiff,
} from '@rl/testkit';
import { rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DESKTOP_DIR = path.resolve(import.meta.dirname, '../../apps/desktop');

/** Folder inside a library that the app may write to. Everything else must stay byte-identical. */
export const DATA_DIR_NAME = '.lab';

export type LibrarySpec = FixtureKind | 'real' | { kind: FixtureKind; options?: FixtureOptions } | { corpus: number; options?: CorpusOptions };

export interface LaunchOptions {
  /** Extra environment variables for the app process (applied last). */
  env?: Record<string, string>;
  /**
   * Library to prepare in a temporary folder before launch: a synthetic kind ('papers', 'edge', 'full', 'it', 'en')
   * or 'real' (a copy of RL_FIXTURE_LIBRARY; throws when the variable is not set, so check `realLibrarySkipReason()` first).
   * A snapshot of the tree is taken at launch and checked by `verifyLibraryUntouched()`.
   */
  library?: LibrarySpec;
  /**
   * Sets RL_E2E=1 and RL_E2E_DIALOG_PATH so the native folder picker returns this path (main-process override).
   * `true` means "the library root" and needs the `library` option.
   */
  dialogPath?: string | true;
  /** Cuts the network for the Electron session (see `applyOffline`) and sets RL_E2E_OFFLINE=1. */
  offline?: boolean;
}

export interface LaunchedLibrary {
  root: string;
  /** Present for synthetic libraries only. */
  manifest?: FixtureManifest;
  /** Present for `{ corpus }` libraries (generateCorpus manifest). */
  corpus?: CorpusManifest;
  /**
   * Compares the library with its state at launch, ignoring the data folder (`.lab`) and `exclude`
   * (export folders, relative to the root).
   */
  diff(exclude?: string[]): Promise<SnapshotDiff>;
}

export interface LaunchedApp {
  app: ElectronApplication;
  window: Page;
  /** Temporary dirs handed to the app through RL_USER_DATA_DIR / RL_LOCAL_DATA_DIR. */
  userDataDir: string;
  localDataDir: string;
  library?: LaunchedLibrary;
  /** URLs the offline switch refused (empty when `offline` is off). */
  blockedRequests(): Promise<string[]>;
  /** Throws, listing paths, when anything outside `.lab` and `exclude` changed since launch. */
  verifyLibraryUntouched(exclude?: string[]): Promise<void>;
  close(): Promise<void>;
}

// Safety net: temporary folders are removed even when a worker dies before `close()` runs.
const liveDirs = new Set<string>();
process.once('exit', () => {
  for (const d of liveDirs) {
    try {
      rmSync(fsPath(d), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

async function disposeDir(dir: string): Promise<void> {
  await removeTree(dir).catch(() => {});
  liveDirs.delete(dir);
}

export function realLibrarySkipReason(): string | undefined {
  return process.env.RL_FIXTURE_LIBRARY ? undefined : 'RL_FIXTURE_LIBRARY is not set';
}

/**
 * Offline switch (PLAN section 7, "Prova offline"). Applied after launch to the default session:
 *  - `session.enableNetworkEmulation({ offline: true })`: requests through the session fail as disconnected;
 *  - a `webRequest.onBeforeRequest` filter for http(s) and ws(s) cancels and records each URL (`blockedRequests()`).
 * Limits: Node-level networking in the main process (global `fetch`, `http`) is not part of the session and is
 * not blocked, so code under test must use Electron's `net` or the session for the guarantee to hold. A later
 * `onBeforeRequest` registration inside the app would replace the recorder (the emulation stays).
 */
export async function applyOffline(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ session }) => {
    const g = globalThis as unknown as { __rlBlocked?: string[] };
    g.__rlBlocked = [];
    const ses = session.defaultSession;
    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
      g.__rlBlocked!.push(details.url);
      callback({ cancel: true });
    });
    await ses.enableNetworkEmulation({ offline: true });
  });
}

/**
 * Launches the BUILT app (run `npm run build` first; `npm run test:e2e` does it) with throw-away
 * user-data and local-data folders, so tests never touch real settings, secrets or indexes.
 * Every temporary folder (app dirs, fixture library, real-library copy) is removed by `close()`,
 * and on process exit as a fallback.
 */
export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const base = await mkdtemp(path.join(os.tmpdir(), 'rl-e2e-'));
  liveDirs.add(base);
  const userDataDir = path.join(base, 'user');
  const localDataDir = path.join(base, 'local');
  let fixture: { root: string; manifest?: FixtureManifest; cleanup(): Promise<void> } | undefined;
  let corpusManifest: CorpusManifest | undefined;
  let realCopy: { root: string; cleanup(): Promise<void> } | undefined;
  let libBase: string | undefined;
  let app: ElectronApplication | undefined;
  const cleanupAll = async () => {
    await app?.close().catch(() => {});
    await fixture?.cleanup().catch(() => {});
    await realCopy?.cleanup().catch(() => {});
    if (libBase) liveDirs.delete(libBase);
    await disposeDir(base);
  };

  try {
    const spec = options.library;
    if (spec === 'real') {
      realCopy = (await withRealFixtureCopy()) ?? undefined;
      if (!realCopy) throw new Error('library "real" requested but RL_FIXTURE_LIBRARY is not set (skip the test: see realLibrarySkipReason)');
    } else if (spec && typeof spec === 'object' && 'corpus' in spec) {
      const c = await generateCorpus(spec.corpus, spec.options);
      corpusManifest = c.manifest;
      fixture = { root: c.root, cleanup: c.cleanup };
    } else if (spec) {
      fixture = typeof spec === 'string' ? await createFixtureLibrary(spec) : await createFixtureLibrary(spec.kind, spec.options);
    }
    const libRoot = fixture?.root ?? realCopy?.root;
    let library: LaunchedLibrary | undefined;
    if (libRoot) {
      libBase = path.dirname(libRoot);
      liveDirs.add(libBase);
      // The data folder is excluded from the snapshot too: the app is expected to create it.
      const initial: Snapshot = await snapshotTree(libRoot, { exclude: [DATA_DIR_NAME] });
      library = {
        root: libRoot,
        ...(fixture?.manifest ? { manifest: fixture.manifest } : {}),
        ...(corpusManifest ? { corpus: corpusManifest } : {}),
        async diff(exclude = []) {
          return diffSnapshots(initial, await snapshotTree(libRoot, { exclude: [DATA_DIR_NAME, ...exclude] }));
        },
      };
    }

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    delete env.ELECTRON_RENDERER_URL;
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.RL_FIXTURE_LIBRARY; // the app never sees where the real library lives
    Object.assign(env, { RL_USER_DATA_DIR: userDataDir, RL_LOCAL_DATA_DIR: localDataDir, NODE_ENV: 'production' });
    // Test windows stay hidden (still rendered) unless RL_E2E_SHOW=1 is set to watch a run.
    if (process.env.RL_E2E_SHOW !== '1') env.RL_E2E_HIDDEN = '1';
    if (options.dialogPath !== undefined) {
      const dialogPath = options.dialogPath === true ? libRoot : options.dialogPath;
      if (!dialogPath) throw new Error('dialogPath: true needs the `library` option');
      Object.assign(env, { RL_E2E: '1', RL_E2E_DIALOG_PATH: dialogPath });
    }
    if (options.offline) env.RL_E2E_OFFLINE = '1';
    Object.assign(env, options.env);

    const launched = await electron.launch({ args: [DESKTOP_DIR], env });
    app = launched;
    if (options.offline) await applyOffline(launched);
    const window = await launched.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    return {
      app: launched,
      window,
      userDataDir,
      localDataDir,
      ...(library ? { library } : {}),
      async blockedRequests() {
        return launched.evaluate(() => (globalThis as unknown as { __rlBlocked?: string[] }).__rlBlocked?.slice() ?? []);
      },
      async verifyLibraryUntouched(exclude = []) {
        if (!library) throw new Error('verifyLibraryUntouched needs the `library` option');
        const d = await library.diff(exclude);
        if (!d.clean) throw new Error(`Library files changed outside ${DATA_DIR_NAME} and the export folders:\n${formatDiff({ ...d, touched: [] })}`);
      },
      close: cleanupAll,
    };
  } catch (e) {
    await cleanupAll();
    throw e;
  }
}
