import { expect, test, type TestInfo } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { createLibraryViaWizard, skipUnlessChannels, waitForScan } from './helpers/phase1';
import { rows } from './helpers/ui';

/**
 * Phase 4 (wave 4.3) criteria: the advanced search with Claude next to the search bar (model, reasoning and an
 * estimate before sending; the answer streams in the chat panel with library cards and lab:// chips; the conversation
 * is marked as a search), and the behaviour without network: the advanced search and the chat say why they are not
 * available while the normal search keeps working.
 */
const CHANNELS = ['ai:status', 'ai:preview', 'chat:send', 'chat:list'];

async function openLibrary(ctx: LaunchedApp, testInfo: TestInfo): Promise<number> {
  const window = ctx.window;
  await createLibraryViaWizard(window, { name: 'Search library' });
  await skipUnlessChannels(window, testInfo, CHANNELS);
  const total = ctx.library!.manifest!.files.length;
  await waitForScan(window, total);
  await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });
  return total;
}

test('advanced search: estimate, then a streamed answer with cards and chips in a search conversation (phase 4)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    ctx = await launchApp({ library: 'papers', dialogPath: true, offline: true, env: { RL_AI_PROVIDER: 'mock' } });
    const window = ctx.window;
    await openLibrary(ctx, testInfo);
    const word = ctx.library!.manifest!.files.find((f) => f.format === 'pdf' && f.title)!.title!.split(/\s+/).find((w) => w.length > 5)!;

    await window.getByTestId('nav-settings').click();
    await expect(window.getByTestId('ai-available')).toHaveText('Available', { timeout: 30_000 });
    await window.getByTestId('ai-root-all').check();
    await window.getByTestId('ai-save').click();
    await expect(window.getByTestId('ai-settings').getByText('Saved')).toBeVisible();

    await window.getByTestId('nav-library').click();
    await window.getByTestId('search-input').fill(word);
    await expect(rows(window).first()).toBeVisible({ timeout: 30_000 });
    await window.getByTestId('adv-search').click();
    const dialog = window.getByTestId('adv-search-dialog');
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByTestId('adv-search-text')).toHaveValue(word);
    await expect(dialog.getByTestId('adv-search-model')).toBeVisible();
    await expect(dialog.getByTestId('adv-search-reasoning')).toBeVisible();
    await expect(dialog.getByTestId('adv-search-estimate')).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByTestId('adv-search-unavailable')).toHaveCount(0);
    await dialog.getByTestId('adv-search-go').click();

    // The answer streams in the chat panel, with a library card and a chip.
    await expect(window.getByTestId('chat-content')).toBeVisible({ timeout: 30_000 });
    const answer = window.getByTestId('chat-turn-ai').first();
    await expect(answer).toBeVisible({ timeout: 30_000 });
    await expect(window.getByTestId('chat-cancel')).toHaveCount(0, { timeout: 60_000 });
    await expect(answer.getByTestId('chat-card').first()).toBeVisible();
    await expect(answer.locator('[data-testid="lab-chip"][data-kind="doc"]').first()).toBeVisible();
    await expect(answer.getByTestId('turn-error')).toHaveCount(0);
    // The normal results are still there.
    await expect(rows(window).first()).toBeVisible();

    // The conversation is a search in the history.
    await window.getByTestId('chat-history-toggle').click();
    await expect(window.getByTestId('history-item').first()).toHaveAttribute('data-mode', 'search', { timeout: 30_000 });
  } finally {
    await ctx?.close();
  }
});

test('without network the advanced search and the chat say why, and the normal search works (phase 4)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    // The real provider (not the mock): only it checks the network.
    ctx = await launchApp({ library: 'papers', dialogPath: true, offline: true });
    const window = ctx.window;
    await openLibrary(ctx, testInfo);
    const title = ctx.library!.manifest!.files.find((f) => f.format === 'pdf' && f.title)!.title!;

    await window.getByTestId('search-input').fill(title.split(/\s+/).slice(0, 2).join(' '));
    await expect(rows(window).first()).toBeVisible({ timeout: 30_000 });
    await window.getByTestId('adv-search').click();
    const dialog = window.getByTestId('adv-search-dialog');
    await expect(dialog.getByTestId('adv-search-unavailable')).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByTestId('adv-search-go')).toBeDisabled();
    await dialog.getByTestId('adv-search-cancel').click();

    if (!(await window.getByTestId('chat-content').isVisible())) await window.getByTestId('chat-toggle').click();
    await expect(window.getByTestId('ai-unavailable')).toBeVisible({ timeout: 30_000 });
    // Nothing tried to reach the network.
    expect(await ctx.blockedRequests()).toEqual([]);
  } finally {
    await ctx?.close();
  }
});
