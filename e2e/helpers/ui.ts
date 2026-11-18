import { expect, type Page, type TestInfo } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { createLibraryViaWizard, skipUnlessChannels, waitForScan } from './phase1';

/** Channels the phase 2 interface needs; a spec is skipped cleanly when the runtime does not have them yet. */
export const PHASE2_CHANNELS = ['taxonomy:get', 'history:list', 'projects:list', 'library:tree', 'documents:tag', 'documents:update'];

/**
 * Launches the app on a synthetic library, creates the library with the wizard (no AI folders, empty taxonomy),
 * waits for the scan and for the list to show every document.
 */
export async function openSyntheticLibrary(testInfo: TestInfo, kind: 'papers' | 'full' = 'papers'): Promise<{ ctx: LaunchedApp; window: Page; total: number }> {
  const ctx = await launchApp({ library: kind, dialogPath: true, offline: true });
  const { window } = ctx;
  await createLibraryViaWizard(window, { name: 'UI library' });
  await skipUnlessChannels(window, testInfo, PHASE2_CHANNELS);
  const total = ctx.library!.manifest!.files.length;
  await waitForScan(window, total);
  await expect(window.getByTestId('section-library')).toBeVisible();
  await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });
  await expect(window.getByTestId('search-summary')).toContainText(String(total), { timeout: 60_000 });
  return { ctx, window, total };
}

export const rows = (window: Page) => window.getByTestId('search-result');
export const rowByTitle = (window: Page, title: string) => rows(window).filter({ hasText: title }).first();

/** Selects a row with the mouse (modifiers are Playwright's: 'Control', 'Shift'). */
export async function clickRow(window: Page, title: string, modifiers: Array<'Control' | 'Shift'> = []): Promise<void> {
  await rowByTitle(window, title).click({ modifiers });
}

/** Types into a tag picker and chooses the first suggestion (or the "create" entry when `create`). */
export async function pickTag(window: Page, input: ReturnType<Page['getByTestId']>, text: string, create = false): Promise<void> {
  await input.fill(text);
  if (create) {
    await window.getByTestId('tag-create').click();
  } else {
    await expect(window.getByTestId('tag-option').first()).toBeVisible();
    await input.press('Enter');
  }
}

/** Creates a top-level tag in the taxonomy manager and comes back to the list. */
export async function createTagInManager(window: Page, label: string, opts: { parent?: string } = {}): Promise<void> {
  if (!(await window.getByTestId('taxonomy-manager').isVisible())) await window.getByTestId('open-taxonomy').click();
  await expect(window.getByTestId('taxonomy-manager')).toBeVisible();
  if (opts.parent) {
    await window.getByTestId('tax-tree').locator(`[data-key="${opts.parent}"]`).click();
    await window.getByTestId('add-child').click();
  } else {
    await window.getByTestId('new-top-level').click();
  }
  await window.getByTestId('new-node-label').fill(label);
  await window.getByTestId('new-node-create').click();
  await expect(window.getByTestId('node-title')).toHaveText(label);
}

export async function backToList(window: Page): Promise<void> {
  await window.getByTestId('taxonomy-back').click();
  await expect(window.getByTestId('search-results')).toBeVisible();
}

/** Opens the Activity popover of the top bar (scan, AI jobs, citations); the rows of the jobs are in it. */
export async function openActivity(window: Page): Promise<void> {
  if (!(await window.getByTestId('activity-popover').isVisible())) await window.getByTestId('scan-status').click();
  await expect(window.getByTestId('activity-popover')).toBeVisible();
}
