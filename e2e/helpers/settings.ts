import { expect, type Page } from '@playwright/test';

export type SettingsSection = 'general' | 'profile' | 'library' | 'claude' | 'backup' | 'shortcuts' | 'advanced';

/** Opens the settings page on a section (General when none is named). */
export async function openSettings(window: Page, section: SettingsSection = 'general'): Promise<void> {
  if (!(await window.getByTestId('settings-page').isVisible())) await window.getByTestId('nav-settings').click();
  await expect(window.getByTestId('settings-page')).toBeVisible({ timeout: 30_000 });
  await window.getByTestId(`settings-nav-${section}`).click();
  await expect(window.getByTestId(`settings-section-${section}`)).toBeVisible();
}

/** Opens one group of Developer / Advanced (`claude`, `mcp`, `scan`, `export`, `maintenance`); its content is built when it opens. */
export async function openAdvancedGroup(window: Page, fold: 'claude' | 'mcp' | 'scan' | 'export' | 'maintenance'): Promise<void> {
  await openSettings(window, 'advanced');
  const group = window.getByTestId(`settings-fold-${fold}`);
  if ((await group.getAttribute('open')) === null) await group.locator('summary').click();
  await expect(group).toHaveAttribute('open', '');
}

/** The Claude section with its Account card loaded and Claude usable (a login or a key is in use). */
export async function waitClaudeReady(window: Page): Promise<void> {
  await openSettings(window, 'claude');
  await expect(window.getByTestId('ai-account')).toHaveAttribute('data-effective', /claude-code|api-key/, { timeout: 30_000 });
}

/** Enables a folder (a relative path of the tree) for Claude; every control saves by itself, so this waits for "Saved". */
export async function enableAiFolder(window: Page, folder: string): Promise<void> {
  await openSettings(window, 'claude');
  await window.getByTestId('config-ai-tree').locator(`input[data-folder="${folder}"]`).check();
  await expect(window.getByTestId('ai-folders').getByText('Saved')).toBeVisible();
}

/** Enables the whole library for Claude. */
export async function enableAiWholeLibrary(window: Page): Promise<void> {
  await openSettings(window, 'claude');
  await window.getByTestId('ai-root-all').check();
  await expect(window.getByTestId('ai-folders').getByText('Saved')).toBeVisible();
}
