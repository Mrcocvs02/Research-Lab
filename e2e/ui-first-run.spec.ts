import { expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launchApp, type LaunchedApp } from './helpers/launch';

interface Scenario {
  title: string;
  uiLanguage: 'it' | 'en';
  docLanguage: 'it' | 'en';
  libraryName: string;
  /** Expected texts in the interface language. */
  texts: { welcome: string; summary: string };
}

const scenarios: Scenario[] = [
  { title: 'Italian interface, English documents', uiLanguage: 'it', docLanguage: 'en', libraryName: 'Biblioteca di prova', texts: { welcome: 'Benvenuto', summary: 'Riepilogo' } },
  { title: 'English interface, Italian documents', uiLanguage: 'en', docLanguage: 'it', libraryName: 'Sample library', texts: { welcome: 'Welcome', summary: 'Summary' } },
];

async function launchWith(base: string, root: string): Promise<LaunchedApp> {
  return launchApp({
    dialogPath: root,
    env: {
      RL_USER_DATA_DIR: path.join(base, 'user'),
      RL_LOCAL_DATA_DIR: path.join(base, 'local'),
    },
  });
}

async function next(window: Page) {
  await window.getByTestId('wizard-next').click();
}

for (const scenario of scenarios) {
  test(`first run: ${scenario.title}`, async () => {
    // Throw-away library folder and app data; nothing here refers to a real folder.
    const base = await mkdtemp(path.join(os.tmpdir(), 'rl-ui-'));
    const root = path.join(base, 'any-folder');
    await mkdir(path.join(root, 'first-topic', 'nested'), { recursive: true });
    await mkdir(path.join(root, 'second-topic'), { recursive: true });
    let ctx: LaunchedApp | undefined;
    try {
      ctx = await launchWith(base, root);
      const { window } = ctx;

      // Language step: the wizard opens by itself on an empty profile.
      await expect(window.getByTestId('wizard')).toBeVisible();
      await window.getByTestId('wizard-ui-language').selectOption(scenario.uiLanguage);
      await expect(window.getByTestId('wizard-step-title')).toHaveText(scenario.texts.welcome);
      await next(window);

      // Profile step (optional): leave empty.
      await next(window);

      // Folder step: the dialog is replaced by RL_E2E_DIALOG_PATH.
      await window.getByTestId('wizard-choose-folder').click();
      await expect(window.getByTestId('wizard-folder-chosen')).toContainText('any-folder');
      await next(window);

      // Details step.
      await window.getByTestId('wizard-lib-name').fill(scenario.libraryName);
      await window.getByTestId('wizard-doc-language').selectOption(scenario.docLanguage);
      await next(window);

      // Taxonomy step: default empty.
      await expect(window.getByTestId('wizard-taxonomy-empty')).toBeChecked();
      await next(window);

      // AI folders step: tree is shown, nothing selected, explicit confirmation required.
      const tree = window.getByTestId('wizard-ai-tree');
      await expect(tree.getByRole('checkbox')).toHaveCount(2);
      for (const box of await tree.getByRole('checkbox').all()) await expect(box).not.toBeChecked();
      await expect(window.getByTestId('wizard-next')).toBeDisabled();
      await window.getByTestId('wizard-ai-confirm').check();
      await next(window);

      // Summary and create.
      await expect(window.getByTestId('wizard-step-title')).toHaveText(scenario.texts.summary);
      await window.getByTestId('wizard-create').click();
      await expect(window.getByTestId('wizard')).toHaveCount(0);
      await expect(window.getByTestId('status-library')).toContainText(scenario.libraryName);

      // library.json holds the chosen values, no absolute path, no AI folders.
      const raw = await readFile(path.join(root, '.lab', 'library.json'), 'utf8');
      const config = JSON.parse(raw) as { name: string; language: string; aiEnabledFolders: string[] };
      expect(config.name).toBe(scenario.libraryName);
      expect(config.language).toBe(scenario.docLanguage);
      expect(config.aiEnabledFolders).toEqual([]);
      for (const needle of [root, root.replaceAll('\\', '\\\\'), root.replaceAll('\\', '/'), base]) expect(raw).not.toContain(needle);

      // Reopen: the library is active and the wizard does not come back.
      await ctx.close();
      ctx = await launchWith(base, root);
      await expect(ctx.window.getByTestId('shell')).toBeVisible();
      await expect(ctx.window.getByTestId('status-library')).toContainText(scenario.libraryName);
      await expect(ctx.window.getByTestId('wizard')).toHaveCount(0);
      await expect(ctx.window.getByTestId('library-switcher')).toHaveValue(/^lib-/);
      const html = await ctx.window.evaluate(() => document.documentElement.lang);
      expect(html).toBe(scenario.uiLanguage);
    } finally {
      await ctx?.close();
      await rm(base, { recursive: true, force: true }).catch(() => {});
    }
  });
}
