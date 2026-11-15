import { expect as baseExpect, test as baseTest } from '@playwright/test';
import { access, appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchApp, realLibrarySkipReason } from './helpers/launch';
import { expect, test } from './helpers/test';

// Tests of the harness itself (library option, dialog override, offline switch, non-destructive check).

test.describe('fixture hook: library and app', () => {
  test.use({ libraryKind: 'edge', exportDirs: ['export'] });

  test('library fixture is created in a temporary folder and may change only inside .lab and export folders', async ({ library }) => {
    expect(library.manifest.files.length).toBeGreaterThan(5);
    await mkdir(path.join(library.root, '.lab'), { recursive: true });
    await writeFile(path.join(library.root, '.lab', 'index.json'), '{}');
    await mkdir(path.join(library.root, 'export'), { recursive: true });
    await writeFile(path.join(library.root, 'export', 'note.md'), '# generated');
  });

  test('app fixture starts on the library with the dialog override and leaves originals untouched', async ({ app }) => {
    expect(app.library?.manifest?.kind).toBe('edge');
    const env = await app.app.evaluate(() => ({ e2e: process.env.RL_E2E, dialog: process.env.RL_E2E_DIALOG_PATH, real: process.env.RL_FIXTURE_LIBRARY }));
    expect(env.e2e).toBe('1');
    expect(env.dialog).toBe(app.library!.root);
    expect(env.real).toBeUndefined();
    await expect(app.window.getByTestId('app-title')).toHaveText('Research Lab');
  });
});

baseTest.describe('non-destructive check detects changes', () => {
  baseTest('verifyLibraryUntouched passes, then fails after a deliberate modification', async () => {
    const ctx = await launchApp({ library: 'papers' });
    try {
      await ctx.verifyLibraryUntouched();
      // Allowed: data folder and export folder.
      await mkdir(path.join(ctx.library!.root, '.lab'), { recursive: true });
      await writeFile(path.join(ctx.library!.root, '.lab', 'x.json'), '{}');
      await ctx.verifyLibraryUntouched();
      await mkdir(path.join(ctx.library!.root, 'out'));
      await writeFile(path.join(ctx.library!.root, 'out', 'a.md'), 'a');
      await baseExpect(ctx.verifyLibraryUntouched()).rejects.toThrow(/added: out\/a\.md/);
      await ctx.verifyLibraryUntouched(['out']);
      // Forbidden: change an original.
      const target = ctx.library!.manifest!.files[0]!.relPath;
      await appendFile(path.join(ctx.library!.root, ...target.split('/')), 'tampered');
      await baseExpect(ctx.verifyLibraryUntouched(['out'])).rejects.toThrow(new RegExp(`modified: ${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    } finally {
      await ctx.close();
    }
  });

  baseTest('close() removes every temporary folder', async () => {
    const ctx = await launchApp({ library: 'edge' });
    const dirs = [ctx.userDataDir, path.dirname(ctx.userDataDir), path.dirname(ctx.library!.root)];
    await ctx.close();
    for (const d of dirs) await baseExpect(access(d)).rejects.toThrow();
  });
});

baseTest.describe('offline switch', () => {
  baseTest('blocks session network requests and records them', async () => {
    const ctx = await launchApp({ offline: true });
    try {
      const outcome = await ctx.app.evaluate(async ({ net }) => {
        try {
          await net.fetch('https://example.com/ping');
          return 'reached';
        } catch (e) {
          return String((e as Error).message);
        }
      });
      baseExpect(outcome).not.toBe('reached');
      baseExpect(await ctx.blockedRequests()).toContain('https://example.com/ping');
      baseExpect(await ctx.app.evaluate(() => process.env.RL_E2E_OFFLINE)).toBe('1');
      // The app itself keeps working: local content is served from the app scheme.
      await baseExpect(ctx.window.getByTestId('app-title')).toHaveText('Research Lab');
    } finally {
      await ctx.close();
    }
  });

  baseTest('without the switch nothing is recorded', async () => {
    const ctx = await launchApp();
    try {
      baseExpect(await ctx.blockedRequests()).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});

baseTest.describe('real library copy (RL_FIXTURE_LIBRARY)', () => {
  baseTest.skip(!!realLibrarySkipReason(), realLibrarySkipReason() ?? '');

  baseTest('a session on the copy leaves its originals unchanged', async () => {
    const ctx = await launchApp({ library: 'real', dialogPath: true });
    try {
      await baseExpect(ctx.window.getByTestId('app-title')).toHaveText('Research Lab');
      await ctx.verifyLibraryUntouched();
    } finally {
      await ctx.close();
    }
  });
});
