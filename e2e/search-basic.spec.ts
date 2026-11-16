import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { createLibraryViaWizard } from './helpers/phase1';

/**
 * Phase 1: a synthetic library is scanned in the background, then found by a title word and by a word of
 * the body text, with the page of the match. Offline: nothing here needs the network.
 */
test('scan, then search by title and by body word with the page of the result', async () => {
  test.setTimeout(240_000);
  let ctx: LaunchedApp | undefined;
  try {
    ctx = await launchApp({ library: 'papers', dialogPath: true, offline: true });
    const { window } = ctx;
    const papers = ctx.library!.manifest!.byKind('paper').filter((f) => f.hasText && f.format === 'pdf');
    expect(papers.length).toBeGreaterThan(0);
    const paper = papers[0]!;

    await createLibraryViaWizard(window, { name: 'Search library' });
    await expect(window.getByTestId('section-library')).toBeVisible();

    // The scan runs by itself; wait for it to finish, then for every document to be in the index.
    const status = window.getByTestId('scan-status');
    await expect(status).toBeVisible({ timeout: 60_000 });
    await expect(status).toHaveAttribute('data-state', 'done', { timeout: 180_000 });

    const input = window.getByTestId('search-input');

    // A word of the title.
    const titleWord = paper.title!.split(/\s+/).sort((a, b) => b.length - a.length)[0]!.replace(/[^\p{L}\p{N}]/gu, '');
    await input.fill(titleWord);
    const results = window.getByTestId('search-result');
    await expect(results.first()).toBeVisible({ timeout: 30_000 });
    await expect(results.filter({ hasText: paper.title! }).first()).toBeVisible();

    // A word that only the body of the first page has: the result names the page.
    const body = (paper as unknown as { body?: string }).body;
    const bodyWord = (body ?? 'quadratically').split(/\s+/).find((w) => /^[a-z]{9,}$/.test(w)) ?? 'quadratically';
    await input.fill(bodyWord);
    const hit = window.getByTestId('search-result').first();
    await expect(hit).toBeVisible({ timeout: 30_000 });
    await expect(hit.getByTestId('result-snippet').locator('mark').first()).toBeVisible();
    await expect(hit.getByTestId('result-pages').locator('.page-chip').first()).toHaveAttribute('data-page', /^\d+$/);

    // Nothing matches nonsense, and hostile text is not an error.
    await input.fill('" OR ( NEAR zzzzqqqq');
    await expect(window.getByTestId('search-empty')).toBeVisible({ timeout: 15_000 });
    await expect(window.getByTestId('search-error')).toHaveCount(0);

    expect(await ctx.blockedRequests()).toEqual([]);
    await ctx.verifyLibraryUntouched();
  } finally {
    await ctx?.close();
  }
});
