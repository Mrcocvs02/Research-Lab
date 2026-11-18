import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DESKTOP_DIR, launchApp, type LaunchedApp } from './helpers/launch';

interface Scenario {
  title: string;
  uiLanguage: 'it' | 'en';
  docLanguage: 'it' | 'en';
  libraryName: string;
  /** Expected texts in the interface language. */
  texts: { welcome: string; summary: string };
}

const scenarios: Scenario[] = [
  { title: 'Italian interface, English documents', uiLanguage: 'it', docLanguage: 'en', libraryName: 'Biblioteca di prova', texts: { welcome: 'Benvenuto e lingua', summary: 'Riepilogo' } },
  { title: 'English interface, Italian documents', uiLanguage: 'en', docLanguage: 'it', libraryName: 'Sample library', texts: { welcome: 'Welcome and language', summary: 'Summary' } },
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

      // Folder step: the dialog is replaced by RL_E2E_DIALOG_PATH.
      await window.getByTestId('wizard-choose-folder').click();
      await expect(window.getByTestId('wizard-folder-chosen')).toContainText('any-folder');
      await next(window);

      // Details step: the library name, the language of the documents, and the optional name of the user.
      await window.getByTestId('wizard-lib-name').fill(scenario.libraryName);
      await window.getByTestId('wizard-doc-language').selectOption(scenario.docLanguage);
      await expect(window.getByTestId('wizard-profile-name')).toBeVisible();
      await next(window);

      // Starting tags: default empty, and it can be skipped.
      await expect(window.getByTestId('wizard-taxonomy-empty')).toBeChecked();
      await expect(window.getByTestId('wizard-skip')).toBeVisible();
      await next(window);

      // Claude: the tree is shown, nothing is selected, nothing has to be confirmed (4.11).
      const tree = window.getByTestId('wizard-ai-tree');
      await expect(tree.getByRole('checkbox')).toHaveCount(2);
      for (const box of await tree.getByRole('checkbox').all()) await expect(box).not.toBeChecked();
      await expect(window.getByTestId('wizard-ai-confirm')).toHaveCount(0);
      await expect(window.getByTestId('wizard-next')).toBeEnabled();
      await next(window);

      // Summary: the consent switch is on and explained; creating the library goes to the first scan (the seventh step).
      await expect(window.getByTestId('wizard-step-title')).toHaveText(scenario.texts.summary);
      await expect(window.getByTestId('wizard-progress')).toContainText('6');
      await expect(window.getByTestId('wizard-write-to-pdf')).toHaveAttribute('aria-checked', 'true');
      await window.getByTestId('wizard-create').click();
      await expect(window.getByTestId('wizard-scan')).toBeVisible();
      await expect(window.getByTestId('wizard-progress')).toContainText('7');
      // The first scan finishes on its own; the library opens from the last step.
      await expect(window.getByTestId('wizard-scan-open')).toBeEnabled({ timeout: 60_000 });
      await window.getByTestId('wizard-scan-open').click();
      await expect(window.getByTestId('wizard')).toHaveCount(0);
      await expect(window.getByTestId('status-library')).toContainText(scenario.libraryName);
      // W17: the first scan is the library, not news: the Activity chip has no "unseen result" dot.
      await expect(window.getByTestId('activity-dot')).toHaveCount(0);

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
      await expect(ctx.window.getByTestId('library-switcher')).toBeVisible();
      const html = await ctx.window.evaluate(() => document.documentElement.lang);
      expect(html).toBe(scenario.uiLanguage);
    } finally {
      await ctx?.close();
      await rm(base, { recursive: true, force: true }).catch(() => {});
    }
  });
}

// D-357: with no settings file the interface starts in the language of the system (Electron's --lang stands for it here).
for (const [locale, welcome] of [['en-US', 'Welcome and language'], ['it-IT', 'Benvenuto e lingua']] as const) {
  test(`first run: a system in ${locale} starts the wizard in ${welcome.startsWith('Welcome') ? 'English' : 'Italian'}`, async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'rl-lang-'));
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    delete env.ELECTRON_RENDERER_URL;
    delete env.ELECTRON_RUN_AS_NODE;
    Object.assign(env, { RL_USER_DATA_DIR: path.join(base, 'user'), RL_LOCAL_DATA_DIR: path.join(base, 'local'), RL_E2E_HIDDEN: '1', NODE_ENV: 'production' });
    const app = await electron.launch({ args: [DESKTOP_DIR, `--lang=${locale}`], env });
    try {
      const window = await app.firstWindow();
      await expect(window.getByTestId('wizard')).toBeVisible({ timeout: 30_000 });
      await expect(window.getByTestId('wizard-step-title')).toHaveText(welcome);
      await expect(window.getByTestId('wizard-ui-language')).toHaveValue(locale.startsWith('en') ? 'en' : 'it');
    } finally {
      await app.close().catch(() => {});
      await rm(base, { recursive: true, force: true }).catch(() => {});
    }
  });
}
