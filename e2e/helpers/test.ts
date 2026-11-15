import { test as base } from '@playwright/test';
import { createFixtureLibrary, diffSnapshots, formatDiff, snapshotTree, type FixtureKind, type FixtureLibrary } from '@rl/testkit';
import { DATA_DIR_NAME, launchApp, realLibrarySkipReason, type LaunchedApp, type LibrarySpec } from './launch';

interface Options {
  /** Library prepared for the test: a synthetic kind or 'real' (copy of RL_FIXTURE_LIBRARY, test skipped when unset). */
  libraryKind: FixtureKind | 'real';
  /** Export folders (relative to the library root) the app may write to, besides `.lab`. */
  exportDirs: string[];
}

interface Fixtures {
  /** A temporary library (no app). After the test nothing outside `.lab` and `exportDirs` may differ. */
  library: FixtureLibrary;
  /** The app launched on a temporary library with the folder dialog pointed at it, with the same after-test check. */
  app: LaunchedApp;
}

/**
 * Playwright `test` with non-destructive checking built in:
 *   import { test, expect } from './helpers/test';
 *   test.use({ libraryKind: 'edge', exportDirs: ['export'] });
 *   test('...', async ({ app }) => { ... });
 * The `.lab` data folder and `exportDirs` are the only places that may change; any other difference fails the test.
 */
export const test = base.extend<Options & Fixtures>({
  libraryKind: ['full', { option: true }],
  exportDirs: [[], { option: true }],

  library: async ({ libraryKind, exportDirs }, use, testInfo) => {
    if (libraryKind === 'real') {
      testInfo.skip(true, 'library fixture is synthetic only: use the `app` fixture for the real copy');
    }
    const lib = await createFixtureLibrary(libraryKind as FixtureKind);
    try {
      const before = await snapshotTree(lib.root, { exclude: [DATA_DIR_NAME, ...exportDirs] });
      await use(lib);
      const d = diffSnapshots(before, await snapshotTree(lib.root, { exclude: [DATA_DIR_NAME, ...exportDirs] }));
      if (!d.clean) throw new Error(`Library files changed outside ${DATA_DIR_NAME} and the export folders:\n${formatDiff({ ...d, touched: [] })}`);
    } finally {
      await lib.cleanup();
    }
  },

  app: async ({ libraryKind, exportDirs }, use, testInfo) => {
    if (libraryKind === 'real') {
      const reason = realLibrarySkipReason();
      if (reason) testInfo.skip(true, reason);
    }
    const spec: LibrarySpec = libraryKind;
    const launched = await launchApp({ library: spec, dialogPath: true });
    try {
      await use(launched);
      await launched.verifyLibraryUntouched(exportDirs);
    } finally {
      await launched.close();
    }
  },
});

export { expect } from '@playwright/test';
